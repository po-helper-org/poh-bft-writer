/**
 * Обратная запись в Backlog.md: стадия и ссылка на страницу ревью по факту
 * артефактов.
 *
 * Навык пишет файлы, плагин их видит и приводит доску в соответствие — PO
 * больше не ходит руками за `backlog task edit` после каждого `/bft-fast`.
 *
 * Инварианты, которые здесь важнее удобства:
 * - стадия двигается только вверх по `CANON_ORDER`. Вниз — никогда: доска знает
 *   про процесс больше, чем видно по файлам (`REVIEW-DONE`, `DEEP-WORK` ставит
 *   PO), и «понизить» значило бы стереть его решение;
 * - `Cancelled` не трогается ни в какую сторону: отмена — решение PO, а не факт
 *   на диске;
 * - правка только при расхождении: повторный проход по неизменному воркспейсу
 *   ничего не вызывает.
 *
 * Решение (`planBacklogEdits`) чистое и проверяется без CLI; запись
 * (`applyBacklogEdits`) — единственное место, где команда действительно зовётся.
 */
import type { BftPluginConfig } from './config.js'
import { normalizeDocsRef } from './epic-link.js'
import { stageRank, type BftStage, type BftTask } from './model.js'
import type { BftPorts } from './ports.js'

export interface BacklogEdit {
  id: string
  /** Новая стадия; нет — стадия доски уже не ниже стадии по артефактам. */
  stage?: BftStage
  /** Ссылка, которой у задачи ещё нет. */
  addRef?: string
}

export interface BacklogEditResult extends BacklogEdit {
  ok: boolean
  /** Первая строка ответа CLI при провале — то, что PO прочтёт в панели. */
  error?: string
}

/**
 * Что дописать на доску, чтобы она соответствовала артефактам.
 *
 * Берутся только слитые строки — с задачей доски (`board`) и документом
 * (`artifactStage`): у задачи без документа нечего записывать, у документа без
 * задачи некуда.
 */
export function planBacklogEdits(tasks: readonly BftTask[], docsPath: string): BacklogEdit[] {
  const edits: BacklogEdit[] = []
  for (const task of tasks) {
    if (!task.board || task.artifactStage === undefined) continue
    if (task.board.stage === 'Cancelled') continue

    const edit: BacklogEdit = { id: task.id }
    if (stageRank(task.artifactStage) > stageRank(task.board.stage)) edit.stage = task.artifactStage

    const html = task.links.html
    if (html) {
      const known = task.board.refs
        .map(ref => normalizeDocsRef(ref, docsPath))
        .filter((ref): ref is string => ref !== null)
      if (!known.some(ref => ref.toLowerCase() === html.toLowerCase())) edit.addRef = html
    }

    if (edit.stage !== undefined || edit.addRef !== undefined) edits.push(edit)
  }
  return edits
}

/**
 * Записать правки одной командой на задачу. Провал одной задачи не мешает
 * остальным и не роняет скан: результат каждой уходит наверх, а панель
 * показывает причину рядом с задачей.
 */
export async function applyBacklogEdits(
  edits: readonly BacklogEdit[],
  config: BftPluginConfig,
  ports: BftPorts,
): Promise<BacklogEditResult[]> {
  if (!config.backlogBin || edits.length === 0) return []

  const results: BacklogEditResult[] = []
  for (const edit of edits) {
    const args = ['task', 'edit', edit.id]
    if (edit.stage !== undefined) args.push('-s', edit.stage)
    if (edit.addRef !== undefined) args.push('--add-ref', edit.addRef)
    args.push('--plain')
    const { stdout, stderr, code } = await ports.runCommand(config.backlogBin, args, config.workspaceRoot)
    if (code === 0) {
      results.push({ ...edit, ok: true })
    } else {
      const first = `${stderr ?? ''}\n${stdout}`.split('\n').map(line => line.trim()).find(line => line !== '')
      results.push({ ...edit, ok: false, error: first ?? `backlog task edit: код ${code}` })
    }
  }
  return results
}
