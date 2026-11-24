/**
 * MCP-сервер портала (ADR-0023): Streamable HTTP без сессий — каждый POST несёт
 * один JSON-RPC запрос (или пакет), ответ — application/json. Протокол — минимум,
 * который понимают Claude Code, Cursor и прочие клиенты: initialize, ping,
 * tools/list|call, prompts/list|get, resources/list|read. Без SDK — как клиент
 * MCP в data-sources (mcp.ts): зависимостей у портала нет, а протокол здесь мал.
 *
 * Доступ — Authorization: Bearer <личный токен> (access.ts). Нет токена или он
 * отозван — 401 с WWW-Authenticate; клиент не получает даже список инструментов.
 */

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

export interface McpCaller { user: string }

export interface McpTool {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  /** Возвращает текст для агента; Error — isError с текстом ошибки (агент исправляет и повторяет). */
  call(args: Record<string, unknown>, caller: McpCaller): Promise<string>
}

export interface McpPrompt {
  name: string
  description: string
  arguments?: { name: string; description: string; required?: boolean }[]
  get(args: Record<string, string>): Promise<string>
}

export interface McpResource {
  uri: string
  name: string
  description: string
  mimeType: string
  read(): Promise<string>
}

export interface McpServerSpec {
  name: string
  version: string
  instructions: string
  tools: McpTool[]
  prompts: McpPrompt[]
  resources: McpResource[]
  /** Владелец токена или undefined. */
  authenticate(request: Request): string | undefined
}

interface RpcRequest { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } })

const rpcError = (id: RpcRequest['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** Обработчик HTTP-маршрута MCP. */
export function mcpHandler(spec: McpServerSpec): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    if (request.method === 'GET') return new Response('SSE-поток не поддерживается: шлите JSON-RPC через POST', { status: 405, headers: { allow: 'POST, DELETE' } })
    if (request.method === 'DELETE') return new Response(null, { status: 204 })
    if (request.method !== 'POST') return new Response('method not allowed', { status: 405, headers: { allow: 'POST, DELETE' } })
    const user = spec.authenticate(request)
    if (!user) {
      return json(rpcError(null, -32001, 'нужен личный токен MCP портала: Authorization: Bearer bftmcp_… (выпустить — страница «Доступ для ИИ-агентов» портала)'), 401,
        { 'www-authenticate': 'Bearer realm="bft-mcp", error="invalid_token"' })
    }
    let body: unknown
    try { body = await request.json() } catch { return json(rpcError(null, -32700, 'тело — не JSON'), 400) }
    const batch = Array.isArray(body)
    const items = (batch ? body : [body]) as RpcRequest[]
    if (!items.length || items.length > 20) return json(rpcError(null, -32600, 'пакет — от 1 до 20 запросов'), 400)
    const out = (await Promise.all(items.map((item) => dispatch(spec, item, { user })))).filter((r): r is NonNullable<typeof r> => !!r)
    if (!out.length) return new Response(null, { status: 202 })
    return json(batch ? out : out[0])
  }
}

async function dispatch(spec: McpServerSpec, req: RpcRequest, caller: McpCaller): Promise<unknown | undefined> {
  if (!req || typeof req !== 'object' || typeof req.method !== 'string') return rpcError(req?.id, -32600, 'нет method')
  // Уведомление (нет id) — ответа не бывает.
  if (req.id === undefined) return undefined
  const id = req.id
  const params = req.params ?? {}
  try {
    switch (req.method) {
      case 'initialize': {
        const asked = String(params.protocolVersion ?? '')
        const protocolVersion = (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : PROTOCOL_VERSIONS[0]
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
            serverInfo: { name: spec.name, version: spec.version },
            instructions: spec.instructions,
          },
        }
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools: spec.tools.map(({ name, title, description, inputSchema }) => ({ name, ...(title ? { title } : {}), description, inputSchema })) } }
      case 'tools/call': {
        const tool = spec.tools.find((t) => t.name === params.name)
        if (!tool) return rpcError(id, -32602, `нет инструмента ${String(params.name)}`)
        const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>
        try {
          const text = await tool.call(args, caller)
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }], isError: false } }
        } catch (e) {
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: (e as Error).message || String(e) }], isError: true } }
        }
      }
      case 'prompts/list':
        return { jsonrpc: '2.0', id, result: { prompts: spec.prompts.map(({ name, description, arguments: a }) => ({ name, description, ...(a ? { arguments: a } : {}) })) } }
      case 'prompts/get': {
        const prompt = spec.prompts.find((p) => p.name === params.name)
        if (!prompt) return rpcError(id, -32602, `нет промта ${String(params.name)}`)
        const text = await prompt.get((params.arguments ?? {}) as Record<string, string>)
        return { jsonrpc: '2.0', id, result: { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text } }] } }
      }
      case 'resources/list':
        return { jsonrpc: '2.0', id, result: { resources: spec.resources.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType })) } }
      case 'resources/read': {
        const resource = spec.resources.find((r) => r.uri === params.uri)
        if (!resource) return rpcError(id, -32602, `нет ресурса ${String(params.uri)}`)
        return { jsonrpc: '2.0', id, result: { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: await resource.read() }] } }
      }
      default:
        return rpcError(id, -32601, `метод ${req.method} не поддерживается`)
    }
  } catch (e) {
    console.error('[customer-form] MCP:', e)
    return rpcError(id, -32603, (e as Error).message || 'внутренняя ошибка')
  }
}
