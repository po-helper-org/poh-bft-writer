/**
 * Передача требования в чат.
 *
 * Кнопка «Работать в чате» подставляет черновик, отправляет всегда человек.
 * Смысл этого модуля — чтобы черновик не начинался с нуля: если по требованию
 * уже был закрытый отрезок работы, модель обязана продолжить с него, а не
 * разбирать всё заново. Ссылка на ветку контекстного чата entire.io идёт в
 * черновик прямым текстом — по ней модель поднимает прошлый разговор.
 */
import { branchUrl, type BftPluginConfig } from './config.js'
import type { BftTask } from './model.js'
import type { WorkEntry } from './worklog.js'

export interface Handoff {
  /** Текст, который подставляется в поле ввода чата. */
  prompt: string
  /** Ссылка на ветку контекстного чата, если отрезок с ней уже был. */
  contextUrl?: string
  /** Продолжение прошлого отрезка, а не первый заход. */
  continued: boolean
}

export function buildHandoff(
  task: BftTask,
  last: WorkEntry | null,
  config: BftPluginConfig,
): Handoff {
  const contextUrl = config.entire ? branchUrl(config.entire, last?.contextRef) : undefined
  const lines = [`Продолжи работу над БФТ ${task.id} «${task.title}».`, `Стадия: ${task.stage}.`]

  if (task.missing.length) {
    // Стадия сама по себе не говорит, что делать. Нехватка — говорит.
    lines.push(`До следующей стадии не хватает: ${task.missing.join(', ')}.`)
  }

  if (last?.summary) {
    lines.push('', `Прошлый заход (${shortDate(last.finishedAt)}) закончился так: ${last.summary}`)
  }
  if (contextUrl) {
    lines.push(
      `Контекст того захода — ветка entire.io: ${contextUrl}`,
      'Подними её и продолжи оттуда, а не с нуля: то, что там уже разобрано, заново не разбирай.',
    )
  } else if (config.entire) {
    lines.push('', 'Закрытых отрезков работы по этому требованию ещё нет — это первый заход.')
  }

  if (task.links.html) lines.push('', `Документ и страница ревью: ${task.links.html}`)

  return { prompt: lines.join('\n'), contextUrl, continued: !!contextUrl }
}

/** Что известно о задаче доски сверх строки списка: описание, приёмка, заметки, документация. */
export interface BoardTaskDetails {
  description?: string
  acceptanceCriteria?: string[]
  notes?: string
  documentation?: string[]
}

/** Разбор `backlog task view <id> --json` в детали черновика. Чужой формат — пустые детали. */
export function parseTaskViewJson(stdout: string): BoardTaskDetails {
  let raw: unknown
  try {
    raw = JSON.parse(stdout.replace(/^\uFEFF/, ''))
  } catch {
    return {}
  }
  if (typeof raw !== 'object' || raw === null) return {}
  const doc = raw as { schemaVersion?: unknown; kind?: unknown; task?: unknown }
  if (doc.schemaVersion !== 1 || doc.kind !== 'task-view' || typeof doc.task !== 'object' || doc.task === null) return {}
  const task = doc.task as Record<string, unknown>
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined)
  const criteria = Array.isArray(task.acceptanceCriteria)
    ? task.acceptanceCriteria
      .map(item => (typeof item === 'object' && item !== null ? (item as { text?: unknown }).text : item))
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  const documentation = Array.isArray(task.documentation)
    ? task.documentation.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : []
  return {
    description: text(task.description),
    acceptanceCriteria: criteria,
    notes: text(task.implementationNotes),
    documentation,
  }
}

/** Слаг эпика для документа, заведённого из раздела: идентификатор задачи строчными. */
export function slugForTask(id: string): string {
  return id.toLowerCase()
}

/**
 * Черновик создания документа: `/bft-fast` для задачи, у которой документа ещё нет.
 *
 * Источник навыку даётся явно и дословно — описание, критерии приёмки и заметки
 * задачи, — а не только идентификатором: так модель не идёт искать текст сама и
 * не додумывает его. Название диктуется дословно, а слаг — идентификатором
 * задачи: по ним раздел потом узнаёт каталог эпика (`epic-link.ts`).
 */
export function buildCreateDraft(task: BftTask, details: BoardTaskDetails): Handoff {
  const slug = slugForTask(task.id)
  const lines = [
    `/bft-fast ${task.id} ${slug}`,
    '',
    `Источник — задача Backlog.md ${task.id} «${task.title}»: её описание, критерии приёмки и заметки ` +
      `(они же — \`backlog task view ${task.id} --plain\`). Ниже они дословно; больше ничего не читать и не выдумывать: ` +
      'чего в задаче нет — в «Открытые вопросы».',
    '',
    `Название эпика (дословно в H1): ${task.title}`,
    // Путь — через docs_path навыка, а не через docsPath плагина: корень воркспейса
    // чата и корень раздела совпадают не всегда (чат может идти из родительского
    // каталога), а bft-config.md воркспейса чата знает свой путь точно.
    `Слаг эпика (epic_slug): ${slug}. Документ — <docs_path>/${slug}/${slug}-fast.md по docs_path из bft-config.md, ` +
      `страница ревью ${slug}-fast.html рядом с ним.`,
  ]
  if (details.description) lines.push('', 'Описание:', details.description)
  if (details.acceptanceCriteria?.length) {
    lines.push('', 'Критерии приёмки:', ...details.acceptanceCriteria.map((item, i) => `${i + 1}. ${item}`))
  }
  if (details.notes) lines.push('', 'Заметки:', details.notes)
  if (details.documentation?.length) lines.push('', 'Документация задачи:', ...details.documentation.map(item => `- ${item}`))
  return { prompt: lines.join('\n'), continued: false }
}

function shortDate(iso: string | undefined): string {
  if (!iso) return 'дата неизвестна'
  const date = new Date(iso)
  if (isNaN(date.getTime())) return 'дата неизвестна'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}
