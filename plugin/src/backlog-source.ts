/**
 * Очередь из доски Backlog.md.
 *
 * Раздел работает и без неё — стадию тогда даёт сам документ (`stage.ts`). Но
 * когда доска есть, она источник правды по процессу: задача может быть заведена
 * раньше, чем появится хоть один документ, и на доске ей место сразу. Без этого
 * «агент завёл требование» ничем не заканчивается до первого прогона `/bft-fast`.
 */
import { isStage, type BftStage, type BftTaskSummary } from './model.js'

/** Заголовок группы — стадия. Сам ряд её не содержит. */
const GROUP_RE = /^(\S.*):$/
/** `[HIGH] [bft] TASK-1 - Название`; приоритет и тип необязательны. */
const ROW_RE = /^\s+(?:\[(?:HIGH|MEDIUM|LOW)\]\s+)?(?:\[(\w+)\]\s+)?([A-Za-z]+-[\d.]+)\s+-\s+(.+)$/
/** Служебный префикс, которым скилл помечает задачи при заведении. */
const TITLE_PREFIX = /^БФТ:\s*/
/** Хвост `(ac: 0/1)` — сводка критериев приёмки, часть вывода CLI, а не названия. */
const AC_SUFFIX = /\s*\(ac:\s*\d+\/\d+\)\s*$/

/**
 * Разбирает вывод `backlog task list --plain`.
 *
 * Тип фильтруется, только если он в строке есть: доска команды может не
 * размечать задачи типом вовсе, и отбрасывать тогда всё подряд значило бы
 * показать пустой раздел при полной доске.
 */
export function parseTaskList(stdout: string, taskType = 'bft'): BftTaskSummary[] {
  const normalized = stdout.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const out: BftTaskSummary[] = []
  let stage: BftStage | null = null

  for (const line of normalized.split('\n')) {
    const group = GROUP_RE.exec(line)
    if (group) {
      stage = isStage(group[1]) ? group[1] : null
      continue
    }
    if (!stage) continue

    const row = ROW_RE.exec(line)
    if (!row) continue
    const type = row[1]
    if (type !== undefined && type !== taskType) continue

    out.push({
      id: row[2],
      title: row[3].replace(AC_SUFFIX, '').replace(TITLE_PREFIX, '').trim(),
      stage,
      stageSource: 'backlog',
    })
  }
  return out
}
