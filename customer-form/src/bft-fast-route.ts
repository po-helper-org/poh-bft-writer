/**
 * Страница БФТ заявки — маршрут `customer-form.bftFast` (вкладка Information и
 * ссылка из чата). Собирает страницу из частей состояния заявки на диске:
 * быстрая версия (`<slug>-fast.html/.md`, approval.json, primary.json), полный
 * БФТ (deep.json, `<slug>.html`), форма вопросов и входящие (слой формы),
 * «Планирование», «Отправить в Confluence», единый стиль.
 *
 * Состояние бывает неполным и нестандартным: файл не дописан, JSON битый, у
 * старой заявки нет поля. Ни одна такая часть не роняет страницу в 500: что
 * можно — показываем, про недостающее — строка-пояснение вверху страницы.
 */
import { readFile } from 'node:fs/promises'
import { fastFiles, fastPagePath, fastSlug, fastState, stillBuilding, type FastProgress } from './bft-fast.js'
import { deepFiles, type DeepState } from './bft-deep.js'
import { customerDeepPage, customerFastPage, deepFailedPage, waitingPage, type CustomerLayer } from './fast-page.js'
import type { DeepFormLayer } from './form-page.js'
import type { AcceptanceDemo } from './demo.js'
import type { PrimaryDoc } from './primary.js'
import { UNASSIGNED, type OpenQuestion } from './questions.js'
import { withAgent } from './agent-page.js'
import { withPlan } from './plan-routes.js'
import { withConfluence } from './confluence-publish-page.js'
import { withPageTheme } from './page-theme.js'

export interface BftFastDeps {
  /** Каталог быстрых версий (FAST_ROOT). */
  root: string
  /** Заявка сессии; нет — страницы нет. */
  ticket(sessionId: string): Promise<{ taskId: number } | undefined>
  /** Идёт сборка быстрой версии (rev16) — экран ожидания. */
  progress(sessionId: string): FastProgress | undefined
  /** Согласованный сценарий приёмки. */
  demo(sessionId: string): AcceptanceDemo | undefined
  /** Слой формы вопросов и входящих (ADR-0018, ADR-0026); нет формы — undefined. */
  formLayer(slug: string, sessionId: string): Promise<DeepFormLayer | undefined>
  /** Адрес соседнего маршрута портала (siblingHref). */
  href(path: string): string
  /** Страница «Настройки» администратора. */
  settingsHref: string
  log?(message: string, error: unknown): void
}

const HTML = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const notBuilt = () => new Response('<!doctype html><meta charset="utf-8"><p style="font:14px sans-serif;color:#888;padding:16px">Быстрая версия БФТ ещё не собрана.</p>',
  { status: 404, headers: HTML })

const STAGES: readonly string[] = ['building', 'ready', 'failed']

/** deep.json: нет файла — undefined; не читается или не той формы — 'broken'. */
export async function readDeepStateLenient(path: string): Promise<DeepState | 'broken' | undefined> {
  const raw = await readFile(path, 'utf8').catch(() => undefined)
  if (raw === undefined) return undefined
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return 'broken' }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'broken'
  const state = parsed as Partial<DeepState>
  if (typeof state.stage !== 'string' || !STAGES.includes(state.stage)) return 'broken'
  return {
    ...state,
    stage: state.stage,
    startedAt: typeof state.startedAt === 'string' ? state.startedAt : '',
    questions: Array.isArray(state.questions) ? openQuestions(state.questions) : undefined,
  } as DeepState
}

/** Вопросы deep.json: только записи с текстом; адресат и ссылки — по умолчанию. */
function openQuestions(list: unknown[]): OpenQuestion[] {
  return list.flatMap((q) => {
    if (!q || typeof q !== 'object') return []
    const { text, addressee, refs } = q as Partial<OpenQuestion>
    if (typeof text !== 'string' || !text.trim()) return []
    return [{ ...(q as OpenQuestion), addressee: typeof addressee === 'string' && addressee ? addressee : UNASSIGNED, refs: Array.isArray(refs) ? refs : [] }]
  })
}

/** primary.json: только то, что читает страница, и только правильной формы. */
async function readPrimary(path: string): Promise<Pick<CustomerLayer, 'people' | 'brief'> | 'broken' | undefined> {
  const raw = await readFile(path, 'utf8').catch(() => undefined)
  if (raw === undefined) return undefined
  let doc: Partial<PrimaryDoc>
  try { doc = JSON.parse(raw) as Partial<PrimaryDoc> } catch { return 'broken' }
  if (!doc || typeof doc !== 'object') return 'broken'
  const people = Array.isArray(doc.args?.people) ? doc.args.people.filter((p) => p && typeof p === 'object' && typeof p.name === 'string') : []
  return { people, ...(doc.brief && typeof doc.brief === 'object' ? { brief: doc.brief } : {}) }
}

/** Пояснение вверху страницы: что из заявки не удалось показать. */
export function withNotes(page: string, notes: readonly string[]): string {
  if (!notes.length) return page
  const box = `<div class="bft-state-notes" role="status" style="margin:12px auto;max-width:960px;padding:10px 14px;border:1px solid #d9a400;background:#fff8e1;color:#5a4500;font:14px/1.45 system-ui,sans-serif;border-radius:6px">`
    + `<b>Показано не всё из заявки.</b><ul style="margin:.3rem 0 0;padding-left:1.2rem">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
  const body = /<body[^>]*>/i.exec(page)
  return body ? page.slice(0, body.index + body[0].length) + box + page.slice(body.index + body[0].length) : box + page
}

/** Ответ маршрута `customer-form.bftFast` для адреса запроса. */
export async function bftFastPage(url: URL, deps: BftFastDeps): Promise<Response> {
  const log = deps.log ?? ((m, e) => console.error(`[customer-form] bftFast: ${m}:`, e))
  const notes: string[] = []
  /** Необязательный слой страницы: упал — страница без него и строка в пояснении. */
  const layer = async (page: string, name: string, apply: (page: string) => string | Promise<string>): Promise<string> => {
    try { return await apply(page) } catch (e) { log(name, e); notes.push(`${name}: не удалось показать (${e instanceof Error ? e.message : String(e)}).`); return page }
  }
  const params = url.searchParams
  const sessionId = params.get('session') ?? ''
  const ticket = sessionId ? await deps.ticket(sessionId).catch(() => undefined) : undefined
  if (!ticket) return notBuilt()
  const slug = fastSlug(ticket.taskId)
  const files = fastFiles(deps.root, slug)
  // Идёт сборка (rev16) — экран ожидания; он сам перезагрузится в документ.
  const progress = deps.progress(sessionId)
  if (progress && await stillBuilding(progress, files).catch(() => false)) {
    return new Response(waitingPage(sessionId, progress, deps.href('/api/customer-form.bftFastStatus')), { headers: HTML })
  }
  const html = await readFile(files.html, 'utf8').catch(() => undefined)
  if (!html) return notBuilt()
  // ?full=1 — канонический bft-fast навыка как есть (он же в заявке).
  if (params.has('full')) return new Response(html, { headers: HTML })

  // approval.json и <slug>-fast.md читаются терпимо (fastState): нет или битый — «не согласовано».
  const state = await fastState(files).catch((e) => { log('состояние согласования', e); return undefined })
  // Первичные требования согласованы — та же вкладка показывает полный БФТ (ADR-0012);
  // ?view=fast — вернуться к первичным требованиям.
  if (state?.approvedAt && params.get('view') !== 'fast') {
    const deepPaths = deepFiles(files, slug)
    const deep = await readDeepStateLenient(deepPaths.state)
    const fastUrl = deps.href(`${fastPagePath(sessionId)}&view=fast`)
    if (deep === 'broken') notes.push('Состояние полного БФТ (deep.json) не читается — показаны первичные требования.')
    else if (deep?.stage === 'building') {
      return new Response(waitingPage(sessionId, { stage: 'building', startedAt: deep.startedAt }, deps.href('/api/customer-form.bftDeepStatus'), 'deep'), { headers: HTML })
    } else if (deep?.stage === 'failed') {
      return new Response(deepFailedPage(sessionId, String(deep.error ?? 'неизвестная ошибка'), deps.href('/api/customer-form.bftDeepRetry'), fastUrl), { headers: HTML })
    } else if (deep?.stage === 'ready') {
      const deepHtml = await readFile(deepPaths.html, 'utf8').catch(() => undefined)
      if (!deepHtml) notes.push('Полный БФТ отмечен собранным, но его страницы нет на диске — показаны первичные требования.')
      else {
        const page = await deepPage(deepHtml, deep, { sessionId, slug, fastUrl, deps, log, notes, layer })
        if (page) return new Response(page, { headers: HTML })
      }
    }
  }

  // Заказчику (rev21) — тот же документ: How to demo таблицей, зоны и контакты, без полей для PO.
  const primary = await readPrimary(files.primary)
  if (primary === 'broken') notes.push('Первичные данные заявки (primary.json) не читаются — без зон и контактов.')
  const demo = deps.demo(sessionId)
  const validDemo = demo && Array.isArray(demo.steps) ? demo : undefined
  if (demo && !validDemo) notes.push('Сценарий приёмки сохранён не полностью — How to demo показан списком.')
  const page = await layer(html, 'Слой заказчика', (base) => customerFastPage(base, {
    sessionId, slug, approveUrl: deps.href('/api/customer-form.bftFastApprove'),
    ...(state?.approvedAt ? { approvedAt: state.approvedAt } : {}),
    ...(validDemo ? { demo: validDemo } : {}),
    ...(primary && primary !== 'broken' ? primary : {}),
  }))
  return new Response(withNotes(page, notes), { headers: HTML })
}

interface DeepCtx {
  sessionId: string; slug: string; fastUrl: string; deps: BftFastDeps
  log: (m: string, e: unknown) => void; notes: string[]
  layer: (page: string, name: string, apply: (page: string) => string | Promise<string>) => Promise<string>
}

/** Полный БФТ со слоями; сам документ не собирается — undefined (покажем первичные требования). */
async function deepPage(deepHtml: string, deep: DeepState, { sessionId, slug, fastUrl, deps, log, notes, layer }: DeepCtx): Promise<string | undefined> {
  const form = await deps.formLayer(slug, sessionId).catch((e) => {
    log('слой формы вопросов', e)
    notes.push('Форма вопросов и входящие ответы: не удалось прочитать — вопросы показаны списком.')
    return undefined
  })
  // Сначала со всеми частями; сломалась часть — без неё: без формы, затем и без вопросов.
  const tries: { questions: DeepState['questions']; form: DeepFormLayer | undefined; note?: string }[] = [
    { questions: deep.questions, form },
    ...(form ? [{ questions: deep.questions, form: undefined, note: 'Форма вопросов: не удалось показать на странице — вопросы показаны списком.' }] : []),
    ...(deep.questions?.length ? [{ questions: undefined, form: undefined, note: 'Вопросы для согласования: не удалось показать.' }] : []),
  ]
  let page: string | undefined
  for (const t of tries) {
    try { page = customerDeepPage(deepHtml, sessionId, fastUrl, t.questions, t.form); if (t.note) notes.push(t.note); break } catch (e) { log('страница полного БФТ', e) }
  }
  if (page === undefined) { notes.push('Полный БФТ не удалось показать — показаны первичные требования.'); return undefined }
  // ИИ-агент правок (ADR-0021): колонка справа — замечания со страницы сразу в документ.
  page = await layer(page, 'ИИ-агент правок', (p) => withAgent(p, {
    sessionId, store: `bft-comments-${slug}`, deepAt: deep.finishedAt ?? null,
    reviseUrl: deps.href('/api/customer-form.bftRevise'), statusUrl: deps.href('/api/customer-form.bftReviseStatus'), undoUrl: deps.href('/api/customer-form.bftReviseUndo'),
    sectionUrl: deps.href('/api/customer-form.bftReviseSection'), reviewUrl: deps.href('/api/customer-form.bftReview'), settingsUrl: deps.settingsHref,
  }))
  // «Планирование» (ADR-0025): кнопка вверху, сохранённая заметка и доска — артефактом внизу.
  page = await layer(page, 'Планирование', (p) => withPlan(p, sessionId, fastFiles(deps.root, slug).dir))
  // «Отправить в Confluence» (ADR-0028): вкладка в рейке и панель выбора страницы и хода отправки.
  page = await layer(page, 'Отправка в Confluence', (p) => withConfluence(p, sessionId))
  page = withNotes(page, notes)
  // Единый стиль страницы (ADR-0029) — последним слоем.
  return layer(page, 'Единый стиль страницы', withPageTheme)
}
