/**
 * Локальный журнал работы над требованиями.
 *
 * Зачем он есть. Модель, начиная работу над БФТ, каждый раз стартовала с нуля:
 * что уже разбирали, какие развилки закрыли и чем кончился прошлый заход —
 * знал только PO, и переносил это руками. Журнал делает отрезки работы
 * записанными: у каждого есть эпик, стадия, чем закончился и ссылка на ветку
 * контекстного чата в entire.io. Следующий заход начинается не с пустого места,
 * а с последнего закрытого отрезка.
 *
 * Журнал локальный и рабочий: он не часть БФТ-документа и в Confluence не
 * едет. Поэтому и живёт рядом с индексом воркспейса, а не во frontmatter —
 * состав frontmatter фиксирован стандартом, и класть туда состояние процесса
 * значило бы менять документ на каждый заход модели.
 *
 * Все функции здесь чистые: журнал приходит и уходит значением. Чтение и запись
 * файла — на host-слое.
 */
import type { BftStage } from './model.js'

export const WORKLOG_FILE = 'bft-worklog.json'
export const WORKLOG_VERSION = 1

/**
 * Состояние сессии харнесса, в которой шёл отрезок.
 *
 * `running` — агент ходит; `idle` — сессия ждёт PO (ответить, отправить следующий
 * шаг); `failed` — агент упал или сессия оборвалась: была `running` на момент
 * перезапуска харнесса; `gone` — сессию удалили. Это состояние работы, а не
 * документа: стадия про артефакты, состояние — про то, идёт ли по ним кто-то.
 */
export type SessionState = 'running' | 'idle' | 'failed' | 'gone'

export interface WorkEntry {
  epic: string
  /** Стадия на момент начала отрезка. */
  stage: BftStage
  startedAt: string
  /** Отрезок закрыт. Незакрытый даты не имеет — работа ещё идёт. */
  finishedAt?: string
  /** Чем закончился отрезок, одной строкой. Пусто у незакрытого. */
  summary?: string
  /** Ветка entire.io с контекстным чатом этого отрезка. */
  contextRef?: string
  /** Сессия харнесса, в которой шёл отрезок: по ней PO возвращается в тот же чат. */
  sessionId?: string
  sessionState?: SessionState
  /** Последнее движение в сессии — ход агента, отправка PO, открытие черновика. */
  lastActivityAt?: string
}

/** Последняя сессия по требованию — то, что показывают в строке очереди и превью. */
export interface TaskSession {
  id: string
  state: SessionState
  lastActivityAt: string
}

export interface WorkLog {
  version: number
  entries: WorkEntry[]
}

export const EMPTY_LOG: WorkLog = { version: WORKLOG_VERSION, entries: [] }

/**
 * Разбор журнала. Битый или чужой формат — пустой журнал, а не исключение:
 * потерять историю неприятно, но уронить из-за неё раздел хуже. Сам факт
 * потери виден по `parseWorkLog(...).entries.length === 0` на непустом файле.
 */
export function parseWorkLog(text: string | null): WorkLog {
  if (!text) return EMPTY_LOG
  try {
    const raw = JSON.parse(text) as Partial<WorkLog>
    if (!Array.isArray(raw.entries)) return EMPTY_LOG
    return {
      version: typeof raw.version === 'number' ? raw.version : WORKLOG_VERSION,
      entries: raw.entries.filter(isEntry),
    }
  } catch {
    return EMPTY_LOG
  }
}

function isEntry(value: unknown): value is WorkEntry {
  const entry = value as WorkEntry | null
  return !!entry && typeof entry.epic === 'string' && typeof entry.startedAt === 'string'
}

export function serializeWorkLog(log: WorkLog): string {
  return `${JSON.stringify(log, null, 2)}\n`
}

/** Отрезки одного эпика, свежие первыми. */
export function entriesFor(log: WorkLog, epic: string): WorkEntry[] {
  return log.entries
    .filter(entry => entry.epic === epic)
    .sort((a, b) => (b.startedAt > a.startedAt ? 1 : b.startedAt < a.startedAt ? -1 : 0))
}

/**
 * Последний закрытый отрезок — то, с чего продолжать. Незакрытые сюда не идут:
 * работа, брошенная посередине, контекстом для следующего захода не является.
 */
export function lastFinished(log: WorkLog, epic: string): WorkEntry | null {
  return entriesFor(log, epic).find(entry => !!entry.finishedAt) ?? null
}

/** Незакрытый отрезок эпика, если он есть. Их не может быть больше одного. */
export function openEntry(log: WorkLog, epic: string): WorkEntry | null {
  return entriesFor(log, epic).find(entry => !entry.finishedAt) ?? null
}

/**
 * Начать отрезок. Незакрытый отрезок того же эпика возвращается как есть:
 * два параллельных захода по одному требованию — не история, а путаница.
 */
export function startWork(log: WorkLog, entry: WorkEntry): WorkLog {
  if (openEntry(log, entry.epic)) return log
  return { ...log, entries: [...log.entries, entry] }
}

/**
 * Привязать сессию харнесса к работе по эпику.
 *
 * Открытый отрезок есть — сессия пишется в него: самый свежий чат и есть «где
 * работали». Отрезка нет («Работать в чате» по требованию, у которого стадия не
 * менялась) — открывается новый: чат по требованию — это отрезок работы.
 */
export function attachSession(
  log: WorkLog,
  epic: string,
  stage: BftStage,
  sessionId: string,
  at: string,
): WorkLog {
  const open = openEntry(log, epic)
  const patch = { sessionId, sessionState: 'idle' as const, lastActivityAt: at }
  if (open) {
    return { ...log, entries: log.entries.map(entry => (entry === open ? { ...entry, ...patch } : entry)) }
  }
  return { ...log, entries: [...log.entries, { epic, stage, startedAt: at, ...patch }] }
}

/**
 * Состояние сессии изменилось. Сессия неизвестна журналу — журнал не меняется:
 * чужие чаты раздел не отслеживает.
 */
export function touchSession(log: WorkLog, sessionId: string, state: SessionState, at: string): WorkLog {
  if (!log.entries.some(entry => entry.sessionId === sessionId)) return log
  return {
    ...log,
    entries: log.entries.map(entry => (entry.sessionId === sessionId
      ? { ...entry, sessionState: state, lastActivityAt: at }
      : entry)),
  }
}

/**
 * Харнесс поднялся заново: всё, что числилось «агент ходит», оборвалось на
 * перезапуске. Ровно тот случай, который PO называет «сессия прервалась».
 */
export function markInterrupted(log: WorkLog, at: string): WorkLog {
  if (!log.entries.some(entry => entry.sessionState === 'running')) return log
  return {
    ...log,
    entries: log.entries.map(entry => (entry.sessionState === 'running'
      ? { ...entry, sessionState: 'failed' as const, lastActivityAt: at }
      : entry)),
  }
}

/** Последняя сессия по эпику — по последнему движению, а не по началу отрезка. */
export function lastSession(log: WorkLog, epic: string): TaskSession | null {
  let best: WorkEntry | null = null
  for (const entry of log.entries) {
    if (entry.epic !== epic || !entry.sessionId) continue
    const at = entry.lastActivityAt ?? entry.startedAt
    const bestAt = best ? (best.lastActivityAt ?? best.startedAt) : ''
    if (!best || at > bestAt) best = entry
  }
  if (!best?.sessionId) return null
  return { id: best.sessionId, state: best.sessionState ?? 'idle', lastActivityAt: best.lastActivityAt ?? best.startedAt }
}

/** Закрыть отрезок эпика. Открытого нет — журнал не меняется. */
export function finishWork(
  log: WorkLog,
  epic: string,
  finishedAt: string,
  summary: string,
  contextRef?: string,
): WorkLog {
  const open = openEntry(log, epic)
  if (!open) return log
  return {
    ...log,
    entries: log.entries.map(entry =>
      entry === open ? { ...entry, finishedAt, summary, contextRef: contextRef ?? entry.contextRef } : entry,
    ),
  }
}
