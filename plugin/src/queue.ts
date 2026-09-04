/**
 * Группировка очереди, колонок доски и поиск. Чистые функции: на вход список,
 * на выход список.
 */
import {
  CANON_ORDER, HIDDEN_IN_QUEUE, QUEUE_ORDER,
  type BftStage, type BftTask, type BftTaskSummary,
} from './model.js'

export interface BftGroup {
  stage: BftStage
  tasks: BftTaskSummary[]
}

/** Числовая часть идентификатора: PO-9 должен идти раньше PO-20. */
function numberOf(id: string): number {
  return Number.parseFloat(id.replace(/^[A-Za-z]+-/, '')) || 0
}

/**
 * Порядок внутри стадии — по номеру, потом по имени.
 *
 * Приоритета в модели нет намеренно: он живёт в доске Backlog.md, а раздел
 * обязан работать и без неё. Сортировать по полю, которого в основном режиме
 * не существует, значило бы получить произвольный порядок вместо осмысленного.
 */
function byIdThenTitle(a: BftTaskSummary, b: BftTaskSummary): number {
  return numberOf(a.id) - numberOf(b.id) || a.id.localeCompare(b.id)
}

function group(tasks: readonly BftTaskSummary[], stages: readonly BftStage[], keepEmpty: boolean): BftGroup[] {
  return stages
    .map(stage => ({ stage, tasks: tasks.filter(t => t.stage === stage).sort(byIdThenTitle) }))
    .filter(g => keepEmpty || g.tasks.length > 0)
}

/** Очередь панели: ближе к финалу выше, завершённое и отменённое скрыто, пустых групп нет. */
export function queueGroups(tasks: readonly BftTaskSummary[]): BftGroup[] {
  return group(tasks.filter(t => !HIDDEN_IN_QUEUE.has(t.stage)), QUEUE_ORDER, false)
}

/**
 * Доска: все стадии в хронологии, пустые колонки сохраняются — на канбане
 * колонка без карточек тоже несёт смысл «сюда ничего не дошло».
 */
export function boardColumns(tasks: readonly BftTaskSummary[]): BftGroup[] {
  return group(tasks, CANON_ORDER, true)
}

/** Сколько требований в очереди — без завершённых и отменённых. */
export function queueSize(tasks: readonly BftTaskSummary[]): number {
  return tasks.filter(task => !HIDDEN_IN_QUEUE.has(task.stage)).length
}

/**
 * Поиск по идентификатору и названию, а также по заказчику и описанию, когда
 * они есть: в списке этих полей нет, они появляются после разбора карточки.
 *
 * Регистр и вид дефиса значения не имеют: PO набирает «po-21», «PO 21» и
 * «PO–21» вперемешку, и все три обязаны найти одно и то же.
 */
export function searchTasks<T extends BftTaskSummary>(tasks: readonly T[], query: string): T[] {
  const needle = normalize(query)
  if (!needle) return [...tasks]
  return tasks.filter(task => {
    const full = task as Partial<BftTask>
    const haystack = [task.id, task.title, full.customer, full.description]
      .filter((part): part is string => typeof part === 'string')
      .join(' ')
    return normalize(haystack).includes(needle)
  })
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    // Дефис, минус и тире — разные символы, а в идентификаторе задачи PO их не
    // различает: «PO-21» из чата и «PO–21» из панели должны совпасть.
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}
