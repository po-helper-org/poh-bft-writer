/**
 * Состояние цикла из событий — чистая функция без Temporal (тестируется отдельно,
 * workflow только применяет её). Правила стадий — спека, раздел «Стадии».
 */
import { TERMINAL_STAGES, type BftEvent, type LifecycleInput, type LifecycleState, type LifecycleStatus, type RebuildPending, type Stage, type Wait } from './events.js'

export const TIMELINE_MAX = 200
export const SEEN_MAX = 500

const SUMMARY: Partial<Record<BftEvent['kind'], string>> = {
  registered: 'Заявка заведена',
  scenarioProposed: 'Предложен сценарий приёмки',
  scenarioApproved: 'Заказчик согласовал сценарий приёмки',
  briefRequested: 'Запрошены первичные требования',
  briefBuilt: 'Первичные требования собраны',
  briefApproved: 'Заказчик согласовал первичные требования',
  deepRequested: 'Запрошена сборка полного БФТ',
  deepStarted: 'Началась сборка полного БФТ',
  deepReady: 'Полный БФТ готов',
  deepFailed: 'Полный БФТ не собран',
  formPublished: 'Форма вопросов опубликована',
  formEdited: 'PO поправил вопросы формы',
  formAnswered: 'Получены ответы формы',
  formRevoked: 'Ссылка формы отозвана',
  reviseApplied: 'ИИ-агент внёс правки',
  rebuildRequested: 'Пересборка полного БФТ по ответам формы',
  mailSent: 'Письмо отправлено',
  mailDelivered: 'Письмо доставлено',
  mailBounced: 'Письмо не доставлено',
  mailReplied: 'Ответ письмом',
  trackerMoved: 'Заявку перенесли в трекере',
  validated: 'БФТ согласован',
  handedOff: 'БФТ передан в исполнение',
  cancelled: 'Заявка отменена',
}

export function initialState(input: LifecycleInput): LifecycleState {
  return {
    taskId: input.taskId, slug: input.slug, sessionId: input.sessionId,
    title: input.title ?? `Заявка #${input.taskId}`, createdAt: input.createdAt,
    stage: 'intake', waitingFor: ['customer'], round: 0, artifacts: {},
    timeline: [], seen: [], events: 0, updatedAt: input.createdAt,
  }
}

export const isTerminal = (stage: Stage): boolean => TERMINAL_STAGES.includes(stage)

/** Кого ждёт открытая форма: заказчика и команды-адресаты. */
function formWaits(addressees: readonly string[]): Wait[] {
  const teams = addressees.filter((a) => !/заказчик/i.test(a)).map((a): Wait => `team:${a}`)
  return ['customer', ...teams]
}

/** Стадия и ожидания после события; undefined — событие стадию не меняет. */
function transition(state: LifecycleState, event: BftEvent): { stage: Stage; waitingFor: Wait[]; round?: number } | undefined {
  const building = state.stage === 'agreement' || state.stage === 'rebuilding' || state.round > 0
  switch (event.kind) {
    case 'scenarioProposed':
      return state.stage === 'intake' ? { stage: 'scenario', waitingFor: ['customer'] } : undefined
    case 'scenarioApproved':
    case 'briefRequested':
      return ['intake', 'scenario'].includes(state.stage) ? { stage: 'brief', waitingFor: ['model'] } : undefined
    case 'briefBuilt':
      return ['intake', 'scenario', 'brief', 'brief_review'].includes(state.stage) ? { stage: 'brief_review', waitingFor: ['customer'] } : undefined
    case 'briefApproved':
      return { stage: 'deep', waitingFor: ['model'] }
    case 'deepStarted':
      return { stage: building ? 'rebuilding' : 'deep', waitingFor: ['model'] }
    case 'deepReady':
      // Форма уже открыта (опубликована до этой сборки) — ждём её адресатов, иначе PO.
      return { stage: 'agreement', waitingFor: state.formOpen ? formWaits(state.formOpen.addressees) : ['po'], round: state.round + 1 }
    case 'deepFailed':
      return { stage: 'deep_failed', waitingFor: ['po'] }
    case 'rebuildRequested':
      // Портал начал сборку; не начал (ответы уже учтены, модели нет) — стадия прежняя.
      return event.data?.started === true ? { stage: 'rebuilding', waitingFor: ['model'] } : undefined
    case 'formPublished':
      return state.stage === 'agreement' ? { stage: 'agreement', waitingFor: formWaits(event.data?.addressees ?? []) } : undefined
    case 'formRevoked':
      return state.stage === 'agreement' ? { stage: 'agreement', waitingFor: ['po'] } : undefined
    case 'validated':
      return { stage: 'validated', waitingFor: ['po'] }
    case 'handedOff':
      return { stage: 'handed_off', waitingFor: [] }
    case 'cancelled':
      return { stage: 'cancelled', waitingFor: [] }
    default:
      return undefined
  }
}

/**
 * Пересборка по ответам формы (шаг 2): ответ с паузой — пересборка ждёт до ответа + пауза
 * (новый ответ сдвигает её); сборка, начатая после последнего ответа, или запрос пересборки
 * по нему — снимают ожидание.
 */
function nextRebuild(state: LifecycleState, event: BftEvent): RebuildPending | undefined {
  const pending = state.rebuild
  const after = event.data?.rebuildAfterMs
  if (event.kind === 'formAnswered' && typeof after === 'number' && after >= 0) {
    const t = Date.parse(event.at)
    if (Number.isNaN(t) || (pending && pending.lastSubmitAt >= event.at)) return pending
    return { lastSubmitAt: event.at, dueAt: new Date(t + after).toISOString() }
  }
  if (!pending) return undefined
  if (event.kind === 'deepStarted' && event.at >= pending.lastSubmitAt) return undefined
  if (event.kind === 'rebuildRequested' && typeof event.data?.lastSubmitAt === 'string' && event.data.lastSubmitAt >= pending.lastSubmitAt) return undefined
  return pending
}

/** Применить событие. Повтор (тот же eventId) и события после закрытия цикла — без изменений. */
export function reduce(state: LifecycleState, event: BftEvent): LifecycleState {
  if (state.seen.includes(event.eventId) || isTerminal(state.stage)) return state
  const next = transition(state, event)
  const stage = next?.stage ?? state.stage
  const artifact = event.data?.artifact
  const artifacts = { ...state.artifacts }
  if (artifact) {
    if (event.kind === 'briefBuilt') artifacts.brief = artifact
    if (event.kind === 'deepReady' || event.kind === 'reviseApplied') artifacts.deep = artifact
    if (event.kind === 'formPublished' || event.kind === 'formEdited') artifacts.form = artifact
  }
  const entry = { at: event.at, kind: event.kind, actor: event.actor.kind, summary: event.summary ?? SUMMARY[event.kind] ?? event.kind, stage }
  const formOpen = event.kind === 'formPublished' ? { addressees: event.data?.addressees ?? [] }
    : event.kind === 'formRevoked' ? undefined : state.formOpen
  const rebuild = nextRebuild(state, event)
  return {
    ...state,
    ...(formOpen ? { formOpen } : { formOpen: undefined }),
    rebuild,
    stage,
    waitingFor: next?.waitingFor ?? state.waitingFor,
    round: next?.round ?? state.round,
    questions: event.data?.questions ?? state.questions,
    artifacts,
    timeline: [...state.timeline, entry].slice(-TIMELINE_MAX),
    seen: [...state.seen, event.eventId].slice(-SEEN_MAX),
    events: state.events + 1,
    updatedAt: event.at > state.updatedAt ? event.at : state.updatedAt,
  }
}

export function statusOf(state: LifecycleState): LifecycleStatus {
  const { taskId, slug, title, stage, waitingFor, round, questions, artifacts, rebuild, build, events, createdAt, updatedAt } = state
  return { taskId, slug, title, stage, waitingFor, round, ...(questions ? { questions } : {}), artifacts, ...(rebuild ? { rebuild } : {}), ...(build ? { build } : {}), events, createdAt, updatedAt }
}
