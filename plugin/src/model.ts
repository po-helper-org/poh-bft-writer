/**
 * Модель раздела «Управление требованиями».
 *
 * Стадии те же, что в доске Backlog.md команды, — раздел показывает одну
 * рабочую очередь, и заводить второй словарь стадий значило бы разойтись с
 * доской при первом же переименовании.
 */

/**
 * Стадии проработки БФТ. Порядок объявления — хронологический.
 *
 * `NEED-CUSTDEV` — процессное состояние, а не факт на диске: скрипт интервью
 * стадию не двигает (см. `BftArtifacts.custdev`), и ставит его PO. `OKR-ADDED`
 * — БФТ передан в планирование OKR: ставится кнопкой «Добавить в OKR» с доски
 * (см. `okr-handoff.ts`), выше него стадии нет. `BFT-CANCELED` — терминальная
 * отмена решением PO, в хронологию не входит и объявлена последней.
 */
export const CANON_ORDER = [
  'To Do',
  'NEED-CUSTDEV',
  'FAST-DONE',
  'DEEP-REVIEW',
  'DEEP-DONE',
  'OKR-ADDED',
  'BFT-CANCELED',
] as const

export type BftStage = (typeof CANON_ORDER)[number]

/** Терминальная отмена: старше любого файла, не трогается ни в какую сторону. */
export const CANCELED_STAGE: BftStage = 'BFT-CANCELED'

/** Стадия, с которой БФТ передаётся в OKR, и стадия после передачи. */
export const OKR_READY_STAGE: BftStage = 'DEEP-DONE'
export const OKR_ADDED_STAGE: BftStage = 'OKR-ADDED'

/**
 * Порядок в панели: ближе к финалу — выше, чтобы PO дожимал почти готовое.
 * Это рабочая очередь, а не витрина статусов.
 */
export const QUEUE_ORDER = [
  'DEEP-REVIEW',
  'FAST-DONE',
  'NEED-CUSTDEV',
  'To Do',
] as const

/** В очередь не попадают: работа по ним закончена. */
export const HIDDEN_IN_QUEUE: ReadonlySet<BftStage> = new Set<BftStage>(['DEEP-DONE', 'OKR-ADDED', 'BFT-CANCELED'])

export function isStage(value: string): value is BftStage {
  return (CANON_ORDER as readonly string[]).includes(value)
}

/** Позиция стадии в хронологии: чем больше, тем дальше по процессу. */
export function stageRank(stage: BftStage): number {
  return CANON_ORDER.indexOf(stage)
}

/** Ссылки требования, разложенные по видам. Нераспознанное не теряем — оно в `other`. */
export interface BftLinks {
  confluence?: string
  epic?: string
  okr?: string
  /** Путь к собранной странице ревью относительно корня воркспейса. */
  html?: string
  /** Путь к странице CustDev-интервью, если она собрана. Не документ требования: рабочая поверхность встречи. */
  custdev?: string
  /** Ветка entire.io с контекстным чатом последнего закрытого отрезка работы. */
  entire?: string
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
  /**
   * `{slug}-custdev.md` — скрипт CustDev-интервью, и `{slug}-custdev.html` — его
   * страница встречи. Стадию они не двигают: интервью нужно не каждому эпику, и
   * требовать его для FAST-DONE значило бы вернуть в To Do всё уже готовое.
   * Видны на детальной странице, в вердикт стадии не входят.
   */
  custdev: boolean
  custdevHtml: boolean
}

/** Строка списка: всё, что видно в панели без открытия требования. */
export interface BftTaskSummary {
  id: string
  title: string
  stage: BftStage
  /** Откуда взялась стадия. Видно в интерфейсе: догадка и факт — разное. */
  stageSource: 'backlog' | 'artifacts'
  /**
   * Последняя сессия по требованию (журнал работы): идёт ли работа, ждёт ли PO,
   * оборвалась ли — и когда трогали в последний раз. `kind` — чей это чат:
   * харнесса («Открыть чат») или Claude Code с детальной страницы. Нет —
   * из раздела по требованию ещё не работали.
   */
  session?: { id: string; kind: 'harness' | 'claude'; state: 'running' | 'idle' | 'failed' | 'gone'; lastActivityAt: string }
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
  /**
   * Каталог эпика в `docsPath`, когда документ есть. Идентификатор (`id`) и слаг
   * совпадают только у документов, заведённых из раздела; у остальных связку
   * даёт `epic-link.ts`. Нет документа — нет поля.
   */
  slug?: string
  /** Стадия по составу артефактов, независимо от доски. Нет документа — нет поля. */
  artifactStage?: BftStage
  /**
   * Задача доски Backlog.md, с которой слита строка: её стадия и ссылки как
   * записаны. По ним `backlog-writer.ts` решает, что дописать. Нет доски или
   * задача не связалась — поля нет.
   */
  board?: { stage: BftStage; refs: string[] }
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
