/**
 * Очередь из доски Backlog.md.
 *
 * Раздел работает и без неё — стадию тогда даёт сам документ (`stage.ts`). Но
 * когда доска есть, она источник правды по процессу: задача может быть заведена
 * раньше, чем появится хоть один документ, и на доске ей место сразу. Без этого
 * «агент завёл требование» ничем не заканчивается до первого прогона `/bft-fast`.
 *
 * Основной вход — `task list --type bft --json`: одним вызовом приходят id,
 * статус и ссылки задачи, а фильтр по типу делает сам CLI, точно по полю.
 * Разбор `--plain` остаётся запасным путём для CLI без `--json`.
 */
import { isStage, type BftStage, type BftTaskSummary } from './model.js'

/** Задача доски, как её отдаёт `task list --json`: то, что нужно для связки и записи. */
export interface BacklogTask extends BftTaskSummary {
  /** `references` задачи как записаны — нормализует их уже связка (`epic-link.ts`). */
  refs: string[]
}

/** Заголовок группы — стадия. Сам ряд её не содержит. */
const GROUP_RE = /^(\S.*):$/
/** `[HIGH] [bft] TASK-1 - Название`; приоритет и тип необязательны. */
const ROW_RE = /^\s+(?:\[(?:HIGH|MEDIUM|LOW)\]\s+)?(?:\[(\w+)\]\s+)?([A-Za-z]+-[\d.]+)\s+-\s+(.+)$/
/** Служебный префикс, которым скилл помечает задачи при заведении. */
const TITLE_PREFIX = /^БФТ:\s*/
/** Хвост `(ac: 0/1)` — сводка критериев приёмки, часть вывода CLI, а не названия. */
const AC_SUFFIX = /\s*\(ac:\s*\d+\/\d+\)\s*$/

/** Название без служебного префикса навыка. Экспортировано: тем же правилом сверяет H1 связка. */
export function stripTitlePrefix(title: string): string {
  return title.replace(AC_SUFFIX, '').replace(TITLE_PREFIX, '').trim()
}

/**
 * Разбирает вывод `backlog task list --type <тип> --json`.
 *
 * Формат версионный (`schemaVersion`), и чужая версия или чужой `kind` — не
 * «попробуем как-нибудь», а пустой список: угадывать поля значило бы показать
 * PO уверенную неправду о стадиях. Статус вне канона (`In Progress`, `Done`) —
 * задача не из процесса БФТ, она не показывается, как и при разборе `--plain`.
 *
 * Тип здесь не фильтруется повторно: список уже отфильтрован CLI. Но поле есть,
 * и чужой тип на всякий случай отбрасывается — вызвали без `--type`, получим то же.
 */
export function parseTaskListJson(stdout: string, taskType = 'bft'): BacklogTask[] {
  let raw: unknown
  try {
    raw = JSON.parse(stdout.replace(/^﻿/, ''))
  } catch {
    return []
  }
  if (typeof raw !== 'object' || raw === null) return []
  const doc = raw as { schemaVersion?: unknown; kind?: unknown; tasks?: unknown }
  if (doc.schemaVersion !== 1 || doc.kind !== 'task-list' || !Array.isArray(doc.tasks)) return []

  const out: BacklogTask[] = []
  for (const item of doc.tasks) {
    if (typeof item !== 'object' || item === null) continue
    const task = item as Record<string, unknown>
    if (typeof task.id !== 'string' || task.id === '') continue
    if (typeof task.status !== 'string' || !isStage(task.status)) continue
    if (typeof task.type === 'string' && task.type !== '' && task.type !== taskType) continue
    const refs = Array.isArray(task.references)
      ? task.references.filter((ref): ref is string => typeof ref === 'string' && ref.trim() !== '')
      : []
    out.push({
      id: task.id,
      title: stripTitlePrefix(typeof task.title === 'string' ? task.title : task.id),
      stage: task.status,
      stageSource: 'backlog',
      refs,
    })
  }
  return out
}

/**
 * Разбирает вывод `backlog task list --plain`.
 *
 * Тип фильтруется, только если он в строке есть: доска команды может не
 * размечать задачи типом вовсе, и отбрасывать тогда всё подряд значило бы
 * показать пустой раздел при полной доске.
 */
export function parseTaskList(stdout: string, taskType = 'bft'): BacklogTask[] {
  const normalized = stdout.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const out: BacklogTask[] = []
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
      title: stripTitlePrefix(row[3]),
      stage,
      stageSource: 'backlog',
      // Ссылок в plain-выводе нет — связка по ним невозможна, остаются слаг и H1.
      refs: [],
    })
  }
  return out
}
