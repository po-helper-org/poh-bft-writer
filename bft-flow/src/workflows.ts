/**
 * BftLifecycle — один долгий workflow на заявку (ADR-0022).
 *
 * Шаг 0–1 перехода: цикл принимает события (signal `event`), считает стадию
 * чистой `reduce` и отдаёт статус и хронику (queries). Работу (сборки, рассылки)
 * он пока не запускает — это шаги 2–5. Длинная история закрывается
 * continueAsNew с переносом состояния.
 */
import { condition, continueAsNew, defineQuery, defineSignal, setHandler, upsertSearchAttributes, workflowInfo, allHandlersFinished } from '@temporalio/workflow'
import type { BftEvent, LifecycleInput, LifecycleStatus, TimelineEntry } from './events.js'
import { initialState, isTerminal, reduce, statusOf } from './reduce.js'
import { BFT_ROUND, BFT_STAGE, BFT_TASK_ID, BFT_UPDATED_AT, BFT_WAITING_FOR } from './search-attributes.js'

export const eventSignal = defineSignal<[BftEvent]>('event')
export const statusQuery = defineQuery<LifecycleStatus>('status')
export const timelineQuery = defineQuery<TimelineEntry[], [string?]>('timeline')

/** Больше событий в одном прогоне — continueAsNew (история Temporal не раздувается). */
export const EVENTS_PER_RUN = 1000

export async function BftLifecycle(input: LifecycleInput): Promise<LifecycleStatus> {
  let state = input.carry ?? initialState(input)
  const queue: BftEvent[] = []
  let inRun = 0
  setHandler(eventSignal, (event) => { queue.push(event) })
  setHandler(statusQuery, () => statusOf(state))
  setHandler(timelineQuery, (since) => (since ? state.timeline.filter((t) => t.at > since) : state.timeline))

  const publish = () => upsertSearchAttributes([
    { key: BFT_STAGE, value: state.stage },
    { key: BFT_TASK_ID, value: state.taskId },
    { key: BFT_ROUND, value: state.round },
    { key: BFT_WAITING_FOR, value: state.waitingFor },
    ...(Number.isNaN(Date.parse(state.updatedAt)) ? [] : [{ key: BFT_UPDATED_AT, value: new Date(state.updatedAt) }]),
  ])
  publish()

  while (!isTerminal(state.stage)) {
    await condition(() => queue.length > 0)
    while (queue.length) {
      const before = state
      state = reduce(state, queue.shift()!)
      if (state !== before) inRun++
      if (state.stage !== before.stage || state.round !== before.round || state.waitingFor.join() !== before.waitingFor.join() || state.updatedAt !== before.updatedAt) publish()
    }
    if (!isTerminal(state.stage) && (inRun >= EVENTS_PER_RUN || workflowInfo().continueAsNewSuggested)) {
      await condition(allHandlersFinished)
      if (!queue.length) await continueAsNew<typeof BftLifecycle>({ ...input, carry: state })
    }
  }
  return statusOf(state)
}
