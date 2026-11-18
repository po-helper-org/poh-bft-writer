/**
 * Источник данных «Jira и Confluence (только чтение)» — шлюз источников
 * (`harness/sources-gateway`, ADR-0015): отдельный MCP-процесс, у которого
 * есть ровно четыре инструмента чтения и больше ничего. Портал ходит в него
 * по статическому bearer-токену из окружения `DATA_SOURCES_TOKEN_<ID>`;
 * адрес — из конфига или `DATA_SOURCES_URL_<ID>`. Нет адреса или токена —
 * источник «не настроен»: не подключён и ни к чему не обращается.
 *
 * Второй слой защиты — здесь: портал зовёт ТОЛЬКО инструменты из белого
 * списка READ_ONLY_TOOLS, call() отклоняет любое другое имя ещё до сети.
 * OAuth нет (ADR-0015): ни входа, ни обновления, ни приёмника возврата.
 */
import { McpError, McpHttpClient } from './mcp.js'
import {
  applyTriage, childJqls, cleanBody, confluenceFindings, epicChildren, extractLeads, findingsMarkdown, jiraBrowseBase, jiraFindings, jiraIssueFinding,
  jqlsFor, merge, rank, synonymsIn, titleOnSubject, triageItems, unwrap, contentTerms, type Finding, type Synonym, type TriageItem, type TriageVerdict,
} from './findings.js'
import { pool, withTimeout } from './pool.js'

/** Инструменты шлюза, которые порталу разрешено вызывать (только чтение). */
export const READ_ONLY_TOOLS = ['confluence_search', 'confluence_get_page', 'jira_search', 'jira_get_issue'] as const
type ReadOnlyTool = typeof READ_ONLY_TOOLS[number]

/** Имя инструмента входит в белый список — точное совпадение, без префиксов и регистра. */
export function isReadOnlyTool(name: unknown): name is ReadOnlyTool {
  return typeof name === 'string' && (READ_ONLY_TOOLS as readonly string[]).includes(name)
}

export interface SourceStatus {
  id: string
  name: string
  url: string
  connected: boolean
  /** Адрес MCP и токен заданы (конфиг или DATA_SOURCES_URL_<ID>, DATA_SOURCES_TOKEN_<ID>). */
  configured: boolean
  /** Человеческая подпись состояния для «Настроек». */
  label: string
  /** Последняя ошибка обращения (без секретов). */
  error?: string
  tools: readonly string[]
}

export interface ReconResult {
  findings: Finding[]
  markdown: string
  queries: string[]
  errors: string[]
  /** Синонимы систем из тел находок (и дополнительный запрос по ним). */
  synonyms: Synonym[]
  /** Триаж прошёл (вердикты есть в находках и в карте). */
  triaged: boolean
  /** Сколько шла разведка. */
  ms: number
}

/** Предмет заявки: название и имена систем — для фильтра ранжирования, второго шага и синонимов. */
/** Предмет заявки; object — что заявка меняет (главное существительное названия), не платформа. */
export interface ReconSubject { title: string; systems: string[]; object?: string }

export interface ReconOptions {
  /** Верхняя граница карты (по половине на Confluence и Jira). */
  top?: number
  /** Сколько тел дочитать всего: до 4 Confluence и до 3 Jira (по умолчанию 7). */
  read?: number
  deadlineMs?: number
  subject?: ReconSubject
  /**
   * Запросы, по которым считаются очки ранга (раунд 6): детерминированное ядро
   * (название, «объект + система»). Запросы модели расширяют выдачу, но порядок
   * карты от них не зависит. Нет — очки по всем запросам.
   */
  rankBy?: string[]
  /** Триаж находок (модель портала); сбой или таймаут — карта без вердиктов. */
  triage?: (items: TriageItem[], signal: AbortSignal) => Promise<TriageVerdict[]>
}

/** Бюджеты тел: Confluence ≈4000, Jira ≈2000 символов; найденные вторым шагом — вдвое меньше. */
const BODY_BUDGET = { confluence: 4000, jira: 2000 } as const

const JIRA_FIELDS = 'summary,status,issuetype,project,updated,description'

const envKey = (sourceId: string) => sourceId.toUpperCase().replace(/[^A-Z0-9]/g, '_')

/** Переменная окружения токена источника: atlassian → DATA_SOURCES_TOKEN_ATLASSIAN. */
export function serviceTokenEnv(sourceId: string): string {
  return `DATA_SOURCES_TOKEN_${envKey(sourceId)}`
}

/** Переменная окружения адреса источника: atlassian → DATA_SOURCES_URL_ATLASSIAN. */
export function sourceUrlEnv(sourceId: string): string {
  return `DATA_SOURCES_URL_${envKey(sourceId)}`
}

export const CONNECTED_LABEL = 'подключён: только чтение'
export const NOT_CONFIGURED_LABEL = 'не настроен'
const NOT_CONFIGURED = (id: string) => `источник не настроен — задайте ${sourceUrlEnv(id)} и ${serviceTokenEnv(id)} (harness/.env)`
// Без латинского слова token: e2e проверяет, что статус не похож на секрет.
export const SERVICE_REJECTED = 'токен отклонён шлюзом источников — перевыпустите его на сервере (harness/deploy/install-sources-gateway.sh, ADR-0015)'

export interface McpSourceOptions {
  /** Токен шлюза источников; не задан — из окружения (serviceTokenEnv). */
  serviceToken?: string
}

export class McpSource {
  private readonly client: McpHttpClient | undefined
  private lastError: string | undefined
  /** Есть и адрес, и токен. Сам токен — только внутри клиента, наружу не отдаётся. */
  readonly configured: boolean

  constructor(readonly id: string, readonly name: string, readonly url: string, options: McpSourceOptions = {}) {
    const token = (options.serviceToken ?? process.env[serviceTokenEnv(id)] ?? '').trim()
    this.configured = url.trim() !== '' && token !== ''
    this.client = this.configured ? new McpHttpClient(url, token) : undefined
  }

  async status(): Promise<SourceStatus> {
    if (!this.configured) {
      return { id: this.id, name: this.name, url: this.url.trim(), connected: false, configured: false, label: NOT_CONFIGURED_LABEL, tools: READ_ONLY_TOOLS }
    }
    return {
      id: this.id, name: this.name, url: this.url, connected: true, configured: true, label: CONNECTED_LABEL,
      ...(this.lastError ? { error: this.lastError } : {}),
      tools: READ_ONLY_TOOLS,
    }
  }

  async connected(): Promise<boolean> {
    return this.configured
  }

  /** Единственная дорога к шлюзу: имя вне белого списка отклоняется до сети. */
  private async call(tool: ReadOnlyTool, args: Record<string, unknown>): Promise<string> {
    if (!isReadOnlyTool(tool)) throw new Error(`инструмент ${String(tool)} не в белом списке`)
    if (!this.client) throw new Error(NOT_CONFIGURED(this.id))
    try {
      const text = await this.client.callTool(tool, args)
      this.lastError = undefined
      return text
    } catch (e) {
      if (e instanceof McpError && e.status === 401) {
        this.lastError = SERVICE_REJECTED
        throw new Error(SERVICE_REJECTED)
      }
      this.lastError = e instanceof Error ? e.message : String(e)
      throw e
    }
  }

  async searchConfluence(query: string, limit = 5): Promise<Finding[]> {
    return confluenceFindings(await this.call('confluence_search', { query, limit }), query)
  }

  async searchJira(query: string, limit = 10): Promise<Finding[]> {
    const settled = await Promise.allSettled(jqlsFor(query).map((jql) => this.jiraByJql(jql.jql, query, limit, jql.titleMatch)))
    const ok = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (!ok.length && failed) throw failed.reason
    return merge(ok)
  }

  private async jiraByJql(jql: string, query: string, limit: number, titleMatch: boolean): Promise<Finding[]> {
    const found = jiraFindings(await this.call('jira_search', { jql, limit, fields: JIRA_FIELDS }), query)
    return titleMatch ? found.map((finding) => ({ ...finding, titleMatch: true })) : found
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

  /** Сырой текст находки: страница Confluence или описание задачи Jira (у пустого эпика — его состав). */
  private async rawBody(finding: Finding): Promise<string> {
    if (finding.kind === 'confluence') {
      const page = this.parsePage(await this.call('confluence_get_page', { page_id: finding.id, convert_to_markdown: true, include_metadata: false }))
      return page.text
    }
    const issue = unwrap(await this.call('jira_get_issue', { issue_key: finding.id, fields: 'summary,status,issuetype,description', comment_limit: 0, update_history: false })) as { description?: string; fields?: { description?: string } }
    const description = (issue.description ?? issue.fields?.description ?? '').trim()
    if (description) return description
    if (!/эпик|epic|истори|story|инициатив|feature/i.test(finding.type ?? '')) return '(описание пустое)'
    const children = await Promise.allSettled(childJqls(finding.id).map(async (jql) => jiraFindings(await this.call('jira_search', { jql, limit: 8, fields: 'summary,status,issuetype' }), '')))
    return epicChildren(finding.id, children.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])))
  }

  /** Ответ confluence_get_page: текст и (если есть) метаданные. */
  private parsePage(text: string): { text: string; title?: string; url?: string; space?: string; spaceName?: string; updated?: string } {
    const value = unwrap(text) as unknown
    if (typeof value === 'string') return { text: value }
    const page = value as { content?: { value?: string }; metadata?: Record<string, unknown>; title?: string; url?: string }
    const meta = (page.metadata ?? page) as { title?: string; url?: string; space?: { key?: string; name?: string }; updated?: string; last_modified?: string; version?: { when?: string } }
    return {
      text: page.content?.value ?? '',
      ...(meta.title ? { title: String(meta.title) } : {}),
      ...(meta.url ? { url: String(meta.url) } : {}),
      ...(meta.space?.key ? { space: meta.space.key } : {}),
      ...(meta.space?.name ? { spaceName: meta.space.name } : {}),
      ...((meta.updated ?? meta.last_modified ?? meta.version?.when) ? { updated: String(meta.updated ?? meta.last_modified ?? meta.version?.when) } : {}),
    }
  }

  /** Второй шаг: загрузить находку по ключу или pageId из тела другой находки. */
  private async fetchLead(lead: ReturnType<typeof extractLeads>[number], via: string, jiraBase: string | undefined): Promise<Finding | undefined> {
    if (lead.kind === 'jira') {
      const issue = unwrap(await this.call('jira_get_issue', { issue_key: lead.id, fields: JIRA_FIELDS, comment_limit: 0, update_history: false }))
      const found = jiraIssueFinding(issue, undefined)
      if (!found) return undefined
      if (!found.url && jiraBase) found.url = `${jiraBase}${found.id}`
      if (!found.url) return undefined
      const description = (issue as { description?: string }).description ?? ''
      return { ...found, via, ...(description.trim() ? { body: description } : {}) }
    }
    const page = this.parsePage(await this.call('confluence_get_page', { page_id: lead.id, convert_to_markdown: true, include_metadata: true }))
    return {
      kind: 'confluence', id: lead.id, title: page.title ?? lead.label, url: page.url ?? lead.url,
      ...(page.space ? { container: page.space } : {}), ...(page.spaceName ? { containerName: page.spaceName } : {}),
      type: 'page', ...(page.updated ? { updated: page.updated } : {}),
      snippet: '', hits: 1, queries: [], via, ...(page.text.trim() ? { body: page.text } : {}),
    }
  }

  /**
   * Разведка для полного БФТ: запросы → Confluence и Jira (параллельно) →
   * слить и ранжировать по предмету заявки → дочитать лучшие (до 4 Confluence
   * и 2 Jira) → второй шаг по подписанным ссылкам из тел → синонимы систем →
   * триаж моделью → карта находок с готовыми markdown-ссылками. Всё — в
   * пределах дедлайна: новый вызов после него не начинается.
   */
  async recon(queries: string[], options: ReconOptions = {}): Promise<ReconResult> {
    const startedAt = Date.now()
    const top = options.top ?? 10
    const readTotal = options.read ?? 7
    const deadline = startedAt + (options.deadlineMs ?? 80_000)
    const left = () => deadline - Date.now()
    const at = new Date(startedAt).toISOString().slice(0, 16).replace('T', ' ')
    const subjectTexts = options.subject ? [options.subject.title, ...options.subject.systems] : []
    const unique = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 6)
    const errors: string[] = []
    const reason = (e: unknown) => (e instanceof Error ? e.message : String(e))

    // 1. Поиск: по каждому запросу Confluence и два JQL — общий пул по 4.
    const searchAll = async (list: string[]) => {
      const tasks = list.flatMap((query) => [
        // 10 страниц на запрос (раунд 4): свежие частные страницы с тем же словом вытесняли из первых пяти страницу процесса.
        { label: `«${query}» — Confluence`, run: () => this.searchConfluence(query, 10) },
        ...jqlsFor(query).map((jql) => ({ label: `«${query}» — Jira`, run: () => this.jiraByJql(jql.jql, query, 10, jql.titleMatch) })),
      ])
      const settled = await pool(tasks.map((task) => task.run), 4, deadline)
      const found: Finding[] = []
      settled.forEach((result, index) => {
        if (!result) errors.push(`${tasks[index]!.label}: время разведки вышло`)
        else if (result.status === 'fulfilled') found.push(...result.value)
        else errors.push(`${tasks[index]!.label}: ${reason(result.reason)}`)
      })
      return found
    }
    const all = await searchAll(unique)
    const object = options.subject?.object
    const core = [...new Set((options.rankBy ?? []).map((q) => q.trim()).filter(Boolean))]
    const rankQueries = core.length ? core : unique
    let ranked = rank(all, rankQueries, Math.ceil(top / 2), { subject: subjectTexts, ...(object ? { object } : {}) })

    // 2. Тела: до 4 Confluence и 3 Jira выше порога, параллельно по 3; чистка — по порядку ранга
    //    (повтор абзаца из уже выведенной находки вырезается).
    const toRead = [
      ...ranked.filter((f) => f.kind === 'confluence').slice(0, Math.min(4, readTotal)),
      ...ranked.filter((f) => f.kind === 'jira').slice(0, Math.max(0, Math.min(3, readTotal - 4))),
    ]
    const raws = await pool(toRead.map((finding) => () => this.rawBody(finding)), 3, deadline)
    const raw = new Map<Finding, string>()
    raws.forEach((result, index) => {
      const finding = toRead[index]!
      if (result?.status === 'fulfilled') raw.set(finding, result.value)
      else if (result) errors.push(`${finding.kind === 'jira' ? finding.id : finding.title}: ${reason(result.reason)}`)
    })
    const seen = new Set<string>()
    for (const finding of ranked) {
      const text = raw.get(finding)
      if (text !== undefined) finding.body = cleanBody(text, BODY_BUDGET[finding.kind], seen)
    }

    // 3. Второй шаг: из одного-двух тел про предмет заявки — не больше трёх загрузок.
    const related: Finding[] = []
    if (subjectTexts.length && left() > 10_000) {
      const known = new Set(ranked.map((f) => `${f.kind}:${f.id}`))
      // Родители — одно-два прочитанных тела про предмет заявки (в порядке ранга), где есть куда идти.
      const parents = ranked.filter((f) => raw.has(f) && titleOnSubject(f, subjectTexts))
        .map((parent) => ({ parent, leads: extractLeads(raw.get(parent)!, subjectTexts, known, 3) }))
        .filter((item) => item.leads.length > 0).slice(0, 2)
      const leads = parents.flatMap(({ parent, leads: list }) => list.map((lead) => ({ lead, parent })))
      const picked = leads.filter((item, index) => leads.findIndex((other) => other.lead.kind === item.lead.kind && other.lead.id === item.lead.id) === index).slice(0, 3)
      const base = jiraBrowseBase([...all, ...ranked])
      const viaOf = (parent: Finding) => (parent.kind === 'jira' ? parent.id : parent.title.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60))
      const fetched = await pool(picked.map(({ lead, parent }) => () => this.fetchLead(lead, viaOf(parent), base)), 3, Math.min(deadline, Date.now() + 20_000))
      fetched.forEach((result, index) => {
        if (result?.status === 'fulfilled' && result.value) related.push(result.value)
        else if (result?.status === 'rejected') errors.push(`второй шаг ${picked[index]!.lead.id}: ${reason(result.reason)}`)
      })
      for (const finding of related) {
        if (finding.body) finding.body = cleanBody(finding.body, BODY_BUDGET[finding.kind] / 2, seen)
      }
    }

    // 4. Синонимы систем («Имя (Синоним)» в телах) — один дополнительный запрос, если есть время.
    const synonyms = options.subject ? synonymsIn([...raw.values()], options.subject.systems) : []
    const allQueries = [...unique]
    if (synonyms.length && left() > 25_000) {
      const { system, alias } = synonyms[0]!
      const escaped = system.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const withSystem = unique.find((q) => new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(q))
      const noun = contentTerms([options.subject!.title]).length ? options.subject!.title.split(/\s+/).find((word) => word.length >= 4 && contentTerms([word]).length > 0) : undefined
      const extra = withSystem ? withSystem.replace(new RegExp(escaped, 'iu'), alias) : noun ? `${alias} ${noun}` : alias
      if (!allQueries.includes(extra)) {
        allQueries.push(extra)
        const more = await searchAll([extra])
        // Тела уже прочитанных находок сохраняются: merge берёт первую копию.
        ranked = rank([...ranked, ...more], [...rankQueries, extra], Math.ceil(top / 2), { subject: [...subjectTexts, alias], ...(object ? { object } : {}) })
      }
    }

    // 5. Триаж: вердикт о релевантности и факты с цитатами; сбой — карта без вердиктов.
    let findings = [...ranked, ...related]
    let triaged = false
    if (options.triage && findings.length && left() > 8_000) {
      const controller = new AbortController()
      const budget = Math.min(left() - 2_000, 40_000)
      try {
        const verdicts = await withTimeout(options.triage(triageItems(findings), controller.signal), budget, 'триаж не уложился во время')
        findings = applyTriage(findings, verdicts)
        triaged = findings.some((f) => f.relevance)
      } catch (e) {
        controller.abort()
        errors.push(`триаж: ${reason(e)}`)
      }
    }

    const markdown = findingsMarkdown(findings, { source: this.name, queries: allQueries, at, synonyms })
    return { findings, markdown, queries: allQueries, errors, synonyms, triaged, ms: Date.now() - startedAt }
  }
}
