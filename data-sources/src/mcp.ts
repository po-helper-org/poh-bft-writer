/**
 * Минимальный клиент MCP по Streamable HTTP: initialize → tools/call.
 *
 * Свой, а не штатный dsh-mcp-client: тот публикует в агента ВСЕ инструменты
 * сервера и знает только статические заголовки, а здесь нужны OAuth с
 * обновлением токена и белый список инструментов только для чтения.
 */

const PROTOCOL = '2025-06-18'

export interface McpAuth {
  /** Текущий access-токен (обновлённый, если истёк). */
  token(): Promise<string>
  /** Сервер ответил 401: обновить токен; false — обновить нельзя. */
  unauthorized(): Promise<boolean>
}

export class McpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
  }
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number | string
  result?: unknown
  error?: { code: number; message: string }
}

/** Ответ JSON-RPC из тела: обычный JSON или поток событий (text/event-stream). */
export function parseRpcBody(contentType: string, body: string, id: number): JsonRpcResponse | undefined {
  const messages: JsonRpcResponse[] = []
  if (contentType.includes('text/event-stream')) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n')
      if (!data) continue
      try { messages.push(JSON.parse(data) as JsonRpcResponse) } catch { /* не JSON — пропускаем */ }
    }
  } else if (body.trim()) {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[]
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]))
  }
  return messages.find((message) => message.id === id)
}

/** Текст результата tools/call: content[].text через перевод строки. */
export function toolText(result: unknown): string {
  const value = result as { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }
  const text = (value.content ?? []).filter((part) => part.type === 'text' && part.text).map((part) => part.text).join('\n')
  if (value.isError) throw new McpError(`инструмент вернул ошибку: ${text.slice(0, 300)}`)
  if (text) return text
  return value.structuredContent === undefined ? '' : JSON.stringify(value.structuredContent)
}

export class McpHttpClient {
  private session: string | undefined
  private ready: Promise<void> | undefined
  private nextId = 1

  constructor(private readonly url: string, private readonly auth: McpAuth, private readonly timeoutMs = 30_000) {}

  /** Вызов инструмента; результат — текст. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    return toolText(await this.request('tools/call', { name, arguments: args }))
  }

  async listTools(): Promise<string[]> {
    const result = await this.request('tools/list', {}) as { tools?: { name: string }[] }
    return (result.tools ?? []).map((tool) => tool.name)
  }

  /** Забыть сессию (после смены токена или отключения). */
  reset(): void {
    this.session = undefined
    this.ready = undefined
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    await this.initialize()
    try {
      return await this.send(method, params)
    } catch (e) {
      // Сессия истекла на сервере — один раз переподключаемся.
      if (e instanceof McpError && e.status === 404 && this.session) {
        this.reset()
        await this.initialize()
        return this.send(method, params)
      }
      throw e
    }
  }

  private initialize(): Promise<void> {
    this.ready ??= (async () => {
      await this.send('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'bft-portal-data-sources', version: '0.1.0' } })
      await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, undefined).catch(() => undefined)
    })().catch((e) => {
      this.ready = undefined
      throw e
    })
    return this.ready
  }

  private async send(method: string, params: unknown, retried = false): Promise<unknown> {
    const id = this.nextId++
    let response: { status: number; contentType: string; body: string }
    try {
      response = await this.post({ jsonrpc: '2.0', id, method, params }, id)
    } catch (e) {
      if (e instanceof McpError && e.status === 401 && !retried && await this.auth.unauthorized()) {
        if (method !== 'initialize') this.reset()
        if (method !== 'initialize') await this.initialize()
        return this.send(method, params, true)
      }
      throw e
    }
    const message = parseRpcBody(response.contentType, response.body, id)
    if (!message) throw new McpError(`${method}: нет ответа сервера`)
    if (message.error) throw new McpError(`${method}: ${message.error.message}`)
    return message.result
  }

  private async post(payload: unknown, id: number | undefined): Promise<{ status: number; contentType: string; body: string }> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${await this.auth.token()}`,
      'mcp-protocol-version': PROTOCOL,
    }
    if (this.session) headers['mcp-session-id'] = this.session
    const response = await fetch(this.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(this.timeoutMs) })
    const session = response.headers.get('mcp-session-id')
    if (session) this.session = session
    const body = await response.text()
    if (!response.ok && response.status !== 202) {
      throw new McpError(`MCP HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`, response.status)
    }
    void id
    return { status: response.status, contentType: response.headers.get('content-type') ?? '', body }
  }
}
