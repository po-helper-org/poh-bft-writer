/**
 * data-sources · узловая половина: корпоративные источники данных портала БФТ
 * (Jira, Confluence) как dsh-плагин.
 *
 * - Источники — удалённые MCP с OAuth (первый — «MTS PO штаб»); список —
 *   конфиг плагина (cordis.patch.yml).
 * - Подключает администратор в «Настройках → Источники данных»: вход в окне
 *   сервера авторизации, токены — в томе, обновляются сами.
 * - Другим плагинам — служба `dataSources` (ctx.inject(['dataSources'])):
 *   поиск и разведка для полного БФТ. Только инструменты чтения.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { McpSource, type ReconResult, type SourceStatus } from './sources.js'
import type { Finding } from './findings.js'

export const name = 'data-sources'

export interface SourceConfig {
  id: string
  name: string
  url: string
  scope?: string
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
  /** Разведка по запросам в первом подключённом источнике; нет источника — undefined. */
  recon(queries: string[], options?: { top?: number; read?: number; deadlineMs?: number }): Promise<(ReconResult & { source: string }) | undefined>
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

const ROUTE = {
  status: '/api/data-sources.status',
  connect: '/api/data-sources.connect',
  disconnect: '/api/data-sources.disconnect',
  search: '/api/data-sources.search',
}

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

/**
 * Возврат из окна входа. Сервер штаба PO разрешает только loopback-адреса
 * вида http://127.0.0.1:<порт>/callback, а маршруты dsh живут под /api —
 * поэтому плагин держит отдельный приёмник ровно на /callback (порт 3081,
 * compose публикует его только на 127.0.0.1 хоста). Без state начатого
 * входа приёмник ничего не делает.
 */
const CALLBACK_PORT = Number(process.env.DATA_SOURCES_CALLBACK_PORT ?? 3081)
const CALLBACK_URL = process.env.DATA_SOURCES_CALLBACK_URL ?? `http://127.0.0.1:${CALLBACK_PORT}/callback`
const PORTAL_URL = (process.env.PORTAL_PUBLIC_URL ?? 'http://127.0.0.1:3080').replace(/\/$/, '')

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function resultPage(ok: boolean, title: string, text: string): Response {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{--fg:#111;--muted:#666;--bg:#fff}@media(prefers-color-scheme:dark){:root{--fg:#eee;--muted:#999;--bg:#151515}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}.w{max-width:440px;margin:14vh auto 0;padding:0 16px}
h1{font-size:1.3rem}p{color:var(--muted)}a{color:inherit}</style></head><body><div class="w" data-source-result="${ok ? 'ok' : 'error'}">
<h1>${ok ? '✓ ' : ''}${esc(title)}</h1><p>${esc(text)}</p><p><a href="${esc(PORTAL_URL)}/">Вернуться в портал</a> — «Ещё → Настройки → Источники данных».</p></div></body></html>`, {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const DEFAULT_SOURCES: SourceConfig[] = [
  { id: 'po-hq', name: 'MTS PO штаб', url: 'https://harness.aleksishmanov.ru/mcp', scope: 'staff' },
]

export function apply(ctx: HarnessContext, config: Config = {}): void {
  const sources = (config.sources?.length ? config.sources : DEFAULT_SOURCES)
    .map((source) => new McpSource(source.id, source.name, source.url, source.scope ?? 'staff'))
  const byId = (id: unknown) => sources.find((source) => source.id === id)

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
    async recon(queries, options) {
      for (const source of sources) {
        if (await source.connected()) return { ...(await source.recon(queries, options)), source: source.name }
      }
      return undefined
    },
  }
  ctx.effect(() => ctx.provide('dataSources', service), 'data-sources: служба dataSources')

  /** Код из окна входа → токены; state сверяется с начатым входом. */
  const completeAuth = async (params: URLSearchParams): Promise<Response> => {
    const state = params.get('state') ?? ''
    const source = sources.find((candidate) => candidate.ownsState(state))
    if (params.get('error')) {
      console.error(`[data-sources] вход отменён сервером: ${params.get('error')} ${params.get('error_description') ?? ''}`)
      return resultPage(false, 'Вход отменён', params.get('error_description') ?? params.get('error') ?? '')
    }
    if (!source) {
      console.error('[data-sources] возврат из окна входа с неизвестным state — вход устарел (перезапуск портала или второе окно)')
      return resultPage(false, 'Вход устарел', 'Нажмите «Подключить» в настройках ещё раз.')
    }
    try {
      await source.completeAuth(state, params.get('code') ?? '')
      console.error(`[data-sources] ${source.id}: подключён`)
      return resultPage(true, `«${source.name}» подключён`, 'Портал будет искать по Jira и Confluence перед сборкой полного БФТ.')
    } catch (e) {
      console.error(`[data-sources] ${source.id}: обмен кода не удался:`, e)
      return resultPage(false, `«${source.name}» не подключился`, e instanceof Error ? e.message : String(e))
    }
  }

  ctx.effect(() => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://callback')
      if (req.method !== 'GET' || url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      void completeAuth(url.searchParams).then(async (response) => {
        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => { headers[key] = value })
        res.writeHead(response.status, headers)
        res.end(Buffer.from(await response.arrayBuffer()))
      }, () => res.writeHead(500).end())
    })
    server.on('error', (e) => console.error(`[data-sources] приёмник входа :${CALLBACK_PORT} не поднялся:`, e))
    server.listen(CALLBACK_PORT, '0.0.0.0')
    return () => { server.close() }
  }, `data-sources: приёмник входа :${CALLBACK_PORT}`)

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

    route(ROUTE.connect, ['GET'], async (request) => {
      if (!isAdmin(request)) {
        console.error('[data-sources] «Подключить» без входа администратора')
        return resultPage(false, 'Нужен вход администратора', 'Источники данных подключает администратор портала.')
      }
      const source = byId(new URL(request.url).searchParams.get('source'))
      if (!source) return resultPage(false, 'Источник не найден', 'Такого источника нет в настройках плагина.')
      try {
        const location = await source.beginAuth(CALLBACK_URL)
        console.error(`[data-sources] ${source.id}: начат вход, возврат на ${CALLBACK_URL}`)
        return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })
      } catch (e) {
        console.error(`[data-sources] ${source.id}: вход не начался:`, e)
        return resultPage(false, `«${source.name}» не подключился`, e instanceof Error ? e.message : String(e))
      }
    })

    route(ROUTE.disconnect, ['POST'], async (request) => {
      if (!isAdmin(request)) return adminOnly()
      const body = await request.json().catch(() => ({})) as { source?: string }
      const source = byId(body.source)
      if (!source) return Response.json({ error: 'источник не найден' }, { status: 404 })
      await source.disconnect()
      return Response.json({ sources: await service.status() })
    })

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
