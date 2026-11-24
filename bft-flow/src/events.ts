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
  | 'trackerMoved'      // перенос колонки в «Управлении БФТ»
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
    /** formAnswered: одна отправка формы — кто, кому были вопросы, сколько ответов (тексты — в файле формы). */
    submission?: FormSubmission
    [key: string]: unknown
  }
}

/**
 * Отправка формы вопросов («Отправить ответы»): входящее событие заявки. Тексты ответов
 * в историю не идут — они в файле формы (по formId и времени отправки).
 */
export interface FormSubmission {
  formId: string
  /** Подпись респондента («Как вас подписать»); нет — отправитель не назвался. */
  author?: string
  /** Адресаты вопросов, на которые ответили (разделы «Для: …» формы). */
  addressees: string[]
  /** Ответов в этой отправке; из них «не знаю / не ко мне». */
  saved: number
  unknown: number
  /** Ответы уже учла готовая сборка, начатая в это время (событие дошло до цикла позже неё). */
  coveredBy?: string
}

/** Пересборка БФТ по ответам этой отправки: ждёт паузу → собирается → готово / ошибка / не понадобилась. */
export type InboxRebuildState = 'waiting' | 'building' | 'ready' | 'failed' | 'skipped'
export interface InboxRebuild { state: InboxRebuildState; /** waiting: когда цикл попросит пересборку. */ dueAt?: string; /** Когда статус сменился. */ at?: string; reason?: string }

/** Входящее событие заявки для сайдбара документа: «Форма заполнена». */
export interface InboxEntry extends FormSubmission {
  /** eventId события formAnswered. */
  id: string
  kind: 'formSubmitted'
  at: string
  rebuild: InboxRebuild
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
  /** Последние записи хроники (не больше TIMELINE_MAX). */
  timeline: TimelineEntry[]
  /** Входящие события (отправки формы) со статусом пересборки, не больше INBOX_MAX. Нет у циклов до этого кода. */
  inbox?: InboxEntry[]
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

export interface PortalActivities {
  /** Шаг 2 (оставлена для историй, начатых до шага 3): пересобрать по ответам формы. */
  rebuildFromAnswers(request: RebuildRequest): Promise<RebuildResult>
  /** Собрать полный БФТ; пульс раз в 20 с — рестарт портала посреди сборки → повтор. */
  buildDeep(request: DeepBuildRequest): Promise<DeepBuildResult>
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
  events: number
  createdAt: string
  updatedAt: string
}
