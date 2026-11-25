/**
 * Публикация полного БФТ в Confluence (ADR-0028).
 *
 * - `ConfluenceWriter` — узкий клиент REST API Confluence (v1, Server/DC и Cloud) с ключом
 *   публикации: страница, метки, вложения. Это единственное место портала, которое пишет
 *   в Confluence; чтение и поиск по-прежнему идут через read-only шлюз (ADR-0015, ADR-0019).
 * - Чистые функции выбора родительской страницы: разбор ссылки/ввода, ранжирование ТОП-5.
 * - Состояние публикации заявки — `confluence-publish.json` в папке заявки: pageId (по нему
 *   повторная отправка обновляет страницу, а не плодит дубль), родитель, номер прогона.
 * - Активности workflow `ConfluencePublish` (bft-flow): преобразование → страница →
 *   вложения → итог. Исполняет их `confluence-publisher` (очередь bft-confluence) — тот же
 *   образ, что портал, но в сети хоста: Confluence бывает доступен только через VPN хоста,
 *   а ключ записи есть только у него, не у портала с агентами.
 *
 * Ключ и адрес — только из окружения (`CONFLUENCE_PUBLISH_URL`, `CONFLUENCE_PUBLISH_TOKEN`,
 * для Cloud ещё `CONFLUENCE_PUBLISH_USER`); в журнал, ответы и историю Temporal не попадают.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { confluenceLink } from './confluence.js'
import { bftToStorage, diagramFileName, plantumlSources } from './confluence-storage.js'

// ── Клиент записи ─────────────────────────────────────────────────────────

export interface PublishConfig { baseUrl: string; token: string; user?: string }

/** Адрес и ключ публикации из окружения; нет одного из них — публикация не настроена. */
export function publishConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PublishConfig | undefined {
  const baseUrl = (env.CONFLUENCE_PUBLISH_URL ?? '').trim().replace(/\/+$/, '')
  const token = (env.CONFLUENCE_PUBLISH_TOKEN ?? '').trim()
  const user = (env.CONFLUENCE_PUBLISH_USER ?? '').trim()
  if (!baseUrl || !token || !/^https?:\/\//.test(baseUrl)) return undefined
  return { baseUrl, token, ...(user ? { user } : {}) }
}

/** Ошибка Confluence: `retryable` — сеть, 5xx, 409, 429 (Temporal повторит); иначе — решает человек. */
export class ConfluenceError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) { super(message) }
}

export interface PageInfo {
  id: string
  title: string
  space: { key: string; name?: string }
  version: number
  ancestors: Array<{ id: string; title: string }>
  url: string
}

export interface AttachmentInfo { id: string; title: string; size?: number; comment?: string }

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

interface RawContent {
  id: string; title: string; space?: { key: string; name?: string }; version?: { number: number }
  ancestors?: Array<{ id: string; title: string }>; _links?: { webui?: string; base?: string }
}

/** Человеческое объяснение отказа Confluence — его видит пользователь портала. */
export function explainStatus(status: number, what: string, detail = ''): string {
  const tail = detail ? `: ${detail.replace(/\s+/g, ' ').slice(0, 200)}` : ''
  if (status === 401) return 'Confluence не принял ключ публикации портала (401). Администратору — проверить CONFLUENCE_PUBLISH_TOKEN.'
  if (status === 403) return `Нет прав: ${what} (403). Выберите другую родительскую страницу или попросите права на запись в этом разделе.`
  if (status === 404) return `Не найдено: ${what} (404) — страница удалена или к ней нет доступа.`
  if (status === 413) return `Confluence отклонил ${what}: слишком большой размер (413).`
  if (status === 429) return 'Confluence просит подождать (429) — повторим автоматически.'
  if (status >= 500) return `Confluence временно недоступен (${status}) — повторим автоматически.`
  return `Confluence отклонил ${what} (${status})${tail}`
}

export class ConfluenceWriter {
  constructor(readonly config: PublishConfig, private readonly fetchImpl: FetchLike = fetch) {}

  private auth(): string {
    return this.config.user
      ? `Basic ${Buffer.from(`${this.config.user}:${this.config.token}`).toString('base64')}`
      : `Bearer ${this.config.token}`
  }

  private async call<T>(method: string, path: string, what: string, body?: unknown, extra?: { form?: FormData }): Promise<T> {
    let res: Response
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          authorization: this.auth(), accept: 'application/json',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(extra?.form ? { 'x-atlassian-token': 'no-check' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : extra?.form ? { body: extra.form } : {}),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (e) {
      throw new ConfluenceError(`Confluence не ответил (${(e as Error).message.slice(0, 120)}) — повторим автоматически.`, 0, true)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      let detail = ''
      try { detail = (JSON.parse(text) as { message?: string }).message ?? '' } catch { detail = text.slice(0, 200) }
      const retryable = res.status >= 500 || res.status === 409 || res.status === 429
      throw new ConfluenceError(explainStatus(res.status, what, detail), res.status, retryable)
    }
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  private page(raw: RawContent): PageInfo {
    const webui = raw._links?.webui ?? `/pages/viewpage.action?pageId=${raw.id}`
    return {
      id: String(raw.id), title: raw.title,
      space: { key: raw.space?.key ?? '', ...(raw.space?.name ? { name: raw.space.name } : {}) },
      version: raw.version?.number ?? 1,
      ancestors: (raw.ancestors ?? []).map((a) => ({ id: String(a.id), title: a.title })),
      url: `${this.config.baseUrl}${webui}`,
    }
  }

  /** Страница по id; нет — undefined. */
  async getPage(id: string): Promise<PageInfo | undefined> {
    if (!/^\d{1,20}$/.test(id)) return undefined
    try {
      return this.page(await this.call<RawContent>('GET', `/rest/api/content/${id}?expand=space,version,ancestors`, `страница ${id}`))
    } catch (e) {
      if (e instanceof ConfluenceError && e.status === 404) return undefined
      throw e
    }
  }

  async findByTitle(spaceKey: string, title: string): Promise<PageInfo | undefined> {
    const q = new URLSearchParams({ spaceKey, title, type: 'page', expand: 'space,version,ancestors' })
    const res = await this.call<{ results: RawContent[] }>('GET', `/rest/api/content?${q}`, 'поиск страницы по названию')
    return res.results[0] ? this.page(res.results[0]) : undefined
  }

  async createPage(p: { spaceKey: string; parentId: string; title: string; body: string }): Promise<PageInfo> {
    return this.page(await this.call<RawContent>('POST', '/rest/api/content?expand=space,version,ancestors', 'создание страницы', {
      type: 'page', title: p.title, space: { key: p.spaceKey }, ancestors: [{ id: p.parentId }],
      body: { storage: { value: p.body, representation: 'storage' } },
    }))
  }

  async updatePage(p: { id: string; version: number; spaceKey: string; parentId: string; title: string; body: string }): Promise<PageInfo> {
    return this.page(await this.call<RawContent>('PUT', `/rest/api/content/${p.id}?expand=space,version,ancestors`, 'обновление страницы', {
      id: p.id, type: 'page', title: p.title, space: { key: p.spaceKey }, ancestors: [{ id: p.parentId }],
      version: { number: p.version + 1, message: 'Портал БФТ: повторная отправка' },
      body: { storage: { value: p.body, representation: 'storage' } },
    }))
  }

  /** Кто вошёл под ключом (без записи). Server/DC без входа отвечает 200 «anonymous» — это не вход. */
  async whoAmI(): Promise<{ ok: boolean; text: string }> {
    try {
      const me = await this.call<{ type?: string; displayName?: string; username?: string; publicName?: string }>('GET', '/rest/api/user/current', 'проверка входа')
      if (!me || me.type === 'anonymous') return { ok: false, text: 'Confluence не узнал ключ: вход анонимный — ключ неверный или истёк' }
      return { ok: true, text: `вход есть: ${me.displayName ?? me.publicName ?? me.username ?? 'пользователь'}; право записи проверится при первой отправке в выбранный раздел` }
    } catch (e) {
      return { ok: false, text: (e as Error).message }
    }
  }

  async labels(id: string): Promise<string[]> {
    const res = await this.call<{ results: Array<{ name: string }> }>('GET', `/rest/api/content/${id}/label`, 'метки страницы')
    return res.results.map((l) => l.name)
  }

  async addLabels(id: string, names: readonly string[]): Promise<void> {
    if (!names.length) return
    await this.call('POST', `/rest/api/content/${id}/label`, 'метки страницы', names.map((name) => ({ prefix: 'global', name })))
  }

  async attachments(id: string): Promise<AttachmentInfo[]> {
    const res = await this.call<{ results: Array<{ id: string; title: string; extensions?: { fileSize?: number; comment?: string } }> }>(
      'GET', `/rest/api/content/${id}/child/attachment?limit=200`, 'вложения страницы')
    return res.results.map((a) => ({ id: String(a.id), title: a.title, ...(a.extensions?.fileSize !== undefined ? { size: a.extensions.fileSize } : {}), ...(a.extensions?.comment ? { comment: a.extensions.comment } : {}) }))
  }

  /** Загрузить вложение; есть с тем же именем — новой версией его же. Имя — из ответа Confluence. */
  async upload(pageId: string, file: { name: string; data: Buffer; contentType: string; comment: string }, existingId?: string): Promise<AttachmentInfo> {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.name)
    form.append('comment', file.comment)
    form.append('minorEdit', 'true')
    const path = existingId ? `/rest/api/content/${pageId}/child/attachment/${existingId}/data` : `/rest/api/content/${pageId}/child/attachment`
    const res = await this.call<{ id?: string; title?: string; results?: Array<{ id: string; title: string }> }>('POST', path, `вложение ${file.name}`, undefined, { form })
    const got = res.results?.[0] ?? res
    return { id: String(got.id ?? existingId ?? ''), title: got.title ?? file.name }
  }
}

// ── Выбор родительской страницы ───────────────────────────────────────────

/** Что ввёл пользователь в поле поиска: ссылку на страницу, её id или название. */
export type PageRef = { pageId: string } | { space: string; title: string } | { query: string } | { tiny: string }

export function parsePageRef(input: string): PageRef | undefined {
  const text = input.trim()
  if (!text) return undefined
  if (/^\d{1,20}$/.test(text)) return { pageId: text }
  if (/^https?:\/\//i.test(text)) {
    const link = confluenceLink(text)
    if (link) return link
    try {
      const url = new URL(text)
      // Короткая ссылка «Поделиться» (/x/AbCd) id не содержит — без входа её не раскрыть.
      if (/^(?:\/[^/]+)?\/x\/[\w-]+\/?$/.test(url.pathname)) return { tiny: text }
      const pageId = url.searchParams.get('pageId')
      if (pageId && /^\d{1,20}$/.test(pageId)) return { pageId }
    } catch { /* не ссылка */ }
    return { query: text }
  }
  return { query: text.slice(0, 200) }
}

export type CandidateSource = 'previous' | 'sibling' | 'sources' | 'search'

export interface ParentCandidate {
  id: string
  title: string
  space?: string
  url?: string
  source: CandidateSource
  /** Место в выдаче поиска (с 0) — для source=search. */
  rank?: number
  /** Пояснение: какой запрос, какая похожая страница. */
  via?: string
}

export interface ParentSuggestion { id: string; title: string; space?: string; url?: string; score: number; reasons: string[] }

const WEIGHT: Record<CandidateSource, number> = { previous: 4, sibling: 3, sources: 2, search: 1 }

/**
 * ТОП-N родительских страниц: детерминированно — одинаковые кандидаты в любом порядке дают
 * один и тот же список. Очки: прошлые публикации портала (сюда уже клали БФТ) > родитель
 * похожего БФТ > страницы из материалов и разведки заявки > выдача поиска (чем выше, тем
 * больше). Страница, где в названии «БФТ»/«требования», — +1: похоже на раздел для БФТ;
 * шаблон — −3: класть под него нельзя.
 */
export function rankParents(candidates: readonly ParentCandidate[], options: { limit?: number; exclude?: readonly string[] } = {}): ParentSuggestion[] {
  const exclude = new Set(options.exclude ?? [])
  const byId = new Map<string, ParentSuggestion>()
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id) || a.source.localeCompare(b.source) || (a.rank ?? 0) - (b.rank ?? 0) || (a.via ?? '').localeCompare(b.via ?? ''))
  for (const c of sorted) {
    if (!/^\d{1,20}$/.test(c.id) || exclude.has(c.id)) continue
    const s = byId.get(c.id) ?? { id: c.id, title: c.title, score: 0, reasons: [], ...(c.space ? { space: c.space } : {}), ...(c.url ? { url: c.url } : {}) }
    if (!s.space && c.space) s.space = c.space
    if (!s.url && c.url) s.url = c.url
    const bonus = c.source === 'search' ? WEIGHT.search * (1 + 1 / (1 + (c.rank ?? 9))) : WEIGHT[c.source]
    s.score += bonus
    if (c.source === 'search') {
      // Все запросы, которыми нашлась страница, — одной причиной.
      const at = s.reasons.findIndex((r) => r.startsWith('найдено поиском'))
      const q = c.via ? `«${c.via}»` : ''
      if (at < 0) s.reasons.push(q ? `найдено поиском: ${q}` : 'найдено поиском')
      else if (q && !s.reasons[at]!.includes(q)) s.reasons[at] = s.reasons[at]!.includes(':') ? `${s.reasons[at]}, ${q}` : `найдено поиском: ${q}`
    } else {
      const reason = c.source === 'previous' ? 'сюда уже публиковали БФТ из портала'
        : c.source === 'sibling' ? `здесь лежит похожий БФТ${c.via ? ` «${c.via}»` : ''}`
        : 'страница из материалов и разведки заявки'
      if (!s.reasons.includes(reason)) s.reasons.push(reason)
    }
    byId.set(c.id, s)
  }
  for (const s of byId.values()) {
    if (/БФТ|требовани/i.test(s.title)) s.score += 1
    // Шаблон страницы — не раздел для БФТ, хотя «БФТ» в названии есть.
    if (/^\s*шаблон|\bшаблон\b|template/i.test(s.title)) s.score -= 3
  }
  return [...byId.values()]
    .map((s) => ({ ...s, score: Math.round(s.score * 1000) / 1000, reasons: s.reasons.slice(0, 3) }))
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id))
    .slice(0, options.limit ?? 5)
}

/** Запросы поиска родителя по заявке: название без «[БФТ] slug:», короткие сочетания, системы. */
export function parentQueries(title: string, systems: readonly string[] = []): string[] {
  const name = title.replace(/^\[БФТ\][^:]*:\s*/, '').replace(/\[[^\]]*\]/g, ' ').replace(/[«»"]/g, ' ').replace(/\s+/g, ' ').trim()
  const words = name.split(' ').filter((w) => w.length >= 4 && !/^(для|через|после|перед|между|который|которые)$/i.test(w))
  const out = [name, words.slice(0, 3).join(' '), ...systems.map((s) => `${s} БФТ`), ...systems]
  return [...new Set(out.map((q) => q.trim()).filter((q) => q.length >= 3))].slice(0, 6)
}

/** Confluence-страницы из карты находок (sources.md): «Ссылка для БФТ: [..](url)». */
export function sourcePages(sourcesMd: string): Array<{ id: string; title: string; url: string }> {
  const out: Array<{ id: string; title: string; url: string }> = []
  for (const block of sourcesMd.split(/\n(?=## )/)) {
    const title = /^## (.+)$/m.exec(block)?.[1]?.trim()
    const url = /^Ссылка для БФТ:.*\]\(([^)\s]+)\)/m.exec(block)?.[1]
    if (!title || !url) continue
    const ref = confluenceLink(url)
    if (ref && 'pageId' in ref) out.push({ id: ref.pageId, title, url })
  }
  return out
}

// ── Состояние публикации заявки ──────────────────────────────────────────

export interface ParentRef { id: string; title: string; space?: string; url?: string }

export interface PublishState {
  /** Номер последнего прогона — workflowId `bft-<taskId>-confluence-<runs>`. */
  runs: number
  workflowId?: string
  parent?: ParentRef
  pageId?: string
  url?: string
  title?: string
  version?: number
  publishedAt?: string
  /** sha256 последних загруженных вложений по имени: то же содержимое второй раз не грузим. */
  attachments?: Record<string, string>
}

const STATE_FILE = 'confluence-publish.json'

export async function readPublishState(dir: string): Promise<PublishState> {
  const raw = await readFile(join(dir, STATE_FILE), 'utf8').then((t) => JSON.parse(t) as Partial<PublishState>, () => ({} as Partial<PublishState>))
  return { ...raw, runs: raw.runs ?? 0 }
}

export async function writePublishState(dir: string, state: PublishState): Promise<void> {
  await writeFile(join(dir, STATE_FILE), JSON.stringify(state, null, 2), 'utf8')
}

export async function updatePublishState(dir: string, patch: Partial<PublishState>): Promise<PublishState> {
  const next = { ...(await readPublishState(dir)), ...patch }
  await writePublishState(dir, next)
  return next
}

export const publishWorkflowId = (taskId: number, run: number): string => `bft-${taskId}-confluence-${run}`

// ── Активности ConfluencePublish ─────────────────────────────────────────

/** Копия bft-flow/src/publish.ts. */
export interface PublishRequest { taskId: number; slug: string; sessionId: string; parent: ParentRef; by?: string; run: number }
export interface FileRef { path: string; sha256: string; name: string; contentType: string; size: number }
export interface RenderResult { title: string; labels: string[]; body: FileRef; attachments: FileRef[]; warnings: string[] }
export interface PageResult { pageId: string; url: string; version: number; mode: 'create' | 'update'; title: string }
export interface AttachResult { uploaded: string[]; skipped: string[]; names: Record<string, string> }
export interface FinishResult { url: string; pageId: string }
export interface AncestorInfo { id: string; space?: string; parent?: { id: string; title: string } }

export interface PublishActivities {
  confluenceRender(req: PublishRequest): Promise<RenderResult>
  confluenceUpsertPage(req: PublishRequest, render: RenderResult): Promise<PageResult>
  confluenceAttach(req: PublishRequest, render: RenderResult, page: PageResult): Promise<AttachResult>
  confluenceFinish(req: PublishRequest, render: RenderResult, page: PageResult, attach: AttachResult): Promise<FinishResult>
  /** Родители страниц (для ТОП-5: «здесь лежит похожий БФТ»); нет ключа — пусто. */
  confluenceAncestors(ids: string[]): Promise<AncestorInfo[]>
  /** Проверка ключа записи для «Ключи и доступы» (ADR-0030). */
  confluenceWhoAmI(): Promise<{ ok: boolean; text: string }>
}

/** Активность портала: итог отправки — комментарием в задачу и записью в хронику цикла. */
export interface AnnounceActivities {
  confluenceAnnounce(req: PublishRequest, page: { pageId: string; url: string; mode: 'create' | 'update' }): Promise<void>
}

/** Ошибка, которую повторять бессмысленно: Temporal её не повторяет (nonRetryableErrorTypes). */
export const REJECTED = 'ConfluenceRejected'

export interface PublishDeps {
  /** Папка заявки и путь к полному БФТ. */
  files(slug: string): { dir: string; md: string }
  writer(): ConfluenceWriter | undefined
  /** Выгрузка .docx/.pdf (export.ts) — путь к готовому файлу. */
  exportDoc(slug: string, md: string, format: 'docx' | 'pdf'): Promise<string>
  /** Схема PlantUML → PNG; не вышло — undefined (тогда схема кодом с пометкой). */
  renderPng?(source: string, outPng: string): Promise<boolean>
  now?(): string
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')

async function fileRef(path: string, name: string, contentType: string): Promise<FileRef> {
  const data = await readFile(path)
  return { path, name, contentType, sha256: sha256(data), size: data.length }
}

/** Ошибка для Temporal: тип REJECTED — не повторять. Активность бросает ApplicationFailure. */
async function fail(message: string, retryable: boolean): Promise<never> {
  const { ApplicationFailure } = await import('@temporalio/activity')
  throw retryable ? ApplicationFailure.retryable(message, 'ConfluenceRetry') : ApplicationFailure.nonRetryable(message, REJECTED)
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ConfluenceError) return fail(e.message, e.retryable)
    if ((e as { name?: string }).name === 'ApplicationFailure') throw e
    return fail((e as Error).message ?? String(e), true)
  }
}

export function plantumlPng(source: string, outPng: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dir = outPng.replace(/\/[^/]+$/, '')
    const puml = outPng.replace(/\.png$/, '.puml')
    const src = source.replace(/^@startuml.*$/m, (head) => `${head}\nskinparam dpi 150\nskinparam defaultFontName "DejaVu Sans"`)
    writeFile(puml, src, 'utf8').then(() => {
      execFile('plantuml', ['-tpng', '-charset', 'UTF-8', puml], { cwd: dir, timeout: 120_000, env: { ...process.env, JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true' } },
        (error) => resolve(!error))
    }, () => resolve(false))
  })
}

export function publishActivities(deps: PublishDeps): PublishActivities {
  const now = deps.now ?? (() => new Date().toISOString())
  const writer = async () => deps.writer() ?? fail('Публикация в Confluence не настроена: администратору — добавить CONFLUENCE_PUBLISH_URL и CONFLUENCE_PUBLISH_TOKEN.', false)

  return {
    async confluenceRender(req) {
      return guard(async () => {
        const { dir, md } = deps.files(req.slug)
        const markdown = await readFile(md, 'utf8').catch(() => '')
        if (!markdown.trim()) return fail('Полный БФТ ещё не собран — публиковать нечего.', false)
        const out = join(dir, 'confluence')
        await rm(out, { recursive: true, force: true })
        await mkdir(out, { recursive: true })
        const warnings: string[] = []
        const sources = plantumlSources(markdown)
        const names: (string | undefined)[] = []
        const attachments: FileRef[] = []
        for (const [i, source] of sources.entries()) {
          const name = diagramFileName(i + 1)
          const ok = deps.renderPng ? await deps.renderPng(source, join(out, name)) : false
          if (ok) {
            names.push(name)
            attachments.push(await fileRef(join(out, name), name, 'image/png'))
          } else {
            names.push(undefined)
            warnings.push(`Схема ${i + 1} не отрендерилась — на странице исходником с пометкой [УТОЧНИТЬ]`)
          }
        }
        const page = bftToStorage(markdown, { diagrams: names })
        const bodyPath = join(out, 'page.xhtml')
        await writeFile(bodyPath, page.body, 'utf8')
        for (const format of ['docx', 'pdf'] as const) {
          try {
            const path = await deps.exportDoc(req.slug, md, format)
            const contentType = format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf'
            attachments.push(await fileRef(path, `${req.slug}.${format}`, contentType))
          } catch (e) {
            warnings.push(`Выгрузка .${format} не собралась — вложение пропущено (${(e as Error).message.slice(0, 120)})`)
          }
        }
        return { title: page.title, labels: page.labels, body: await fileRef(bodyPath, 'page.xhtml', 'application/xhtml+xml'), attachments, warnings }
      })
    },

    async confluenceUpsertPage(req, render) {
      return guard(async () => {
        const client = await writer()
        const { dir } = deps.files(req.slug)
        const body = await readFile(render.body.path, 'utf8')
        if (sha256(body) !== render.body.sha256) return fail('Документ изменился во время отправки — отправьте ещё раз.', false)
        const parent = await client.getPage(req.parent.id)
        if (!parent) return fail(`Родительская страница «${req.parent.title}» не найдена или к ней нет доступа у ключа публикации. Выберите другую.`, false)
        const state = await readPublishState(dir)
        let existing = state.pageId ? await client.getPage(state.pageId) : undefined
        if (!existing) {
          // Страница из прошлой отправки удалена (или не записалась) — ищем свою по названию в пространстве родителя.
          const same = await client.findByTitle(parent.space.key, render.title)
          if (same) {
            const mine = render.labels.filter((l) => l !== 'bft')
            const own = mine.length > 0 && (await client.labels(same.id)).some((l) => mine.includes(l))
            if (!own) return fail(`В пространстве ${parent.space.key} уже есть страница «${render.title}», созданная не порталом. Переименуйте её или выберите другое пространство.`, false)
            existing = same
          }
        }
        const page = existing
          ? await client.updatePage({ id: existing.id, version: existing.version, spaceKey: existing.space.key || parent.space.key, parentId: parent.id, title: render.title, body })
          : await client.createPage({ spaceKey: parent.space.key, parentId: parent.id, title: render.title, body })
        await client.addLabels(page.id, render.labels)
        await updatePublishState(dir, {
          pageId: page.id, url: page.url, title: page.title, version: page.version,
          parent: { id: parent.id, title: parent.title, space: parent.space.key, url: parent.url },
        })
        return { pageId: page.id, url: page.url, version: page.version, mode: existing ? 'update' as const : 'create' as const, title: page.title }
      })
    },

    async confluenceAttach(req, render, page) {
      return guard(async () => {
        const client = await writer()
        const { dir } = deps.files(req.slug)
        const state = await readPublishState(dir)
        const sent = { ...(state.attachments ?? {}) }
        const existing = await client.attachments(page.pageId)
        const uploaded: string[] = []
        const skipped: string[] = []
        const names: Record<string, string> = {}
        for (const file of render.attachments) {
          const have = existing.find((a) => a.title === file.name)
          if (have && sent[file.name] === file.sha256) {
            skipped.push(file.name)
            names[file.name] = have.title
            continue
          }
          const data = await readFile(file.path)
          if (sha256(data) !== file.sha256) return fail(`Вложение ${file.name} изменилось во время отправки — отправьте ещё раз.`, false)
          const got = await client.upload(page.pageId, { name: file.name, data, contentType: file.contentType, comment: 'Портал БФТ' }, have?.id)
          names[file.name] = got.title
          uploaded.push(file.name)
          sent[file.name] = file.sha256
          // Записываем после каждого файла: повтор активности не грузит уже загруженное.
          await updatePublishState(dir, { attachments: sent })
        }
        return { uploaded, skipped, names }
      })
    },

    async confluenceFinish(req, render, page, attach) {
      return guard(async () => {
        const { dir } = deps.files(req.slug)
        // Confluence переименовал схему (нормализация имени) — подставить имя из ответа загрузки (ЗМ-015 п.4).
        const renamed = Object.entries(attach.names).filter(([from, to]) => from !== to && from.endsWith('.png'))
        let final = page
        if (renamed.length) {
          const client = await writer()
          let body = await readFile(render.body.path, 'utf8')
          for (const [from, to] of renamed) body = body.split(`ri:filename="${from}"`).join(`ri:filename="${to.replace(/"/g, '&quot;')}"`)
          const current = await client.getPage(page.pageId)
          if (!current) return fail('Страница пропала из Confluence во время отправки — отправьте ещё раз.', false)
          const parentId = current.ancestors[current.ancestors.length - 1]?.id ?? req.parent.id
          const updated = await client.updatePage({ id: page.pageId, version: current.version, spaceKey: current.space.key, parentId, title: render.title, body })
          final = { ...page, version: updated.version, url: updated.url }
        }
        const at = now()
        await updatePublishState(dir, { publishedAt: at, version: final.version, url: final.url })
        // Тот же файл, что пишет MCP bft_record_publication: список БФТ и агенты видят ссылку.
        await writeFile(join(dir, 'confluence.json'), JSON.stringify({ url: final.url, at, by: req.by ?? 'портал', pageId: final.pageId }), 'utf8')
        return { url: final.url, pageId: final.pageId }
      })
    },

    async confluenceWhoAmI() {
      const client = deps.writer()
      if (!client) return { ok: false, text: 'не настроено: нет адреса CONFLUENCE_PUBLISH_URL или ключа CONFLUENCE_PUBLISH_TOKEN' }
      return client.whoAmI()
    },

    async confluenceAncestors(ids) {
      const client = deps.writer()
      if (!client) return []
      const out: AncestorInfo[] = []
      for (const id of ids.filter((x) => /^\d{1,20}$/.test(x)).slice(0, 8)) {
        const page = await client.getPage(id).catch(() => undefined)
        if (!page) continue
        const parent = page.ancestors[page.ancestors.length - 1]
        out.push({ id, ...(page.space.key ? { space: page.space.key } : {}), ...(parent ? { parent } : {}) })
      }
      return out
    },
  }
}
