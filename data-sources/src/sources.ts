/**
 * Источник данных «MTS PO штаб» — удалённый MCP штаба агентов PO (Jira,
 * Confluence). Портал зовёт ТОЛЬКО инструменты чтения из белого списка:
 * у штаба есть и запись (создать задачу, изменить страницу, shell,
 * сообщения), до неё портал не дотягивается.
 */
import { discover, dropConnection, exchange, loadConnection, newState, pkce, refresh, register, revoke, saveConnection, authorizeUrl, type Connection, type PendingAuth } from './oauth.js'
import { McpHttpClient } from './mcp.js'
import { confluenceFindings, findingsMarkdown, jiraFindings, jqlFor, merge, rank, type Finding } from './findings.js'

/** Инструменты штаба, которые порталу разрешено вызывать (только чтение). */
export const READ_ONLY_TOOLS = ['confluence_search', 'confluence_get_page', 'jira_search', 'jira_get_issue'] as const
type ReadOnlyTool = typeof READ_ONLY_TOOLS[number]

export interface SourceStatus {
  id: string
  name: string
  url: string
  connected: boolean
  connectedAt?: string
  /** Последняя ошибка обращения (без секретов). */
  error?: string
  tools: readonly string[]
}

export interface ReconResult {
  findings: Finding[]
  markdown: string
  queries: string[]
  errors: string[]
}

const JIRA_FIELDS = 'summary,status,issuetype,project,updated,description'

export class McpSource {
  private connection: Connection | undefined
  private loaded: Promise<void>
  private readonly pending = new Map<string, PendingAuth>()
  private readonly client: McpHttpClient
  private lastError: string | undefined
  private refreshing: Promise<boolean> | undefined

  constructor(readonly id: string, readonly name: string, readonly url: string, private readonly scope = 'staff') {
    this.loaded = loadConnection(id).then((connection) => { this.connection = connection })
    this.client = new McpHttpClient(url, {
      token: async () => {
        await this.loaded
        if (!this.connection) throw new Error(`«${this.name}» не подключён — подключите в «Настройках → Источники данных»`)
        // Токен истекает через минуту — обновляем заранее.
        if (this.connection.expiresAt && this.connection.expiresAt - Date.now() < 60_000) await this.renew()
        return this.connection.accessToken
      },
      unauthorized: () => this.renew(),
    })
  }

  async status(): Promise<SourceStatus> {
    await this.loaded
    return {
      id: this.id,
      name: this.name,
      url: this.url,
      connected: !!this.connection,
      ...(this.connection ? { connectedAt: this.connection.connectedAt } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
      tools: READ_ONLY_TOOLS,
    }
  }

  async connected(): Promise<boolean> {
    await this.loaded
    return !!this.connection
  }

  /** Начать вход: адрес окна авторизации сервера. */
  async beginAuth(redirectUri: string): Promise<string> {
    const server = await discover(this.url)
    const client = await register(server, redirectUri, this.scope)
    const { verifier, challenge } = pkce()
    const state = newState()
    const pending: PendingAuth = {
      sourceId: this.id, verifier, redirectUri, clientId: client.clientId,
      ...(client.clientSecret ? { clientSecret: client.clientSecret } : {}),
      server, scope: this.scope, createdAt: Date.now(),
    }
    // Незавершённые входы старше 15 минут — выбрасываем.
    for (const [key, value] of this.pending) if (Date.now() - value.createdAt > 15 * 60_000) this.pending.delete(key)
    this.pending.set(state, pending)
    return authorizeUrl(pending, challenge, state, this.url)
  }

  ownsState(state: string): boolean {
    return this.pending.has(state)
  }

  /** Возврат из окна авторизации: код → токены → сохранить. */
  async completeAuth(state: string, code: string): Promise<void> {
    const pending = this.pending.get(state)
    if (!pending) throw new Error('вход устарел или начат в другом окне — нажмите «Подключить» ещё раз')
    this.pending.delete(state)
    const connection = await exchange(pending, code, this.url)
    await saveConnection(this.id, connection)
    this.connection = connection
    this.lastError = undefined
    this.client.reset()
  }

  async disconnect(): Promise<void> {
    await this.loaded
    if (this.connection) await revoke(this.connection)
    this.connection = undefined
    this.client.reset()
    await dropConnection(this.id)
  }

  private renew(): Promise<boolean> {
    this.refreshing ??= (async () => {
      if (!this.connection?.refreshToken) return false
      try {
        this.connection = await refresh(this.connection, this.url)
        await saveConnection(this.id, this.connection)
        return true
      } catch (e) {
        this.lastError = `токен не обновился: ${e instanceof Error ? e.message : String(e)} — подключите источник заново`
        return false
      }
    })().finally(() => { this.refreshing = undefined })
    return this.refreshing
  }

  private async call(tool: ReadOnlyTool, args: Record<string, unknown>): Promise<string> {
    if (!(READ_ONLY_TOOLS as readonly string[]).includes(tool)) throw new Error(`инструмент ${tool} не в белом списке`)
    try {
      const text = await this.client.callTool(tool, args)
      this.lastError = undefined
      return text
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e)
      throw e
    }
  }

  async searchConfluence(query: string, limit = 5): Promise<Finding[]> {
    return confluenceFindings(await this.call('confluence_search', { query, limit }), query)
  }

  async searchJira(query: string, limit = 5): Promise<Finding[]> {
    return jiraFindings(await this.call('jira_search', { jql: jqlFor(query), limit, fields: JIRA_FIELDS }), query)
  }

  /** Поиск по обоим: для проверки в «Настройках» и для агентов. */
  async search(query: string, limit = 5): Promise<{ findings: Finding[]; errors: string[] }> {
    const errors: string[] = []
    const settled = await Promise.allSettled([this.searchConfluence(query, limit), this.searchJira(query, limit)])
    const findings: Finding[] = []
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') findings.push(...result.value)
      else errors.push(`${index === 0 ? 'Confluence' : 'Jira'}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
    }
    return { findings: merge(findings), errors }
  }

  /** Дочитать находку: страницу Confluence или описание задачи Jira. */
  private async readBody(finding: Finding): Promise<void> {
    if (finding.kind === 'confluence') {
      const value = JSON.parse(await this.call('confluence_get_page', { page_id: finding.id, convert_to_markdown: true, include_metadata: false })) as unknown
      const page = (value && typeof value === 'object' && 'result' in value ? JSON.parse(String((value as { result: unknown }).result)) : value) as { content?: { value?: string }; metadata?: unknown } | string
      const text = typeof page === 'string' ? page : (page.content?.value ?? '')
      // Макрос Jira в Confluence оставляет «Jira<uuid>KEY-1» — убираем uuid, ключ остаётся.
      finding.body = text.replace(/Jira[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2500)
    } else {
      const value = JSON.parse(await this.call('jira_get_issue', { issue_key: finding.id, fields: 'summary,status,description', comment_limit: 0, update_history: false })) as unknown
      const issue = (value && typeof value === 'object' && 'result' in value ? JSON.parse(String((value as { result: unknown }).result)) : value) as { description?: string }
      finding.body = (issue.description ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1200)
    }
  }

  /**
   * Разведка для полного БФТ: запросы → Confluence и Jira → слить и
   * ранжировать → дочитать лучшие → карта находок с готовыми markdown-ссылками.
   */
  async recon(queries: string[], options: { top?: number; read?: number; deadlineMs?: number } = {}): Promise<ReconResult> {
    const top = options.top ?? 10
    const read = options.read ?? 4
    const deadline = Date.now() + (options.deadlineMs ?? 90_000)
    const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 6)
    const errors: string[] = []
    const all: Finding[] = []
    for (const query of unique) {
      if (Date.now() > deadline) { errors.push('время разведки вышло'); break }
      const { findings, errors: failed } = await this.search(query, 5)
      all.push(...findings)
      errors.push(...failed.map((e) => `«${query}» — ${e}`))
    }
    const ranked = rank(all, unique, Math.ceil(top / 2))
    for (const finding of ranked.slice(0, read)) {
      if (Date.now() > deadline) break
      await this.readBody(finding).catch((e) => errors.push(`${finding.kind === 'jira' ? finding.id : finding.title}: ${e instanceof Error ? e.message : String(e)}`))
    }
    const markdown = findingsMarkdown(ranked, { source: this.name, queries: unique, at: new Date().toISOString().slice(0, 16).replace('T', ' ') })
    return { findings: ranked, markdown, queries: unique, errors }
  }
}
