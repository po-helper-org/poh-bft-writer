/**
 * Портал — исполнитель активностей цикла БФТ (ADR-0022, шаг 2): очередь bft-portal.
 * Цикл (bft-flow) решает, КОГДА делать; портал делает — у него модель, файлы заявки и
 * трекер. Workflow-кода здесь нет: только активности.
 *
 * Temporal недоступен — повторяем подключение раз в 30 с; портал работает дальше. Модуль
 * воркера (нативный) грузится лениво: не загрузился — портал без активностей, с записью в журнал.
 */
export const PORTAL_TASK_QUEUE = 'bft-portal'

export interface RebuildRequest { taskId: number; slug: string; sessionId: string; lastSubmitAt: string }
export interface RebuildResult { started: boolean; reason?: string }
export interface PortalActivities {
  rebuildFromAnswers(request: RebuildRequest): Promise<RebuildResult>
}

const RETRY_MS = 30_000

/** Запустить воркер; возвращает остановку (для ctx.effect). */
export function startPortalWorker(
  activities: PortalActivities,
  address = (process.env.TEMPORAL_ADDRESS ?? '').trim(),
  namespace = (process.env.TEMPORAL_NAMESPACE ?? 'bft').trim(),
  log: (message: string) => void = (m) => console.warn(m),
): () => Promise<void> {
  if (!address) return async () => {}
  let stopped = false
  let current: { shutdown(): void; getState(): string } | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  const run = async (): Promise<void> => {
    if (stopped) return
    try {
      const { NativeConnection, Worker } = await import('@temporalio/worker')
      const connection = await NativeConnection.connect({ address })
      const worker = await Worker.create({
        connection, namespace, taskQueue: PORTAL_TASK_QUEUE, activities,
        maxConcurrentActivityTaskExecutions: 4,
      })
      if (stopped) { await connection.close(); return }
      current = worker
      log(`[customer-form] жизненный цикл: портал исполняет активности (${address}, очередь ${PORTAL_TASK_QUEUE})`)
      await worker.run()
      await connection.close().catch(() => undefined)
      current = undefined
      if (!stopped) throw new Error('воркер остановился')
    } catch (e) {
      current = undefined
      if (stopped) return
      log(`[customer-form] жизненный цикл: активности портала недоступны — ${(e as Error).message}; повтор через ${RETRY_MS / 1000} с`)
      retry = setTimeout(() => void run(), RETRY_MS)
    }
  }
  void run()
  return async () => {
    stopped = true
    clearTimeout(retry)
    if (current && current.getState() === 'RUNNING') current.shutdown()
  }
}
