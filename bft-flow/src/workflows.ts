/**
 * BftLifecycle — один долгий workflow на заявку (ADR-0022).
 *
 * Цикл принимает события (signal `event`), считает стадию чистой `reduce` и отдаёт
 * статус и хронику (queries).
 * - Шаг 2: паузу до пересборки по ответам формы отсчитывает цикл (таймер Temporal).
 * - Шаг 3: полный БФТ собирает цикл — дочерний `DeepBuild` (активность портала
 *   `buildDeep` с пульсом: рестарт портала посреди сборки → повтор). Одна сборка за раз;
 *   ответы, пришедшие во время сборки, — ещё одна после неё.
 * Бриф собирается в ходе чата, правки ИИ-агента — своей очередью портала: цикл их
 * только записывает. Длинная история закрывается continueAsNew с переносом состояния.
 */
import {
  allHandlersFinished, condition, continueAsNew, defineQuery, defineSignal, executeChild, patched,
  proxyActivities, setHandler, upsertSearchAttributes, workflowInfo,
} from '@temporalio/workflow'
import {
  PORTAL_TASK_QUEUE, type BftEvent, type DeepBuildRequest, type DeepBuildResult, type InboxEntry, type LifecycleInput,
  type LifecycleState, type LifecycleStatus, type PortalActivities, type RebuildPending, type TimelineEntry,
} from './events.js'
import { initialState, isTerminal, reduce, statusOf } from './reduce.js'
import { BFT_ROUND, BFT_STAGE, BFT_TASK_ID, BFT_UPDATED_AT, BFT_WAITING_FOR } from './search-attributes.js'

export const eventSignal = defineSignal<[BftEvent]>('event')
export const statusQuery = defineQuery<LifecycleStatus>('status')
export const timelineQuery = defineQuery<TimelineEntry[], [string?]>('timeline')
/** Входящие события заявки (отправки формы) со статусом пересборки — сайдбар документа. */
export const inboxQuery = defineQuery<InboxEntry[]>('inbox')

/** Больше событий в одном прогоне — continueAsNew (история Temporal не раздувается). */
export const EVENTS_PER_RUN = 1000

// Шаг 2 (только для историй, начатых до шага 3): портал сам решал, собирать ли.
const portal = proxyActivities<PortalActivities>({
  taskQueue: PORTAL_TASK_QUEUE,
  startToCloseTimeout: '2 minutes',
  scheduleToCloseTimeout: '3 days',
  retry: { initialInterval: '30 seconds', backoffCoefficient: 2, maximumInterval: '10 minutes' },
})

// Сборка идёт до ~20 мин; пульс раз в 20 с — портал пропал (выкладка) → через 2 мин повтор.
const builder = proxyActivities<PortalActivities>({
  taskQueue: PORTAL_TASK_QUEUE,
  startToCloseTimeout: '45 minutes',
  heartbeatTimeout: '2 minutes',
  retry: { initialInterval: '1 minute', backoffCoefficient: 3, maximumAttempts: 3 },
})

/** Сборка полного БФТ — отдельный workflow: видна в Temporal UI сама по себе, со своими повторами. */
export async function DeepBuild(request: DeepBuildRequest): Promise<DeepBuildResult> {
  return builder.buildDeep(request)
}

const system = { kind: 'system' as const }

/** Итог запроса пересборки — событием в собственную очередь (то же применение, что у сигналов). */
function rebuildEvent(pending: RebuildPending, result: { started: boolean; reason?: string; queued?: boolean } | { error: string }, summary?: string): BftEvent {
  const at = new Date().toISOString()
  summary ??= 'error' in result ? `Пересборка по ответам формы не запущена: ${result.error.slice(0, 160)}`
    : result.started ? 'Ответы формы — портал пересобирает полный БФТ'
    : `Пересборка по ответам не нужна${result.reason ? `: ${result.reason}` : ''}`
  return {
    eventId: `rebuild:${pending.lastSubmitAt}:${at}`, at, actor: system, kind: 'rebuildRequested', summary,
    data: {
      lastSubmitAt: pending.lastSubmitAt, started: !('error' in result) && result.started,
      ...('error' in result ? { error: result.error.slice(0, 500) } : result.reason ? { reason: result.reason.slice(0, 200) } : {}),
      ...(!('error' in result) && result.queued ? { queued: true } : {}),
    },
  }
}

/** Итог сборки → события хроники; eventId те же, что шлёт сверка портала по файлам (повтор отбросится). */
function buildEvents(result: DeepBuildResult): BftEvent[] {
  const run = result.startedAt
  if (result.stage === 'skipped') return [{ eventId: `deep:skipped:${run}`, at: new Date().toISOString(), actor: system, kind: 'note', summary: `Полный БФТ не собирали: ${result.reason ?? 'не нужно'}`, data: { skipped: true, startedAt: run, ...(result.reason ? { reason: result.reason } : {}) } }]
  const started: BftEvent = { eventId: `deep:started:${run}`, at: run, actor: system, kind: 'deepStarted' }
  const at = result.finishedAt ?? new Date().toISOString()
  return result.stage === 'ready'
    ? [started, { eventId: `deep:ready:${run}`, at, actor: system, kind: 'deepReady', data: { artifact: { path: 'deep.md', rev: run } } }]
    : [started, { eventId: `deep:failed:${run}`, at, actor: system, kind: 'deepFailed', data: { startedAt: run, ...(result.error ? { error: result.error.slice(0, 500) } : {}) }, ...(result.error ? { summary: `Полный БФТ не собран: ${result.error.slice(0, 160)}` } : {}) }]
}

const causeOf = (e: unknown): string => {
  let cur = e as { cause?: unknown; message?: string } | undefined
  while (cur?.cause) cur = cur.cause as typeof cur
  return cur?.message ?? String(e)
}

export async function BftLifecycle(input: LifecycleInput): Promise<LifecycleStatus> {
  let state: LifecycleState = input.carry ?? initialState(input)
  const queue: BftEvent[] = []
  /** Итоги дочерних сборок, ещё не применённые. */
  const finished: DeepBuildResult[] = []
  let inRun = 0
  /** Запрос пересборки у портала в пути (шаг 2): цикл тем временем принимает события. */
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
      (e: Error) => { requesting = false; queue.push(rebuildEvent(pending, { error: causeOf(e) })) },
    )
  }

  /** Запустить сборку (дочерний DeepBuild); идёт другая — поставить в очередь. */
  const build = (reason: string, startedAt?: string, lastSubmitAt?: string) => {
    if (state.build) {
      state = { ...state, build: { ...state.build, queued: { reason, ...(lastSubmitAt ? { lastSubmitAt } : {}) } } }
      return
    }
    const at = startedAt ?? new Date().toISOString()
    const n = (state.builds ?? 0) + 1
    state = { ...state, builds: n, build: { reason, startedAt: at } }
    const request: DeepBuildRequest = { taskId: state.taskId, slug: state.slug, sessionId: state.sessionId, startedAt: at, reason, ...(lastSubmitAt ? { lastSubmitAt } : {}) }
    executeChild(DeepBuild, { workflowId: `${workflowInfo().workflowId}-deep-${n}`, args: [request] }).then(
      (result) => { finished.push(result) },
      (e: unknown) => { finished.push({ stage: 'failed', startedAt: at, finishedAt: new Date().toISOString(), error: causeOf(e) }) },
    )
  }

  while (!isTerminal(state.stage)) {
    // Date.now() в workflow — время цикла (детерминировано), таймер condition переживает рестарты.
    const due = state.rebuild && !requesting ? Date.parse(state.rebuild.dueAt) - Date.now() : undefined
    const ready = () => queue.length > 0 || finished.length > 0
    if (due === undefined) await condition(ready)
    else if (due > 0) await condition(ready, due)
    if (state.rebuild && !requesting && !ready() && Date.now() >= Date.parse(state.rebuild.dueAt)) {
      const pending = state.rebuild
      if (patched('deep-build-child')) {
        // Шаг 3: собирает цикл; идёт сборка — ещё одна после неё (ответы она могла не учесть).
        const queued = !!state.build
        build('answers', undefined, pending.lastSubmitAt)
        queue.push(rebuildEvent(pending, { started: true, queued }, queued ? 'Ответы формы — пересборка после текущей сборки' : 'Ответы формы — цикл пересобирает полный БФТ'))
      } else requestRebuild(pending)
    }
    while (finished.length) {
      const result = finished.shift()!
      const queued = state.build?.queued
      state = { ...state, build: undefined }
      queue.push(...buildEvents(result))
      if (queued) build(queued.reason, undefined, queued.lastSubmitAt)
    }
    while (queue.length) {
      const event = queue.shift()!
      const before = state
      state = reduce(state, event)
      if (state !== before) {
        inRun++
        // Просьба собрать (не повтор): идёт сборка — уже собираем, вторую не ставим.
        if (event.kind === 'deepRequested' && !before.build) build(String(event.data?.reason ?? 'retry'), typeof event.data?.startedAt === 'string' ? event.data.startedAt : undefined)
      }
      if (state.stage !== before.stage || state.round !== before.round || state.waitingFor.join() !== before.waitingFor.join() || state.updatedAt !== before.updatedAt) publish()
    }
    if (!isTerminal(state.stage) && !requesting && !state.build && (inRun >= EVENTS_PER_RUN || workflowInfo().continueAsNewSuggested)) {
      await condition(allHandlersFinished)
      if (!queue.length && !finished.length) await continueAsNew<typeof BftLifecycle>({ ...input, carry: state })
    }
  }
  return statusOf(state)
}

// Отправка БФТ в Confluence (ADR-0028) — отдельный короткий workflow на каждую отправку.
export { ConfluencePublish, progressQuery } from './publish.js'
