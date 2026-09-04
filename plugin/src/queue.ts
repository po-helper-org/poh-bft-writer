/** Группировка очереди и поиск. Чистые функции: на вход список, на выход список. */
import { HIDDEN_IN_QUEUE, QUEUE_ORDER, type BftStage, type BftTaskSummary } from './model.js'

export interface QueueGroup {
  stage: BftStage
  tasks: BftTaskSummary[]
}

/**
 * Очередь по стадиям в порядке `QUEUE_ORDER`. Пустые группы не показываются:
 * панель — рабочий список, а не таблица всех возможных состояний.
 */
export function groupQueue(tasks: readonly BftTaskSummary[]): QueueGroup[] {
  const groups: QueueGroup[] = []
  for (const stage of QUEUE_ORDER) {
    const inStage = tasks.filter(task => task.stage === stage)
    if (inStage.length) groups.push({ stage, tasks: inStage })
  }
  return groups
}

/** Сколько требований в очереди — без завершённых и отменённых. */
export function queueSize(tasks: readonly BftTaskSummary[]): number {
  return tasks.filter(task => !HIDDEN_IN_QUEUE.has(task.stage)).length
}

/**
 * Поиск по идентификатору и названию. Регистр и раскладка пробелов значения не
 * имеют: PO набирает «po-21», «PO 21» и «PO–21» вперемешку, и все три обязаны
 * найти одно и то же.
 */
export function searchTasks<T extends BftTaskSummary>(tasks: readonly T[], query: string): T[] {
  const needle = normalize(query)
  if (!needle) return [...tasks]
  return tasks.filter(task => normalize(`${task.id} ${task.title}`).includes(needle))
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
