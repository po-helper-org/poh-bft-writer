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
export interface PortalActivities {
  /** Пересобрать полный БФТ по ответам формы. Идёт сборка — ошибка (Temporal повторит). */
  rebuildFromAnswers(request: RebuildRequest): Promise<RebuildResult>
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
  events: number
  createdAt: string
  updatedAt: string
}
