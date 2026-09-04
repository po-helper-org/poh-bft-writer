/**
 * Модель раздела «Управление требованиями».
 *
 * Стадии те же, что в доске Backlog.md команды, — раздел показывает одну
 * рабочую очередь, и заводить второй словарь стадий значило бы разойтись с
 * доской при первом же переименовании.
 */

/** Стадии проработки БФТ. Порядок объявления — хронологический. */
export const CANON_ORDER = [
  'To Do',
  'FAST-DONE',
  'REVIEW-DONE',
  'DEEP-WORK',
  'DEEP-REVIEW',
  'DEEP-DONE',
  'Cancelled',
] as const

export type BftStage = (typeof CANON_ORDER)[number]

/**
 * Порядок в панели: ближе к финалу — выше, чтобы PO дожимал почти готовое.
 * Это рабочая очередь, а не витрина статусов.
 */
export const QUEUE_ORDER = [
  'DEEP-REVIEW',
  'DEEP-WORK',
  'REVIEW-DONE',
  'FAST-DONE',
  'To Do',
] as const

/** В очередь не попадают: работа по ним закончена. */
export const HIDDEN_IN_QUEUE: ReadonlySet<BftStage> = new Set<BftStage>(['DEEP-DONE', 'Cancelled'])

export function isStage(value: string): value is BftStage {
  return (CANON_ORDER as readonly string[]).includes(value)
}

/** Ссылки требования, разложенные по видам. Нераспознанное не теряем — оно в `other`. */
export interface BftLinks {
  confluence?: string
  epic?: string
  okr?: string
  /** Путь к собранной странице ревью относительно корня воркспейса. */
  html?: string
  other: string[]
}

/**
 * Артефакты эпика на диске. Из них выводится стадия, когда доски нет.
 *
 * Страницы ревью две, и различать их обязательно: `{slug}-fast.html` закрывает
 * стадию fast, `{slug}.html` — стадию deep. Один общий флаг «html есть» засчитал
 * бы страницу от быстрого прохода как готовность глубокого.
 */
export interface BftArtifacts {
  /** `{slug}-fast.md` — документ стадии fast. */
  fast: boolean
  /** `{slug}-fast.html` — страница ревью стадии fast. */
  fastHtml: boolean
  /** `{slug}.md` — единый документ после deep. */
  deep: boolean
  /** `{slug}.html` — страница ревью единого документа. */
  deepHtml: boolean
}

/** Строка списка: всё, что видно в панели без открытия требования. */
export interface BftTaskSummary {
  id: string
  title: string
  stage: BftStage
  /** Откуда взялась стадия. Видно в интерфейсе: догадка и факт — разное. */
  stageSource: 'backlog' | 'artifacts'
}

/** Полное требование: то, что показывают превью и детальная страница. */
/** Разбор стадии: что получилось и чего не хватило до следующей. */
export interface StageVerdict {
  stage: BftStage
  /**
   * Чего не хватает до следующей стадии, человеческими словами. Пусто — всё
   * на месте. Без этого «вернулось в DEEP-REVIEW» не отвечает на вопрос
   * «а что чинить», и PO идёт выяснять это руками.
   */
  missing: string[]
}

export interface BftTask extends BftTaskSummary {
  /** Заказчик инициативы: «ФИО (подразделение)». */
  customer?: string
  description: string
  smart?: string
  howToDemo: string[]
  links: BftLinks
  artifacts: BftArtifacts
  /** Чего не хватает до следующей стадии. Пусто — всё на месте. */
  missing: string[]
  cancelReason?: string
}
