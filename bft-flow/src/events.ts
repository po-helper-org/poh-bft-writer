/**
 * Схема событий цикла БФТ (ADR-0022, спека «жизненный цикл БФТ на Temporal»).
 *
 * Событие — всё, что случилось с заявкой: ход чата, согласование, сборка,
 * форма, ответы, письма, перенос в трекере. Источник (портал, почтовый поллер)
 * ставит `eventId` — повтор того же события цикл игнорирует. Тексты документов
 * в событие не кладём: только ссылки на артефакты и короткую сводку.
 *
 * Модуль без зависимостей: его импортирует и код workflow (песочница Temporal),
 * и портал (копия типов — customer-form/src/lifecycle.ts).
 */

export const TASK_QUEUE = 'bft-flow'
/** Очередь активностей портала: модель, файлы заявки, трекер (воркер — сам портал). */
export const PORTAL_TASK_QUEUE = 'bft-portal'
export const NAMESPACE_DEFAULT = 'bft'
export const WORKFLOW_TYPE = 'BftLifecycle'
export const workflowIdOf = (taskId: number): string => `bft-${taskId}`

export type Stage =
  | 'intake' | 'scenario' | 'brief' | 'brief_review' | 'deep' | 'deep_failed'
  | 'agreement' | 'rebuilding' | 'validated' | 'handed_off' | 'cancelled'

export const TERMINAL_STAGES: readonly Stage[] = ['handed_off', 'cancelled']

/** Чего ждёт цикл: заказчик, PO, команда (team:<имя>), модель. */
export type Wait = 'customer' | 'po' | 'model' | `team:${string}`

export type ActorKind = 'customer' | 'po' | 'team' | 'system' | 'mail'
export interface Actor { kind: ActorKind; id?: string; name?: string }

export type EventKind =
  | 'registered'        // заявка заведена в трекере
  | 'chatTurn'          // ход диалога (сводка, не текст)
  | 'materialAdded'     // файл, голос, ссылка заказчика
  | 'scenarioProposed' | 'scenarioApproved'
  | 'briefRequested' | 'briefBuilt' | 'briefApproved'
  | 'deepRequested'     // просьба собрать полный БФТ («Да, согласен», «Собрать заново») — сборку ведёт цикл (шаг 3)
  | 'deepStarted' | 'deepReady' | 'deepFailed'
  | 'formPublished' | 'formEdited' | 'formAnswered' | 'formRevoked'
  | 'reviseApplied'     // точечные правки ИИ-агента (ADR-0021)
  | 'rebuildRequested'  // цикл попросил портал пересобрать полный БФТ по ответам формы (шаг 2)
  | 'mailSent' | 'mailDelivered' | 'mailBounced' | 'mailReplied'
  | 'trackerMoved'      // перенос колонки в «Управлении БФТ» (теневой режим, шаг 1)
  | 'trackerObserved'   // колонка задачи в трекере, как её видит портал или поставил цикл (шаг 4)
  | 'validated' | 'handedOff' | 'cancelled'
  | 'note'              // произвольная запись в хронику

/** Ссылка на файл заявки: путь от корня папки заявки, хэш, ревизия. */
export interface ArtifactRef { path: string; sha256?: string; rev?: string }

export interface BftEvent {
  eventId: string
  /** ISO-время события у источника (не время доставки в цикл). */
  at: string
  actor: Actor
  kind: EventKind
  /** Одна строка для хроники: «Заказчик согласовал сценарий». */
  summary?: string
  data?: {
    artifact?: ArtifactRef
    /** formAnswered: всего вопросов и отвечено после этой отправки. */
    questions?: { total: number; answered: number; unknown?: number }
    /** formPublished / mail*: адресаты. */
    addressees?: string[]
    /** trackerMoved: колонка. */
    to?: string
    /** deepFailed, mailBounced: причина. */
    error?: string
    /** formAnswered: через сколько после ответа пересобрать полный БФТ (пауза — отвечают пачкой). */
    rebuildAfterMs?: number
    [key: string]: unknown
  }
}

export interface LifecycleInput {
  taskId: number
  slug: string
  sessionId: string
  title?: string
  createdAt: string
  /** continueAsNew: состояние предыдущего прогона. */
  carry?: LifecycleState
}

export interface TimelineEntry { at: string; kind: EventKind; actor: ActorKind; summary: string; stage: Stage }

export interface LifecycleState {
  taskId: number
  slug: string
  sessionId: string
  title: string
  createdAt: string
  stage: Stage
  waitingFor: Wait[]
  /** Номер раунда согласования: растёт с каждой готовой версией полного БФТ. */
  round: number
  questions?: { total: number; answered: number; unknown?: number }
  artifacts: { brief?: ArtifactRef; deep?: ArtifactRef; form?: ArtifactRef }
  /** Форма вопросов опубликована и не отозвана: кого она ждёт. */
  formOpen?: { addressees: string[] }
  /** Ждёт пересборка по ответам формы: последний учтённый ответ и когда пересобрать. */
  rebuild?: RebuildPending
  /** Сборка полного БФТ, которую ведёт цикл (шаг 3): идёт и, возможно, ещё одна в очереди. */
  build?: { reason: string; startedAt: string; queued?: { reason: string; lastSubmitAt?: string } }
  /** Сколько сборок запускал цикл — номер в id дочернего workflow. */
  builds?: number
  /** Колонка доски «Запросы» и с какого момента она известна циклу (шаг 4). */
  column?: string
  columnAt?: string
  /** Последние записи хроники (не больше TIMELINE_MAX). */
  timeline: TimelineEntry[]
  /** eventId последних событий — повтор не применяется. */
  seen: string[]
  events: number
  updatedAt: string
}

export interface RebuildPending { lastSubmitAt: string; dueAt: string }

/** Активности портала (очередь bft-portal). */
export interface RebuildRequest { taskId: number; slug: string; sessionId: string; lastSubmitAt: string }
export interface RebuildResult { started: boolean; reason?: string }
/** Сборка полного БФТ (дочерний DeepBuild → активность buildDeep). */
export interface DeepBuildRequest {
  taskId: number
  slug: string
  sessionId: string
  /** Время начала — и в файле состояния, и в eventId хроники (`deep:*:<startedAt>`). */
  startedAt: string
  reason: 'approved' | 'retry' | 'answers' | 'chat' | string
  /** reason=answers: последний ответ формы — портал не собирает, если сборка после него уже была. */
  lastSubmitAt?: string
}
export interface DeepBuildResult {
  stage: 'ready' | 'failed' | 'skipped'
  startedAt: string
  finishedAt?: string
  error?: string
  /** skipped: почему не собирали (заявка MCP, не найдена). */
  reason?: string
}

/**
 * Трекер — проекция цикла (шаг 4). Цикл сам переносит карточку только между колонками,
 * которые следуют из работы над документом; остальные — решения PO, цикл их принимает.
 */
export const AUTO_COLUMNS: readonly string[] = ['Создан', 'Проработка БФТ']
export const COLUMN_CANCELLED = 'Отменено'
export const COLUMN_ESTIMATE = 'Оценка'
export const COLUMN_NEEDS_PO = 'Ожидает PO'
export const COLUMN_TO_WORK_PREFIX = 'В работу'

/** Колонка, в которой карточке быть на этой стадии; undefined — решает PO. */
export function columnFor(stage: Stage): string | undefined {
  switch (stage) {
    case 'intake': case 'scenario': case 'brief': case 'brief_review': return 'Создан'
    case 'deep': case 'deep_failed': case 'agreement': case 'rebuilding': return 'Проработка БФТ'
    default: return undefined
  }
}

export interface MoveTicketRequest { taskId: number; to: string; from: string; reason: string }
export interface MoveTicketResult { moved: boolean; /** Колонка после вызова (PO мог уже перенести сам). */ column: string }

export interface PortalActivities {
  /** Шаг 2 (оставлена для историй, начатых до шага 3): пересобрать по ответам формы. */
  rebuildFromAnswers(request: RebuildRequest): Promise<RebuildResult>
  /** Собрать полный БФТ; пульс раз в 20 с — рестарт портала посреди сборки → повтор. */
  buildDeep(request: DeepBuildRequest): Promise<DeepBuildResult>
  /** Перенести карточку в колонку, если она сейчас в одной из AUTO_COLUMNS (иначе — не трогать). */
  moveTicket(request: MoveTicketRequest): Promise<MoveTicketResult>
}

export interface LifecycleStatus {
  taskId: number
  slug: string
  title: string
  stage: Stage
  waitingFor: Wait[]
  round: number
  questions?: LifecycleState['questions']
  artifacts: LifecycleState['artifacts']
  rebuild?: RebuildPending
  build?: LifecycleState['build']
  column?: string
  events: number
  createdAt: string
  updatedAt: string
}
