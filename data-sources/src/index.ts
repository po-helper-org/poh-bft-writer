/**
 * data-sources · узловая половина: корпоративные источники данных портала БФТ
 * (Jira, Confluence) как dsh-плагин.
 *
 * - Источник один — шлюз источников (`harness/sources-gateway`, ADR-0015):
 *   отдельный MCP-процесс ровно с четырьмя инструментами чтения Jira и
 *   Confluence. Адрес — из конфига или DATA_SOURCES_URL_<ID>, токен —
 *   DATA_SOURCES_TOKEN_<ID>; нет одного из них — источник «не настроен».
 * - Только токен: OAuth, окна входа, приёмника возврата и маршрутов
 *   «Подключить»/«Отключить» нет. При запуске файлы прежних OAuth-подключений
 *   из тома удаляются (legacy.ts).
 * - Другим плагинам — служба `dataSources` (ctx.inject(['dataSources'])):
 *   поиск и разведка для полного БФТ. Только инструменты чтения.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { McpSource, sourceUrlEnv, type ConfluencePage, type ReconOptions, type ReconResult, type SourceStatus } from './sources.js'
import { removeLegacyConnections } from './legacy.js'
import type { Finding } from './findings.js'

export const name = 'data-sources'

export interface SourceConfig {
  id: string
  name: string
  /** Адрес MCP; пусто — берётся из DATA_SOURCES_URL_<ID>, нет и там — «не настроен». */
  url?: string
  /**
   * Только для E2E с двойником шлюза (customer-form/e2e/sources-double.mjs):
   * учитывается, лишь когда в томе есть флаг e2e-hooks (его ставит и снимает
   * harness/e2e-customer.sh). Настоящий токен — только DATA_SOURCES_TOKEN_<ID>.
   */
  e2eToken?: string
}

export interface Config {
  sources?: SourceConfig[]
}

/** Служба для других плагинов (customer-form: разведка перед полным БФТ). */
export interface DataSources {
  /** Есть хотя бы один подключённый источник. */
  available(): Promise<boolean>
  status(): Promise<SourceStatus[]>
  search(query: string, limit?: number): Promise<{ findings: Finding[]; errors: string[] }>
  /**
   * Поиск страниц Confluence (чат заказчика, ADR-0019). Нет подключённого
   * источника или шлюз не ответил — исключение: потребитель честно говорит,
   * что поиск недоступен.
   */
  searchConfluence(query: string, limit?: number): Promise<Finding[]>
  /** Страница Confluence целиком по id (материал заявки, ADR-0019). */
  readConfluencePage(pageId: string): Promise<ConfluencePage>
  /** Разведка по запросам в первом подключённом источнике; нет источника — undefined. */
  recon(queries: string[], options?: ReconOptions): Promise<(ReconResult & { source: string }) | undefined>
}

interface HarnessContext {
  get(name: string): unknown
  effect(fn: () => (() => void) | void, label?: string): void
  inject(names: string[], apply: (scoped: HarnessContext) => void): void
  provide(name: string, value?: unknown): () => void
}

interface ConnectionLike {
  fetch?: { register: (route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }) => () => void }
}

/** Маршруты узла: только статус и пробный поиск. Подключать и отключать нечего. */
export const ROUTE = {
  status: '/api/data-sources.status',
  search: '/api/data-sources.search',
} as const

/**
 * Администратор портала — та же кука, что ставит вход customer-form
 * (`/api/customer-form.admin`): HMAC от ADMIN_PASSWORD. Плагин проверяет её
 * сам, чтобы не зависеть от customer-form.
 */
function isAdmin(request: Request): boolean {
  const secret = process.env.ADMIN_PASSWORD?.trim()
  if (!secret) return false
  const expected = createHmac('sha256', secret).update('portal-admin-v1').digest('hex')
  const cookie = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('portal_admin='))
  const actual = cookie?.slice('portal_admin='.length) ?? ''
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export const DEFAULT_SOURCES: SourceConfig[] = [
  { id: 'atlassian', name: 'Jira и Confluence (только чтение)' },
]

/** Адрес источника: из конфига, иначе из DATA_SOURCES_URL_<ID>; пусто — «не настроен». */
function sourceUrl(source: SourceConfig): string {
  return (source.url?.trim() || process.env[sourceUrlEnv(source.id)]?.trim() || '')
}

/** Флаг E2E в томе (как у customer-form): без него токен из конфига не берётся. */
function e2eHooks(): boolean {
  return existsSync(join(process.env.DSH_HOME ?? '/data', 'e2e-hooks'))
}

export function apply(ctx: HarnessContext, config: Config = {}): void {
  const sources = (config.sources?.length ? config.sources : DEFAULT_SOURCES)
    .map((source) => new McpSource(source.id, source.name, sourceUrl(source),
      source.e2eToken && e2eHooks() ? { serviceToken: source.e2eToken } : {}))
  const first = async () => {
    for (const source of sources) if (await source.connected()) return source
    throw new Error('нет подключённых источников')
  }

  const service: DataSources = {
    async available() {
      for (const source of sources) if (await source.connected()) return true
      return false
    },
    status: () => Promise.all(sources.map((source) => source.status())),
    async search(query, limit) {
      for (const source of sources) if (await source.connected()) return source.search(query, limit)
      return { findings: [], errors: ['нет подключённых источников'] }
    },
    searchConfluence: async (query, limit) => (await first()).searchConfluence(query, limit),
    readConfluencePage: async (pageId) => (await first()).readConfluencePage(pageId),
    async recon(queries, options) {
      for (const source of sources) {
        if (await source.connected()) return { ...(await source.recon(queries, options)), source: source.name }
      }
      return undefined
    },
  }
  ctx.effect(() => ctx.provide('dataSources', service), 'data-sources: служба dataSources')

  // Разовая уборка: файлы OAuth-подключений прежних версий (полный токен шлюза агентов).
  void removeLegacyConnections().then((removed) => {
    if (removed) console.warn(`[data-sources] удалены прежние OAuth-подключения из тома: ${removed}`)
  }, () => undefined)

  ctx.inject(['connection'], (scoped) => {
    const register = (scoped.get('connection') as ConnectionLike).fetch?.register
    if (typeof register !== 'function') return
    const route = (path: string, methods: string[], fetch: (request: Request) => Promise<Response>) =>
      scoped.effect(() => register({ path, methods, requestBody: 'buffered', fetch }), `data-sources: ${path}`)
    const adminOnly = () => Response.json({ error: 'Только администратор портала' }, { status: 403 })

    route(ROUTE.status, ['GET'], async (request) => Response.json(
      { admin: isAdmin(request), sources: await service.status() },
      { headers: { 'cache-control': 'no-store' } },
    ))

    // Пробный поиск из «Настроек»: убедиться, что источник отвечает и находит.
    route(ROUTE.search, ['POST'], async (request) => {
      if (!isAdmin(request)) return adminOnly()
      const body = await request.json().catch(() => ({})) as { query?: string }
      const query = (body.query ?? '').trim()
      if (!query) return Response.json({ error: 'пустой запрос' }, { status: 400 })
      const result = await service.search(query, 5)
      return Response.json({ findings: result.findings.map(({ body: _body, ...rest }) => rest), errors: result.errors })
    })
  })
}
