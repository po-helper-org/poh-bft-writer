/**
 * Чат по требованию через сессию харнесса — агент DSH вместо Claude Code CLI.
 *
 * Для установок, где чат Claude Code выключен (`claudeBin: off`) или невозможен: запуск
 * `claude` на узле запрещён политикой среды, а агент харнесса уже есть. Контракт тот же, что
 * у узлового чата (`DetailChatChannel`: status/start/poll/stop), поэтому DetailPage и
 * DetailChat не различают, кто отвечает: ход, опрос хвоста, плёнка на документе и
 * перечитывание по завершении работают как были.
 *
 * Одна сессия на требование: берётся последняя сессия харнесса из журнала работы
 * (`task.session`), нет её или она удалена — создаётся новая в рабочем пространстве чатов
 * (`bft/`) без навигации (`sessions.create`) и записывается в журнал (`attachSession`).
 * Сообщение — `session.prompt`, остановка — `session.cancel`.
 *
 * Транскрипт — события сессии после момента запуска (`eventSource`), переведённые в
 * `ChatEvent` узлового чата: `user/message` → user, `assistant/live-chunk` (text-delta) →
 * delta, `assistant/message` → assistant, `tool/call`/`tool/result` → tool-start/tool-end,
 * `turn/end` → result. Поток только дописывается: `settle-assistant` заменяет стримовые
 * строки окончательным сообщением, а проекция (`projectTranscript`) закрывает поток по
 * `assistant` сама.
 *
 * Типы служб харнесса здесь структурные: devDependencies пакета — ядро 0.1.2, в котором
 * `sessions.retain`/`eventSource` ещё нет.
 */
import type { RpcResult } from '../channel.js'
import type { ChatEvent } from '../chat-events.js'

interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

interface SessionEventLike { type: string; seq: number; data: unknown }
interface SessionEventEntry { type: string; event: SessionEventLike }
interface SessionEventWindow { entries: readonly SessionEventEntry[] }

interface RemoteResultLike { ok: boolean; error?: { message?: string; code?: string } }

interface SessionFaceLike extends Observable<unknown> {
  prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue' | 'steer'): Promise<RemoteResultLike>
  cancel(): Promise<unknown>
}

interface SessionBindingLike {
  sessionId: string
  session: SessionFaceLike
  eventSource: Observable<SessionEventWindow>
}

interface SessionReferenceLike {
  ready: Promise<SessionBindingLike>
  release(): void
}

/** Грань службы `sessions` ядра 0.1.7, которой хватает чату. */
export interface HarnessSessionsLike {
  create(options: { workspaceId?: string }): Promise<string>
  retain(target: string, options: { source: string }): SessionReferenceLike
}

export interface HarnessChatDeps {
  /** Служба сессий; `undefined` — харнесса без неё (или ядро без `retain`), чата нет. */
  sessions(): HarnessSessionsLike | undefined
  /** Рабочее пространство, в котором создаётся новая сессия по требованию. */
  workspaceId(): Promise<string | undefined>
  /** Последняя сессия харнесса по требованию из журнала работы. */
  lastSession(id: string, signal: AbortSignal): Promise<string | undefined>
  /** Текст хода: черновик узла (`handoff`) с правкой PO или следующим шагом по стадии. */
  prompt(id: string, note: string | undefined, signal: AbortSignal): Promise<string>
  /** Запись сессии в журнал работы требования. */
  attach(id: string, sessionId: string): void
}

type RunStatus = 'running' | 'done' | 'failed' | 'stopped'

/** Метка источника удержания сессии — для отладки в харнессе, рантайм её не проверяет. */
const RETAIN_SOURCE = 'pohBftChat'

interface Run {
  runId: string
  taskId: string
  status: RunStatus
  events: ChatEvent[]
  /** Последний seq окна до запуска: всё, что не новее, — история, не этот ход. */
  baseline: number
  seen: Set<string>
  /** Сколько стримовых кусков уже отдано — по попытке ответа. */
  chunks: Map<string, number>
  /** Ход начался (turn/start после запуска) — с этого момента turn/end — наш. */
  started: boolean
  binding: SessionBindingLike | null
  dispose: () => void
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/** Текст сообщения: строка, список блоков `{type:'text', text}` или объект с `content`. */
export function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        const b = record(block)
        return b && b.type === 'text' && typeof b.text === 'string' ? b.text : ''
      })
      .filter(Boolean)
      .join('\n')
  }
  const r = record(value)
  if (!r) return ''
  if ('content' in r) return textOf(r.content)
  if ('message' in r) return textOf(r.message)
  return ''
}

/**
 * Новые события окна → события чата. Идемпотентно: повторный разбор того же окна ничего не
 * добавляет, поэтому можно звать на каждое изменение `eventSource` целиком.
 */
export function absorbWindow(run: Pick<Run, 'baseline' | 'seen' | 'chunks' | 'started' | 'events' | 'status'>, window: SessionEventWindow): void {
  // Порядковый номер стримового куска внутри попытки в этом окне: окно отдаёт куски по
  // порядку, а отданные раньше (run.chunks) уже в транскрипте.
  const positions = new Map<string, number>()
  for (const entry of window.entries) {
    const event = entry.event
    if (!event || typeof event.type !== 'string') continue
    const data = record(event.data) ?? {}

    if (entry.type === 'transient') {
      if (!run.started || event.type !== 'assistant/live-chunk') continue
      const chunk = record(data.chunk)
      const attempt = String(data.attemptId ?? '')
      const position = (positions.get(attempt) ?? 0) + 1
      positions.set(attempt, position)
      if (position <= (run.chunks.get(attempt) ?? 0)) continue
      run.chunks.set(attempt, position)
      if (chunk && chunk.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
        run.events.push({ kind: 'delta', text: chunk.text })
      }
      continue
    }

    if (typeof event.seq !== 'number' || event.seq <= run.baseline) continue
    const key = `${event.seq}`
    if (run.seen.has(key)) continue
    run.seen.add(key)

    switch (event.type) {
      case 'turn/start':
        run.started = true
        break
      case 'user/message': {
        // В ту же роль харнесс подмешивает контекст (AGENTS.md, runtime-снимок, навыки,
        // уведомления) — в транскрипт идёт только то, что написал человек.
        const source = record(data.source)
        if (source && source.kind !== 'user') break
        const text = textOf(data)
        if (text) run.events.push({ kind: 'user', text })
        break
      }
      case 'assistant/message': {
        if (!run.started) break
        const text = textOf(data.message)
        if (text) run.events.push({ kind: 'assistant', text })
        break
      }
      case 'tool/call':
        if (!run.started) break
        run.events.push({ kind: 'tool-start', id: String(data.callId ?? ''), name: String(data.name ?? 'tool') })
        break
      case 'tool/result': {
        if (!run.started) break
        const message = record(data.message) ?? {}
        const id = String(message.toolCallId ?? message.callId ?? data.callId ?? '')
        run.events.push({ kind: 'tool-end', id, isError: data.error !== undefined && data.error !== null })
        break
      }
      case 'turn/end': {
        if (!run.started) break
        const reason = record(data.reason) ?? {}
        const kind = String(reason.kind ?? 'completed')
        const error = record(reason.error)
        const text = kind === 'completed' ? '' : String(error?.message ?? error?.reason ?? kind)
        run.events.push({ kind: 'result', ok: kind === 'completed', text })
        run.status = kind === 'completed' ? 'done' : kind === 'aborted' ? 'stopped' : 'failed'
        break
      }
      default:
        break
    }
  }
}

function lastSeq(window: SessionEventWindow): number {
  let max = 0
  for (const entry of window.entries) {
    if (entry.type !== 'transient' && typeof entry.event?.seq === 'number') max = Math.max(max, entry.event.seq)
  }
  return max
}

export interface HarnessChat {
  /** Есть ли в этой среде служба сессий, способная вести чат. */
  available(): boolean
  /** Ход этого адаптера (а не узлового чата). */
  owns(runId: string): boolean
  status(id: string): RpcResult<unknown>
  start(id: string, note: string | undefined, signal: AbortSignal): Promise<RpcResult<unknown>>
  poll(runId: string, since: number): RpcResult<unknown>
  stop(runId: string): Promise<RpcResult<unknown>>
  dispose(): void
}

export function createHarnessChat(deps: HarnessChatDeps): HarnessChat {
  const runs = new Map<string, Run>()
  const byTask = new Map<string, string>()
  let counter = 0

  const sessionsOrNull = (): HarnessSessionsLike | null => {
    const sessions = deps.sessions()
    return sessions && typeof sessions.retain === 'function' && typeof sessions.create === 'function' ? sessions : null
  }

  /** Сессия требования, удержанная на время хода: из журнала или новая. */
  const bindSession = async (sessions: HarnessSessionsLike, id: string, signal: AbortSignal): Promise<{ binding: SessionBindingLike; release: () => void }> => {
    const known = await deps.lastSession(id, signal).catch(() => undefined)
    if (known) {
      const reference = sessions.retain(known, { source: RETAIN_SOURCE })
      try {
        const binding = await reference.ready
        return { binding, release: () => { reference.release() } }
      } catch {
        // Сессию удалили или она не грузится — начинаем новую, журнал перезапишется ниже.
        reference.release()
      }
    }
    const workspaceId = await deps.workspaceId()
    const sessionId = await sessions.create(workspaceId === undefined ? {} : { workspaceId })
    deps.attach(id, sessionId)
    const reference = sessions.retain(sessionId, { source: RETAIN_SOURCE })
    const binding = await reference.ready
    return { binding, release: () => { reference.release() } }
  }

  return {
    available: () => sessionsOrNull() !== null,

    owns: runId => runs.has(runId),

    status(id) {
      if (!sessionsOrNull()) return ok({ available: false, run: null })
      const runId = byTask.get(id)
      const run = runId ? runs.get(runId) : undefined
      return ok({ available: true, run: run ? { runId: run.runId, status: run.status } : null })
    },

    async start(id, note, signal) {
      const sessions = sessionsOrNull()
      if (!sessions) return fail('chat-unavailable', 'служба сессий харнесса недоступна')
      const current = byTask.get(id)
      if (current && runs.get(current)?.status === 'running') return fail('chat-busy', 'по требованию уже идёт ход')
      try {
        const text = await deps.prompt(id, note, signal)
        const { binding, release } = await bindSession(sessions, id, signal)
        counter += 1
        const run: Run = {
          runId: `harness-${Date.now()}-${counter}`,
          taskId: id,
          status: 'running',
          events: [],
          baseline: lastSeq(binding.eventSource.getSnapshot()),
          seen: new Set(),
          chunks: new Map(),
          started: false,
          binding,
          dispose: () => {},
        }
        const absorb = () => {
          if (run.status !== 'running') return
          absorbWindow(run, binding.eventSource.getSnapshot())
          if (run.status !== 'running') finish()
        }
        const off = binding.eventSource.subscribe(absorb)
        let finished = false
        const finish = () => {
          if (finished) return
          finished = true
          off()
          release()
        }
        run.dispose = finish
        runs.set(run.runId, run)
        byTask.set(id, run.runId)

        const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
        if (!result.ok) {
          run.events.push({ kind: 'stderr', text: result.error?.message ?? 'харнесс не принял сообщение' })
          run.status = 'failed'
          finish()
          return fail('chat-failed', result.error?.message ?? 'харнесс не принял сообщение')
        }
        absorb()
        return ok({ runId: run.runId })
      } catch (error: unknown) {
        return fail('chat-failed', error instanceof Error ? error.message : String(error))
      }
    },

    poll(runId, since) {
      const run = runs.get(runId)
      if (!run) return fail('chat-run-not-found', 'ход не найден')
      return ok({ status: run.status, events: run.events.slice(since), total: run.events.length })
    },

    async stop(runId) {
      const run = runs.get(runId)
      if (!run?.binding) return fail('chat-run-not-found', 'ход не найден')
      try {
        await run.binding.session.cancel()
        return ok(true)
      } catch (error: unknown) {
        return fail('chat-failed', error instanceof Error ? error.message : String(error))
      }
    },

    dispose() {
      for (const run of runs.values()) run.dispose()
      runs.clear()
      byTask.clear()
    },
  }
}
