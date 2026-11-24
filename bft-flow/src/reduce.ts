/**
 * Состояние цикла из событий — чистая функция без Temporal (тестируется отдельно,
 * workflow только применяет её). Правила стадий — спека, раздел «Стадии».
 */
import { TERMINAL_STAGES, type BftEvent, type LifecycleInput, type LifecycleState, type LifecycleStatus, type Stage, type Wait } from './events.js'

export const TIMELINE_MAX = 200
export const SEEN_MAX = 500

const SUMMARY: Partial<Record<BftEvent['kind'], string>> = {
  registered: 'Заявка заведена',
  scenarioProposed: 'Предложен сценарий приёмки',
  scenarioApproved: 'Заказчик согласовал сценарий приёмки',
  briefRequested: 'Запрошены первичные требования',
  briefBuilt: 'Первичные требования собраны',
  briefApproved: 'Заказчик согласовал первичные требования',
  deepStarted: 'Началась сборка полного БФТ',
  deepReady: 'Полный БФТ готов',
  deepFailed: 'Полный БФТ не собран',
  formPublished: 'Форма вопросов опубликована',
  formEdited: 'PO поправил вопросы формы',
  formAnswered: 'Получены ответы формы',
  formRevoked: 'Ссылка формы отозвана',
  reviseApplied: 'ИИ-агент внёс правки',
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
      return { stage: 'agreement', waitingFor: ['po'], round: state.round + 1 }
    case 'deepFailed':
      return { stage: 'deep_failed', waitingFor: ['po'] }
    case 'formPublished': {
      if (state.stage !== 'agreement') return undefined
      const teams = (event.data?.addressees ?? []).filter((a) => !/заказчик/i.test(a)).map((a): Wait => `team:${a}`)
      return { stage: 'agreement', waitingFor: ['customer', ...teams] }
    }
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
  return {
    ...state,
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
  const { taskId, slug, title, stage, waitingFor, round, questions, artifacts, events, createdAt, updatedAt } = state
  return { taskId, slug, title, stage, waitingFor, round, ...(questions ? { questions } : {}), artifacts, events, createdAt, updatedAt }
}
