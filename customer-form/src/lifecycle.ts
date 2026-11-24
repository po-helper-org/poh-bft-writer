/**
 * Жизненный цикл БФТ (ADR-0022): портал — клиент Temporal. Каждое событие заявки
 * уходит в её workflow `bft-<taskId>` (signalWithStart: первый же сигнал заводит
 * цикл). Портал от Temporal не зависит: адреса нет — цикл выключен; Temporal
 * недоступен — событие только в журнал, портал работает как раньше (теневой режим,
 * шаги 0–1 перехода).
 *
 * Схема событий — bft-flow/src/events.ts; здесь копия того, что шлёт портал.
 */
import { Client, Connection } from '@temporalio/client'

export const TASK_QUEUE = 'bft-flow'
export const WORKFLOW_TYPE = 'BftLifecycle'
export const workflowIdOf = (taskId: number): string => `bft-${taskId}`

export type ActorKind = 'customer' | 'po' | 'team' | 'system' | 'mail'
export interface LifecycleEvent {
  eventId: string
  at: string
  actor: { kind: ActorKind; id?: string; name?: string }
  kind: string
  summary?: string
  data?: Record<string, unknown>
}

export interface LifecycleRequest { taskId: number; slug: string; sessionId: string; title?: string; createdAt: string }

export interface LifecycleStatus {
  taskId: number
  stage: string
  waitingFor: string[]
  round: number
  events: number
  updatedAt: string
  [key: string]: unknown
}

const RETRY_AFTER_MS = 30_000

export class Lifecycle {
  private client?: Promise<Client>
  private failedAt = 0
  private readonly closed = new Set<number>()

  constructor(
    readonly address = (process.env.TEMPORAL_ADDRESS ?? '').trim(),
    readonly namespace = (process.env.TEMPORAL_NAMESPACE ?? 'bft').trim(),
    private readonly log: (message: string) => void = (m) => console.warn(m),
  ) {}

  get enabled(): boolean { return !!this.address }

  private async connect(): Promise<Client | undefined> {
    if (!this.enabled) return undefined
    if (!this.client) {
      if (Date.now() - this.failedAt < RETRY_AFTER_MS) return undefined
      this.client = Connection.connect({ address: this.address, connectTimeout: '5s' })
        .then((connection) => new Client({ connection, namespace: this.namespace }))
      this.client.catch((e: Error) => {
        this.client = undefined
        this.failedAt = Date.now()
        this.log(`[customer-form] жизненный цикл: Temporal ${this.address} недоступен — ${e.message}`)
      })
    }
    return this.client.catch(() => undefined)
  }

  /** Событие заявки → её цикл (заводит цикл, если его ещё нет). false — не доставлено. */
  async record(request: LifecycleRequest, event: LifecycleEvent): Promise<boolean> {
    const client = await this.connect()
    if (!client) return false
    try {
      await client.workflow.signalWithStart(WORKFLOW_TYPE, {
        workflowId: workflowIdOf(request.taskId),
        taskQueue: TASK_QUEUE,
        args: [request],
        signal: 'event',
        signalArgs: [event],
        // Завершённый цикл (отменён, передан) новым событием не воскрешаем; прерванный
        // администратором (terminate — например, пересбор теневой истории) — заводим заново.
        workflowIdReusePolicy: 'ALLOW_DUPLICATE_FAILED_ONLY',
      })
      return true
    } catch (e) {
      // Цикл закрыт (отменён, передан в исполнение): события ему больше не нужны — не повторяем.
      if ((e as Error).name === 'WorkflowExecutionAlreadyStartedError') {
        if (!this.closed.has(request.taskId)) this.log(`[customer-form] жизненный цикл #${request.taskId}: цикл закрыт — события больше не шлём`)
        this.closed.add(request.taskId)
        return true
      }
      this.log(`[customer-form] жизненный цикл #${request.taskId}: событие ${event.kind} не доставлено — ${(e as Error).message}`)
      return false
    }
  }

  /** Статус и хроника цикла; undefined — цикла нет или Temporal недоступен. */
  async status(taskId: number): Promise<{ status: LifecycleStatus; timeline: unknown[] } | undefined> {
    const client = await this.connect()
    if (!client) return undefined
    try {
      const handle = client.workflow.getHandle(workflowIdOf(taskId))
      const [status, timeline] = await Promise.all([handle.query<LifecycleStatus>('status'), handle.query<unknown[]>('timeline')])
      return { status, timeline }
    } catch {
      return undefined
    }
  }
}

let shared: Lifecycle | undefined
export function sharedLifecycle(): Lifecycle {
  shared ??= new Lifecycle()
  return shared
}

/** «Заявка заведена» — первое событие цикла; eventId постоянный: повтор (догрузка при старте) не задваивается. */
export function registeredEvent(at: string, title?: string): LifecycleEvent {
  return { eventId: 'registered', at, actor: { kind: 'customer' }, kind: 'registered', ...(title ? { summary: `Заявка заведена: ${title}` } : {}) }
}
