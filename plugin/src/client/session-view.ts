/**
 * Как показать сессию по требованию: состояние и давность из двух источников.
 *
 * Узел (журнал работы) знает то, чего браузер не видит: `failed` — агент упал
 * или сессия оборвалась на перезапуске харнесса. Браузер (список сессий
 * харнесса) знает живое: существует ли сессия сейчас, ходит ли агент прямо в
 * эту секунду, когда она менялась. Итог берётся из обоих: живое — сильнее.
 *
 * Функции чистые, чтобы проверяться без React и без харнесса.
 */
import type { SessionState } from '../worklog.js'

/** Что журнал сказал о последней сессии требования (`BftTaskSummary.session`). */
export interface RecordedSession {
  id: string
  state: SessionState
  lastActivityAt: string
}

/** Что список сессий харнесса знает о ней сейчас; `null` — такой сессии больше нет. */
export interface LiveSession {
  title?: string
  running: boolean
  updatedAt: number
}

export interface SessionView {
  id: string
  state: SessionState
  /** Название чата, когда харнесс его уже дал. */
  title?: string
  /** Полных дней с последнего движения; 0 — сегодня. */
  days: number
  /** Есть куда открыть: сессия существует в харнессе. */
  canOpen: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

export function describeSession(
  recorded: RecordedSession | undefined,
  live: LiveSession | null | undefined,
  now: number = Date.now(),
): SessionView | null {
  if (!recorded) return null
  // `undefined` — списка сессий нет (служба не поднята): верим журналу как есть.
  // `null` — список есть, сессии в нём нет: её удалили.
  if (live === null) {
    return { id: recorded.id, state: 'gone', days: daysSince(recorded.lastActivityAt, undefined, now), canOpen: false }
  }
  const state: SessionState = live?.running
    ? 'running'
    : recorded.state === 'failed' || recorded.state === 'gone'
      ? recorded.state
      : 'idle'
  return {
    id: recorded.id,
    state,
    title: live?.title,
    days: daysSince(recorded.lastActivityAt, live?.updatedAt, now),
    canOpen: live !== undefined ? true : recorded.state !== 'gone',
  }
}

/** Свежее из двух отметок: журнал пишет по событиям узла, харнесс — по своим. */
function daysSince(recordedIso: string, liveMs: number | undefined, now: number): number {
  const recordedMs = Date.parse(recordedIso)
  const latest = Math.max(Number.isNaN(recordedMs) ? 0 : recordedMs, liveMs ?? 0)
  if (latest === 0) return 0
  return Math.max(0, Math.floor((now - latest) / DAY_MS))
}
