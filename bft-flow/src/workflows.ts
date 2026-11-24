/**
 * BftLifecycle — один долгий workflow на заявку (ADR-0022).
 *
 * Цикл принимает события (signal `event`), считает стадию чистой `reduce` и отдаёт
 * статус и хронику (queries). Шаг 2 перехода: пересборку полного БФТ по ответам формы
 * отсчитывает сам цикл (таймер Temporal переживает рестарт портала) и просит о ней
 * портал — активность `rebuildFromAnswers` на очереди bft-portal. Остальную работу
 * (сборки, рассылки) цикл пока не запускает — шаги 3–5. Длинная история закрывается
 * continueAsNew с переносом состояния.
 */
import { condition, continueAsNew, defineQuery, defineSignal, proxyActivities, setHandler, upsertSearchAttributes, workflowInfo, allHandlersFinished } from '@temporalio/workflow'
import { PORTAL_TASK_QUEUE, type BftEvent, type InboxEntry, type LifecycleInput, type LifecycleStatus, type PortalActivities, type RebuildPending, type TimelineEntry } from './events.js'
import { initialState, isTerminal, reduce, statusOf } from './reduce.js'
import { BFT_ROUND, BFT_STAGE, BFT_TASK_ID, BFT_UPDATED_AT, BFT_WAITING_FOR } from './search-attributes.js'

export const eventSignal = defineSignal<[BftEvent]>('event')
export const statusQuery = defineQuery<LifecycleStatus>('status')
export const timelineQuery = defineQuery<TimelineEntry[], [string?]>('timeline')
/** Входящие события заявки (отправки формы) со статусом пересборки — сайдбар документа. */
export const inboxQuery = defineQuery<InboxEntry[]>('inbox')

/** Больше событий в одном прогоне — continueAsNew (история Temporal не раздувается). */
export const EVENTS_PER_RUN = 1000

// Портал выкладывают или идёт сборка — повторяем; ждём портал до трёх суток.
const portal = proxyActivities<PortalActivities>({
  taskQueue: PORTAL_TASK_QUEUE,
  startToCloseTimeout: '2 minutes',
  scheduleToCloseTimeout: '3 days',
  retry: { initialInterval: '30 seconds', backoffCoefficient: 2, maximumInterval: '10 minutes' },
})

/** Итог запроса пересборки — событием в собственную очередь (то же применение, что у сигналов). */
function rebuildEvent(pending: RebuildPending, result: { started: boolean; reason?: string } | { error: string }): BftEvent {
  const at = new Date().toISOString()
  const summary = 'error' in result ? `Пересборка по ответам формы не запущена: ${result.error.slice(0, 160)}`
    : result.started ? 'Ответы формы — портал пересобирает полный БФТ'
    : `Пересборка по ответам не нужна${result.reason ? `: ${result.reason}` : ''}`
  return {
    eventId: `rebuild:${pending.lastSubmitAt}:${at}`, at, actor: { kind: 'system' }, kind: 'rebuildRequested', summary,
    data: {
      lastSubmitAt: pending.lastSubmitAt, started: !('error' in result) && result.started,
      ...('error' in result ? { error: result.error.slice(0, 500) } : result.reason ? { reason: result.reason.slice(0, 200) } : {}),
    },
  }
}

export async function BftLifecycle(input: LifecycleInput): Promise<LifecycleStatus> {
  let state = input.carry ?? initialState(input)
  const queue: BftEvent[] = []
  let inRun = 0
  /** Запрос пересборки у портала в пути: цикл тем временем принимает события. */
  let requesting = false
  setHandler(eventSignal, (event) => { queue.push(event) })
  setHandler(statusQuery, () => statusOf(state))
  setHandler(inboxQuery, () => state.inbox ?? [])
  setHandler(timelineQuery, (since) => (since ? state.timeline.filter((t) => t.at > since) : state.timeline))

  const publish = () => upsertSearchAttributes([
    { key: BFT_STAGE, value: state.stage },
    { key: BFT_TASK_ID, value: state.taskId },
    { key: BFT_ROUND, value: state.round },
    { key: BFT_WAITING_FOR, value: state.waitingFor },
    ...(Number.isNaN(Date.parse(state.updatedAt)) ? [] : [{ key: BFT_UPDATED_AT, value: new Date(state.updatedAt) }]),
  ])
  publish()

  const requestRebuild = (pending: RebuildPending) => {
    requesting = true
    portal.rebuildFromAnswers({ taskId: state.taskId, slug: state.slug, sessionId: state.sessionId, lastSubmitAt: pending.lastSubmitAt }).then(
      (result) => { requesting = false; queue.push(rebuildEvent(pending, result)) },
      (e: Error) => { requesting = false; queue.push(rebuildEvent(pending, { error: e.cause instanceof Error ? e.cause.message : e.message })) },
    )
  }

  while (!isTerminal(state.stage)) {
    // Date.now() в workflow — время цикла (детерминировано), таймер condition переживает рестарты.
    const due = state.rebuild && !requesting ? Date.parse(state.rebuild.dueAt) - Date.now() : undefined
    if (due === undefined) await condition(() => queue.length > 0)
    else if (due > 0) await condition(() => queue.length > 0, due)
    if (state.rebuild && !requesting && !queue.length && Date.now() >= Date.parse(state.rebuild.dueAt)) requestRebuild(state.rebuild)
    while (queue.length) {
      const before = state
      state = reduce(state, queue.shift()!)
      if (state !== before) inRun++
      if (state.stage !== before.stage || state.round !== before.round || state.waitingFor.join() !== before.waitingFor.join() || state.updatedAt !== before.updatedAt) publish()
    }
    if (!isTerminal(state.stage) && !requesting && (inRun >= EVENTS_PER_RUN || workflowInfo().continueAsNewSuggested)) {
      await condition(allHandlersFinished)
      if (!queue.length) await continueAsNew<typeof BftLifecycle>({ ...input, carry: state })
    }
  }
  return statusOf(state)
}
