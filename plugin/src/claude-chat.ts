/**
 * Чат по требованию через Claude Code CLI (issue #41), узловая половина.
 *
 * PO пишет на детальной странице, что сделать по БФТ; раздел собирает черновик
 * (`handoff.ts`: слэш-команда навыка, стадия, правка PO) и отдаёт его CLI:
 * `claude -p --output-format stream-json`, stdin — черновик, cwd — рабочее
 * пространство чатов (`sessionWorkspace`, там `bft-config.md` и навыки по
 * дереву выше). Поток CLI переводится в события `chat-events.ts` и копится в
 * прогоне; браузер забирает хвост подкомандой `chatPoll`. Один прогон — один
 * ход; следующий ход по тому же требованию идёт `--resume` в ту же сессию
 * Claude Code, чтобы модель помнила, что уже делала.
 *
 * Здесь нет процесса и диска: запуск — через порт `spawnStreaming`, аргументы
 * собирает чистая `claudeArgs`. Реестр прогонов живёт в памяти узла: прогон —
 * состояние на время работы CLI, а история — в сессии Claude Code на диске у
 * самого CLI и в журнале работы раздела (идентификатор сессии).
 */
import { parseStreamLine, sessionIdOf, type ChatEvent } from './chat-events.js'
import { ChatBusyError } from './errors.js'
import type { SpawnStreaming, StreamingProcess } from './ports.js'

export interface ClaudeChatConfig {
  bin: string
  /** Дополнительные аргументы CLI — права, модель; из строки профиля. */
  args: readonly string[]
}

export interface ClaudeArgsInput {
  /** Продолжить сессию Claude Code; нет — новая. */
  resume?: string
  /** Идентификатор новой сессии (UUID), чтобы знать его до первого события CLI. С `resume` не сочетается. */
  newSessionId?: string
  /** Каталог корня воркспейса — CLI разрешено читать и писать там, даже когда cwd глубже. */
  addDir?: string
}

/** Аргументы CLI. Черновик идёт stdin'ом, не аргументом: длинный промт в argv — лишний риск. */
export function claudeArgs(config: ClaudeChatConfig, input: ClaudeArgsInput): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']
  if (input.resume) args.push('--resume', input.resume)
  else if (input.newSessionId) args.push('--session-id', input.newSessionId)
  if (input.addDir) args.push('--add-dir', input.addDir)
  args.push(...config.args)
  return args
}

export type ChatRunStatus = 'running' | 'done' | 'failed' | 'stopped'

export interface ChatRun {
  runId: string
  taskId: string
  status: ChatRunStatus
  /** Сессия Claude Code, как только CLI её назвал. */
  sessionId?: string
  /** Ход продолжал прошлую сессию (`--resume`), а не открывал новую. */
  resumed: boolean
  /** PO нажал «Остановить»: процесс убивается, ход станет `stopped` по его выходу. */
  stopping?: true
  events: ChatEvent[]
  startedAt: string
  finishedAt?: string
}

/** Что уходит браузеру по `chatPoll`: хвост событий с `since` и состояние прогона. */
export interface ChatPoll {
  runId: string
  status: ChatRunStatus
  sessionId?: string
  events: ChatEvent[]
  /** Сколько событий всего — следующий `since`. */
  total: number
}

export interface ChatStart {
  runId: string
  taskId: string
}

/** Сколько завершённых прогонов держать в памяти: PO возвращается к недавним, старые не нужны. */
const KEEP_FINISHED = 20

export class ClaudeChatService {
  private readonly runs = new Map<string, ChatRun>()
  private readonly processes = new Map<string, StreamingProcess>()
  private counter = 0

  constructor(
    private readonly config: ClaudeChatConfig,
    private readonly spawn: SpawnStreaming,
    /**
     * Прогон завершился: сессия Claude Code (если CLI её назвал) и исход. Хозяин
     * пишет журнал работы и сверяет доску — как после хода агента харнесса.
     */
    private readonly onFinish: (run: ChatRun) => void = () => {},
  ) {}

  /**
   * Запустить ход. Второй ход по тому же требованию, пока первый идёт, — отказ:
   * два CLI в одном каталоге правили бы один документ наперегонки.
   */
  start(taskId: string, prompt: string, cwd: string, options: ClaudeArgsInput = {}): ChatStart {
    const active = this.activeFor(taskId)
    if (active) throw new ChatBusyError(taskId, active.runId)

    const runId = `run-${Date.now().toString(36)}-${(++this.counter).toString(36)}`
    const run: ChatRun = {
      runId,
      taskId,
      status: 'running',
      sessionId: options.resume ?? options.newSessionId,
      resumed: options.resume !== undefined,
      events: [{ kind: 'user', text: prompt }],
      startedAt: new Date().toISOString(),
    }
    this.runs.set(runId, run)
    this.trim()

    const push = (events: ChatEvent[]): void => {
      for (const event of events) {
        run.events.push(event)
        if (event.kind === 'init' || (event.kind === 'result' && event.sessionId)) run.sessionId = sessionIdOf(run.events) ?? run.sessionId
      }
    }
    const child = this.spawn(this.config.bin, claudeArgs(this.config, options), cwd, prompt, {
      line: (text) => { push(parseStreamLine(text)) },
      stderr: (text) => { push([{ kind: 'stderr', text }]) },
      exit: (code, error) => {
        push([error ? { kind: 'exit', code, error } : { kind: 'exit', code }])
        this.processes.delete(runId)
        if (run.stopping) {
          run.status = 'stopped'
        } else {
          const result = run.events.find(event => event.kind === 'result')
          run.status = !error && code === 0 && result?.kind === 'result' && result.ok ? 'done' : 'failed'
        }
        run.finishedAt = new Date().toISOString()
        this.onFinish(run)
      },
    })
    this.processes.set(runId, child)
    return { runId, taskId }
  }

  /** Хвост событий прогона с позиции `since`. Неизвестный прогон — `null`: узел перезапустился. */
  poll(runId: string, since: number): ChatPoll | null {
    const run = this.runs.get(runId)
    if (!run) return null
    const from = Math.max(0, Math.min(since, run.events.length))
    return {
      runId,
      status: run.status,
      sessionId: run.sessionId,
      events: run.events.slice(from),
      total: run.events.length,
    }
  }

  /**
   * Остановить ход. Уже завершённый — ничего не происходит. Ход остаётся
   * `running` до выхода процесса: пока CLI жив, он всё ещё правит файлы, и
   * второй ход по тому же требованию запускать нельзя (`activeFor`).
   */
  stop(runId: string): boolean {
    const run = this.runs.get(runId)
    const child = this.processes.get(runId)
    if (!run || !child) return false
    run.stopping = true
    child.kill()
    return true
  }

  /** Раздел выгружается или харнесс останавливается: живые CLI не должны переживать узел. */
  stopAll(): void {
    for (const runId of [...this.processes.keys()]) this.stop(runId)
  }

  /** Идущий прогон по требованию — чтобы страница, открытая заново, подхватила его. */
  activeFor(taskId: string): ChatRun | undefined {
    for (const run of this.runs.values()) {
      if (run.taskId === taskId && run.status === 'running') return run
    }
    return undefined
  }

  /** Последний прогон по требованию, идущий или завершённый. */
  latestFor(taskId: string): ChatRun | undefined {
    let latest: ChatRun | undefined
    for (const run of this.runs.values()) {
      if (run.taskId === taskId && (!latest || run.startedAt > latest.startedAt)) latest = run
    }
    return latest
  }

  /** Убрать самые старые завершённые прогоны сверх лимита. Идущие не трогаются. */
  private trim(): void {
    const finished = [...this.runs.values()].filter(run => run.status !== 'running')
    if (finished.length <= KEEP_FINISHED) return
    finished.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
    for (const run of finished.slice(0, finished.length - KEEP_FINISHED)) this.runs.delete(run.runId)
  }
}
