/**
 * «Отправить в Confluence» (ADR-0028): маршруты портала и клиент workflow ConfluencePublish.
 * Отдельным модулем, чтобы index.ts только подключал его (как «Планирование»).
 *
 *  GET  customer-form.confluenceParents?session=  — ТОП-5 родительских страниц и прошлая отправка
 *  GET  customer-form.confluenceSearch?session=&q= — поиск: название, ссылка, id страницы
 *  POST customer-form.confluencePublish {session, parent} — старт workflow
 *  GET  customer-form.confluenceProgress?session= — ход отправки (query `progress` workflow)
 *
 * Поиск — через read-only шлюз (ADR-0019, `materials.confluence`); запись — только в
 * активностях workflow (ключ публикации). Ход отправки живёт в Temporal, номер прогона —
 * в confluence-publish.json заявки: перезагрузка страницы продолжает показывать тот же ход.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client, Connection } from '@temporalio/client'
import type { ConfluenceHit, ConfluencePage, ConfluenceSource } from './confluence.js'
import { readCustomerPages } from './confluence.js'
import {
  parentQueries, parsePageRef, publishWorkflowId, rankParents, readPublishState, sourcePages, updatePublishState,
  type ConfluenceWriter, type ParentCandidate, type ParentRef, type PublishRequest, type PublishState,
} from './confluence-publish.js'

type Register = (route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }) => () => void

export const PUBLISH_TASK_QUEUE = 'bft-flow'
export const PUBLISH_WORKFLOW_TYPE = 'ConfluencePublish'

/** Ход отправки — копия PublishProgress из bft-flow/src/publish.ts. */
export interface PublishProgress {
  taskId: number
  run: number
  parent: ParentRef
  steps: Array<{ key: string; label: string; status: 'pending' | 'running' | 'done' | 'failed'; detail?: string }>
  status: 'running' | 'done' | 'failed'
  url?: string
  pageId?: string
  error?: string
  warnings: string[]
  startedAt: string
  finishedAt?: string
}

/** Клиент Temporal для отправок: старт и ход. Нет адреса или Temporal недоступен — undefined. */
export class PublishFlow {
  private client?: Promise<Client>
  constructor(
    readonly address = (process.env.TEMPORAL_ADDRESS ?? '').trim(),
    readonly namespace = (process.env.TEMPORAL_NAMESPACE ?? 'bft').trim(),
  ) {}

  get enabled(): boolean { return !!this.address }

  private async connect(): Promise<Client> {
    if (!this.enabled) throw new Error('Temporal не настроен (TEMPORAL_ADDRESS)')
    this.client ??= Connection.connect({ address: this.address, connectTimeout: '5s' }).then((connection) => new Client({ connection, namespace: this.namespace }))
    return this.client.catch((e: Error) => { this.client = undefined; throw new Error(`Temporal недоступен: ${e.message}`) })
  }

  async start(req: PublishRequest): Promise<string> {
    const client = await this.connect()
    const workflowId = publishWorkflowId(req.taskId, req.run)
    await client.workflow.start(PUBLISH_WORKFLOW_TYPE, { workflowId, taskQueue: PUBLISH_TASK_QUEUE, args: [req], workflowIdReusePolicy: 'REJECT_DUPLICATE' })
    return workflowId
  }

  /** Ход: query `progress`; workflow ещё не начал шаг или воркер bft-flow недоступен — по describe. */
  async progress(workflowId: string): Promise<PublishProgress | { status: 'running' | 'failed' | 'done'; error?: string } | undefined> {
    const client = await this.connect()
    const handle = client.workflow.getHandle(workflowId)
    try {
      return await handle.query<PublishProgress>('progress')
    } catch (e) {
      const desc = await handle.describe().catch(() => undefined)
      if (!desc) return undefined
      const name = desc.status.name
      if (name === 'RUNNING') return { status: 'running' }
      if (name === 'COMPLETED') return { status: 'done' }
      return { status: 'failed', error: `Отправка остановлена (${name}): ${(e as Error).message.slice(0, 160)}` }
    }
  }
}

export interface PublishRouteDeps {
  /** Заявка по сессии: номер, slug, папка, путь к полному БФТ (готов ли), название. */
  request(sessionId: string): Promise<{ taskId: number; slug: string; dir: string; md: string; ready: boolean; title: string; systems: string[] } | undefined>
  /** Папки всех заявок — для «сюда уже публиковали». */
  root: string
  confluence(): ConfluenceSource | undefined
  writer(): ConfluenceWriter | undefined
  flow: PublishFlow
  who?(request: Request): string | undefined
  /** Отправка началась — запись в хронику цикла заявки. */
  started?(req: PublishRequest): Promise<void>
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const hitRef = (h: ConfluenceHit | ConfluencePage): ParentRef => {
  const space = 'container' in h ? h.container : 'space' in h ? h.space : undefined
  return { id: h.id, title: h.title, ...(space ? { space } : {}), ...(h.url ? { url: h.url } : {}) }
}

/** Прошлые родители всех заявок портала: id → сколько раз и последний заголовок. */
async function previousParents(root: string): Promise<Map<string, { ref: ParentRef; n: number }>> {
  const out = new Map<string, { ref: ParentRef; n: number }>()
  for (const name of (await readdir(root).catch(() => [] as string[])).sort()) {
    const state = await readPublishState(join(root, name))
    if (!state.parent || !state.publishedAt) continue
    const cur = out.get(state.parent.id)
    out.set(state.parent.id, { ref: state.parent, n: (cur?.n ?? 0) + 1 })
  }
  return out
}

const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), ms))])

export function registerConfluencePublish(register: Register, deps: PublishRouteDeps): Array<() => void> {
  const cache = new Map<string, { at: number; body: unknown }>()

  const suggestions = async (sessionId: string) => {
    const req = await deps.request(sessionId)
    if (!req) return undefined
    const state = await readPublishState(req.dir)
    const source = deps.confluence()
    const searchable = !!source && await withTimeout(source.available(), 5_000, false)
    const candidates: ParentCandidate[] = []
    for (const [id, p] of await previousParents(deps.root)) {
      for (let i = 0; i < Math.min(p.n, 3); i++) candidates.push({ id, title: p.ref.title, source: 'previous', ...(p.ref.space ? { space: p.ref.space } : {}), ...(p.ref.url ? { url: p.ref.url } : {}) })
    }
    if (state.parent) candidates.push({ ...state.parent, source: 'previous' }, { ...state.parent, source: 'previous' })
    const sourcesMd = await readFile(join(req.dir, 'sources.md'), 'utf8').catch(() => '')
    for (const p of [...sourcePages(sourcesMd), ...(await readCustomerPages(req.dir)).map((p) => ({ id: p.id, title: p.title, url: p.url }))]) {
      candidates.push({ id: p.id, title: p.title, url: p.url, source: 'sources' })
    }
    const writer = deps.writer()
    if (searchable && source) {
      const queries = parentQueries(req.title, req.systems)
      const results = await Promise.all(queries.map((q) => withTimeout(source.searchConfluence(q, 8), 15_000, [] as ConfluenceHit[]).then((hits) => ({ q, hits }))))
      const siblings: ConfluenceHit[] = []
      for (const { q, hits } of results) {
        hits.forEach((h, rank) => {
          if (/^\[?БФТ\]?/i.test(h.title) && h.id !== state.pageId) siblings.push(h)
          else candidates.push({ ...hitRef(h), source: 'search', rank, via: q })
        })
      }
      // Похожий БФТ найден — его родитель и есть «где у вас лежат БФТ» (нужен ключ публикации: шлюз предков не отдаёт).
      if (writer) {
        const seen = new Set<string>()
        for (const h of siblings.filter((h) => !seen.has(h.id) && seen.add(h.id)).slice(0, 5)) {
          const page = await withTimeout(writer.getPage(h.id), 10_000, undefined)
          const parent = page?.ancestors[page.ancestors.length - 1]
          if (parent) candidates.push({ id: parent.id, title: parent.title, space: page.space.key, source: 'sibling', via: h.title })
        }
      }
    }
    const top = rankParents(candidates, { limit: 5, ...(state.pageId ? { exclude: [state.pageId] } : {}) })
    return { req, state, searchable, top }
  }

  const resolve = async (q: string): Promise<{ results: ParentRef[]; message?: string }> => {
    const ref = parsePageRef(q)
    if (!ref) return { results: [] }
    if ('tiny' in ref) return { results: [], message: 'Короткая ссылка «Поделиться» не содержит номера страницы. Откройте страницу и скопируйте адрес из строки браузера.' }
    const source = deps.confluence()
    const writer = deps.writer()
    if ('pageId' in ref) {
      const page = source ? await source.readConfluencePage(ref.pageId).then(hitRef, () => undefined) : undefined
      if (page) return { results: [page] }
      const w = writer ? await writer.getPage(ref.pageId).catch(() => undefined) : undefined
      if (w) return { results: [{ id: w.id, title: w.title, space: w.space.key, url: w.url }] }
      return { results: [], message: 'Страница по этой ссылке не найдена или к ней нет доступа.' }
    }
    if (!source || !(await withTimeout(source.available(), 5_000, false))) return { results: [], message: 'Поиск по Confluence сейчас недоступен — вставьте ссылку на страницу.' }
    const query = 'title' in ref ? ref.title : ref.query
    const hits = await withTimeout(source.searchConfluence(query, 10), 15_000, [] as ConfluenceHit[])
    const filtered = 'space' in ref ? hits.filter((h) => h.title.toLowerCase() === ref.title.toLowerCase() && (!h.container || h.container === ref.space)) : hits
    return { results: filtered.map(hitRef), ...(filtered.length ? {} : { message: 'Ничего не нашлось — попробуйте другое название или вставьте ссылку.' }) }
  }

  const progressOf = async (state: PublishState) => {
    if (!state.workflowId) return undefined
    return deps.flow.progress(state.workflowId).catch((e: Error) => ({ status: 'unknown' as const, error: e.message }))
  }

  return [
    register({
      path: '/api/customer-form.confluenceParents', methods: ['GET'], requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        const hit = cache.get(sessionId)
        if (hit && Date.now() - hit.at < 10 * 60_000) return json(hit.body)
        const got = await suggestions(sessionId)
        if (!got) return json({ error: 'Заявка не найдена' }, 404)
        const body = {
          configured: !!deps.writer() && deps.flow.enabled,
          searchable: got.searchable,
          title: got.req.title,
          current: got.state.parent ?? null,
          published: got.state.url && got.state.publishedAt ? { url: got.state.url, at: got.state.publishedAt } : null,
          suggestions: got.top,
        }
        if (got.searchable) cache.set(sessionId, { at: Date.now(), body })
        return json(body)
      },
    }),
    register({
      path: '/api/customer-form.confluenceSearch', methods: ['GET'], requestBody: 'buffered',
      fetch: async (request) => {
        const params = new URL(request.url).searchParams
        if (!(await deps.request(params.get('session') ?? ''))) return json({ error: 'Заявка не найдена' }, 404)
        return json(await resolve(params.get('q') ?? ''))
      },
    }),
    register({
      path: '/api/customer-form.confluencePublish', methods: ['POST'], requestBody: 'buffered',
      fetch: async (request) => {
        const body = (await request.json().catch(() => ({}))) as { session?: unknown; parent?: { id?: unknown; title?: unknown; space?: unknown; url?: unknown } }
        const sessionId = typeof body.session === 'string' ? body.session : ''
        const req = await deps.request(sessionId)
        if (!req) return json({ error: 'Заявка не найдена' }, 404)
        if (!req.ready) return json({ error: 'Полный БФТ ещё не собран — отправлять нечего.' }, 409)
        const id = String(body.parent?.id ?? '')
        if (!/^\d{1,20}$/.test(id)) return json({ error: 'Выберите родительскую страницу.' }, 400)
        if (!deps.writer()) return json({ error: 'Публикация в Confluence не настроена: администратору — добавить ключ CONFLUENCE_PUBLISH_TOKEN (и адрес CONFLUENCE_PUBLISH_URL).' }, 409)
        if (!deps.flow.enabled) return json({ error: 'Отправка идёт через Temporal, а он не настроен (TEMPORAL_ADDRESS).' }, 409)
        const state = await readPublishState(req.dir)
        const current = await progressOf(state)
        if (current && current.status === 'running') return json({ workflowId: state.workflowId, already: true })
        const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 300) : undefined)
        const parent: ParentRef = { id, title: str(body.parent?.title) ?? `страница ${id}`, ...(str(body.parent?.space) ? { space: str(body.parent?.space)! } : {}), ...(str(body.parent?.url) ? { url: str(body.parent?.url)! } : {}) }
        const run = state.runs + 1
        const by = deps.who?.(request)
        const publish: PublishRequest = { taskId: req.taskId, slug: req.slug, sessionId, parent, run, ...(by ? { by } : {}) }
        try {
          const workflowId = await deps.flow.start(publish)
          await updatePublishState(req.dir, { runs: run, workflowId })
          cache.delete(sessionId)
          await deps.started?.(publish).catch(() => undefined)
          return json({ workflowId })
        } catch (e) {
          return json({ error: `Не удалось начать отправку: ${(e as Error).message.slice(0, 200)}` }, 503)
        }
      },
    }),
    register({
      path: '/api/customer-form.confluenceProgress', methods: ['GET'], requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        const req = await deps.request(sessionId)
        if (!req) return json({ error: 'Заявка не найдена' }, 404)
        const state = await readPublishState(req.dir)
        return json({
          workflowId: state.workflowId ?? null,
          published: state.url && state.publishedAt ? { url: state.url, at: state.publishedAt } : null,
          parent: state.parent ?? null,
          progress: (await progressOf(state)) ?? null,
        })
      },
    }),
  ]
}
