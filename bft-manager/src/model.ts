/**
 * Модель «Управления БФТ» (ADR-0009): статусы двух воронок и то, что видит
 * страница PO. Общая для узла и клиента — чистые данные и функции.
 *
 * Статус = колонка (bucket) канбан-вида Vikunja. Своих таблиц нет: всё, что
 * показывает страница, читается из трекера, всё, что она меняет, — пишется в него.
 */

/** Входящие запросы — корневые задачи с лейблом «запрос» (их заводит портал заказчика). */
export const REQUEST_STATUSES = [
  'Создан',
  'Ожидает PO',
  'Проработка БФТ',
  'Оценка',
  'В работу: влёт этого квартала',
  'В работу: в следующий квартал',
  'Отменено',
] as const

/** Воронка БФТ-требований — задачи «Проработка БФТ» с лейблом «бфт». */
export const BFT_STATUSES = [
  'Backlog',
  'Взято в аналитику',
  'Первичный БФТ',
  'Ожидает согласования',
  'Утвержден заказчиком',
  'Отменен',
] as const

/** В «Ожидает PO» запрос переходит только с ответственным; переход заводит проработку БФТ. */
export const STATUS_NEEDS_ASSIGNEE = 'Ожидает PO'

/** Финальные статусы: SLA на них не считается. */
export const FINAL_STATUSES: readonly string[] = ['Отменено', 'Отменен', 'Утвержден заказчиком', 'В работу: влёт этого квартала', 'В работу: в следующий квартал']

export type BoardKind = 'requests' | 'bft'

export interface Person {
  id: number
  username: string
  name: string
}

/** Связанная задача другой воронки: у запроса — его БФТ, у БФТ — его запросы. */
export interface LinkRef {
  id: number
  title: string
  status?: string
}

export interface Card {
  id: number
  title: string
  status: string
  bucketId: number
  /** С какого момента задача в текущем статусе (ISO). */
  since: string
  /** false — точного момента нет (задачу двигали в UI Vikunja без отметки), since = последнее изменение. */
  sinceExact: boolean
  created: string
  assignee: Person | null
  links: LinkRef[]
  /** Есть .html-шаблон БФТ во вложениях. */
  hasHtml: boolean
  url: string
}

export interface Column {
  bucketId: number
  title: string
  count: number
  cards: Card[]
}

export interface Board {
  kind: BoardKind
  viewId: number
  viewUrl: string
  columns: Column[]
}

export interface Overview {
  requests: Board
  bft: Board
  people: Person[]
  trackerUrl: string
  loadedAt: string
}

export interface MoveRequest {
  kind: BoardKind
  taskId: number
  status: string
  /** Ответственный: обязателен для «Ожидает PO», если у запроса его ещё нет. */
  assigneeId?: number
  /** Куда прикрепить запрос при «Ожидает PO»: id существующего БФТ или новая задача проработки. */
  attachTo?: number | 'new'
}

export interface MoveResult {
  card: Card
  /** Задача проработки БФТ, к которой прикреплён запрос (новая или существующая). */
  bft?: { id: number; title: string; created: boolean }
}

const DAY = 24 * 60 * 60 * 1000

/** Полных суток в статусе. */
export function daysSince(iso: string, now: number = Date.now()): number {
  const from = Date.parse(iso)
  return Number.isFinite(from) ? Math.max(0, Math.floor((now - from) / DAY)) : 0
}

/** Сколько висит — по-человечески: «5 ч», «3 дн». */
export function ageLabel(iso: string, now: number = Date.now()): string {
  const from = Date.parse(iso)
  if (!Number.isFinite(from)) return '—'
  const hours = Math.max(0, Math.floor((now - from) / (60 * 60 * 1000)))
  return hours < 24 ? `${hours} ч` : `${Math.floor(hours / 24)} дн`
}

export type SlaTone = 'neutral' | 'warning' | 'danger'

/** SLA в статусе: до 3 суток — норма, 3–7 — внимание, больше недели — просрочка. */
export function slaTone(status: string, iso: string, now: number = Date.now()): SlaTone {
  if (FINAL_STATUSES.includes(status)) return 'neutral'
  const days = daysSince(iso, now)
  return days >= 7 ? 'danger' : days >= 3 ? 'warning' : 'neutral'
}

/**
 * Отметка смены статуса — комментарий задачи Vikunja. Перемещение между
 * колонками не меняет даже `updated` задачи, поэтому момент входа в статус
 * хранится здесь: его видит и PO в карточке Vikunja.
 */
export function statusComment(from: string, to: string, extra = ''): string {
  return `<p>🔀 Статус: «${escapeHtml(from)}» → «${escapeHtml(to)}»</p>${extra}`
}

const STATUS_RE = /Статус: «(.+?)» → «(.+?)»/

/** Целевой статус из комментария-отметки (или undefined). */
export function statusOfComment(html: string): string | undefined {
  const m = STATUS_RE.exec(html.replace(/&laquo;/g, '«').replace(/&raquo;/g, '»'))
  return m ? unescapeHtml(m[2]) : undefined
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unescapeHtml(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
