/**
 * Передача требования в чат.
 *
 * Кнопка «Работать в чате» подставляет черновик, отправляет всегда человек.
 * Черновик открывается слэш-командой навыка, который стоит следующим по
 * стадии: харнесс раскрывает навык только по команде в начале сообщения, а
 * свободный текст «продолжи работу» оставляет модель без инструкций — она
 * идёт искать `SKILL.md` по диску и импровизирует конвейер. Дальше — с чего
 * продолжать: если по требованию уже был закрытый отрезок работы, модель
 * обязана продолжить с него, а не разбирать всё заново; ссылка на ветку
 * контекстного чата entire.io идёт в черновик прямым текстом.
 *
 * Пути в черновике — от рабочего пространства чата, а не от корня раздела:
 * чат идёт из каталога `sessionPath` (по умолчанию — родитель `docsPath`), и
 * путь от корня воркспейса оттуда никуда не ведёт.
 */
import { posix } from 'node:path'
import { branchUrl, type BftPluginConfig } from './config.js'
import type { BftTask } from './model.js'
import type { WorkEntry } from './worklog.js'

export interface Handoff {
  /** Текст, который подставляется в поле ввода чата. */
  prompt: string
  /** Слэш-команда навыка, с которой начинается черновик. Нет — стадии дальше некуда. */
  command?: string
  /** Ссылка на ветку контекстного чата, если отрезок с ней уже был. */
  contextUrl?: string
  /** Продолжение прошлого отрезка, а не первый заход. */
  continued: boolean
}

/**
 * Как отвечать в чат раздела. Полный отчёт «что и как сделано» PO не нужен: он
 * видит документ рядом с чатом. Нужен список правок — коротко, и открытые
 * вопросы, если есть. Формат живёт в черновике плагина, а не в навыках: навыки
 * общие для любого чата, а короткий итог нужен именно рядом с документом.
 */
export const RESPONSE_FORMAT = [
  'Итоговый ответ в чат — коротко, в стиле caveman ultra: без описания процесса, без пересказа',
  'документа, без таблиц и эмодзи. Ровно так:',
  'Внесены правки:',
  '- по одному пункту на правку, одной строкой',
  'Ссылки (только если публиковал или менял):',
  '- JIRA: <полный URL эпика>',
  '- Confluence: <полный URL страницы>',
  'Открытые вопросы (только если есть):',
  '- по одному пункту',
  'Вопрос PO задавай прямо в ответе — ответ придёт следующим сообщением в этот же чат.',
].join('\n')

/**
 * Среда для навыков, которые ходят в Jira/Confluence (`/bft-deliver`, `/bft-deep`).
 * Из чата раздела навык запускается в Claude Code CLI, где серверы MCP
 * подключаются с задержкой и их инструменты отложены: без этой подсказки
 * модель заключала «публиковать нечем» по `bft-env-lint` (тот смотрит только
 * `.mcp.json`, а сервер бывает подключён на уровне пользователя) и не искала
 * инструменты вовсе (проверено на PO-22, 2026-09-15). Значения, которые PO
 * назовёт в чате, пишутся в корневой `bft-config.md`: копия в рабочем
 * пространстве чата производная и перечитывается из корня на каждый ход.
 */
export const MCP_ENVIRONMENT = [
  'Среда: инструменты Jira/Confluence — MCP-инструменты jira_* и confluence_*, ищи их через',
  'ToolSearch; сервер подключается с задержкой — «нет» при первом поиске означает подождать',
  '(Bash: sleep 20) и поискать снова. Отсутствие сервера в .mcp.json (EN002/EN003 у bft-env-lint)',
  'при найденных инструментах — не препятствие. Ничего не найдено после повтора — тогда честно',
  '«MCP недоступен». wiki_space, bft_parent_page_id, tracker_projects, которые PO назовёт в',
  'чате, запиши в bft-config.md корня воркспейса (не в копию рабочего пространства чата).',
].join('\n')

/** Команды навыков, которым нужна подсказка про MCP: те, что ходят в Jira/Confluence. */
function needsMcp(command: string | undefined): boolean {
  return command !== undefined && /^\/bft-(deliver|deep)\b/.test(command)
}

export interface HandoffOptions {
  /** Каталог рабочего пространства чата относительно корня воркспейса; `''` — сам корень. */
  chatDir?: string
  /** Правка PO к документу — уходит в черновик как обратная связь, а не как команда. */
  note?: string
}

/** Путь от корня воркспейса — в путь от рабочего пространства чата. */
export function chatPath(path: string, chatDir: string | undefined): string {
  const from = chatDir === undefined || chatDir === '' ? '.' : chatDir.replace(/\\/g, '/')
  return posix.relative(from, path.replace(/\\/g, '/')) || '.'
}

/** Слаг каталога эпика: у документов из раздела он равен идентификатору, у остальных — из скана. */
function epicSlug(task: BftTask): string {
  return task.slug ?? slugForTask(task.id)
}

/** Каталог эпика от корня воркспейса — по пути страницы ревью, которую даёт скан. */
function epicDir(task: BftTask): string | undefined {
  const page = task.links.html ?? task.links.custdev
  return page ? posix.dirname(page.replace(/\\/g, '/')) : undefined
}

/**
 * Какой навык стоит следующим по артефактам.
 *
 * Решает состав файлов, а не стадия доски: доска бывает выше файлов (эпик
 * сброшен до fast), и команда по ней увела бы в `/bft-deliver` без deep-
 * документа. Стадии процесса, которые ставит PO, учитываются одной:
 * `NEED-CUSTDEV` — скрипт интервью, если его ещё нет.
 */
export function nextCommand(task: BftTask, chatDir: string | undefined): string | undefined {
  const { artifacts } = task
  const slug = epicSlug(task)
  const dir = epicDir(task)
  const doc = (name: string): string => (dir ? chatPath(`${dir}/${name}`, chatDir) : name)

  if (task.stage === 'NEED-CUSTDEV' && !artifacts.custdev) return `/bft-custdev ${slug}`
  if (artifacts.deep) {
    if (!artifacts.deepHtml) return `/bft-html ${doc(`${slug}.md`)}`
    const gaps = task.missing.join(' ')
    if (/Confluence|JIRA/.test(gaps) && task.artifactStage === 'DEEP-REVIEW') return `/bft-deliver ${slug}`
    return `/bft-deep ${slug}`
  }
  if (artifacts.fast) {
    if (!artifacts.fastHtml) return `/bft-html ${doc(`${slug}-fast.md`)}`
    return `/bft-deep ${slug}`
  }
  return undefined
}

export function buildHandoff(
  task: BftTask,
  last: WorkEntry | null,
  config: BftPluginConfig,
  options: HandoffOptions = {},
): Handoff {
  const contextUrl = config.entire ? branchUrl(config.entire, last?.contextRef) : undefined
  const note = options.note?.trim()
  // Правка PO — это доработка документа, а не следующий шаг конвейера: deep-документ
  // правит `/bft-deep`, даже когда по составу артефактов дальше стояла бы отгрузка
  // (`/bft-deliver` унёс бы правку в Confluence вместо документа). Fast-документ правится
  // без команды навыка — инструкция ниже.
  const command = note
    ? (task.artifacts.deep ? `/bft-deep ${epicSlug(task)}` : undefined)
    : nextCommand(task, options.chatDir)
  const lines: string[] = []
  if (command) lines.push(command, '')

  lines.push(`Продолжи работу над БФТ ${task.id} «${task.title}».`)
  // Стадия доски и стадия по файлам — разные факты, и когда они расходятся,
  // модель обязана видеть оба: иначе `DEEP-REVIEW` читается как «deep собран».
  lines.push(task.artifactStage !== undefined && task.artifactStage !== task.stage
    ? `Стадия на доске: ${task.stage}; по артефактам на диске: ${task.artifactStage}.`
    : `Стадия: ${task.stage}.`)

  if (task.missing.length) {
    // Стадия сама по себе не говорит, что делать. Нехватка — говорит.
    lines.push(`До следующей стадии не хватает: ${task.missing.join(', ')}.`)
  }

  const page = task.links.html ? chatPath(task.links.html, options.chatDir) : undefined
  // Документ — по составу артефактов, а не по имени страницы: страница может
  // быть от fast, когда deep уже записан, но ещё не собран в html.
  const dir = epicDir(task)
  const documentName = task.artifacts.deep ? `${epicSlug(task)}.md` : `${epicSlug(task)}-fast.md`
  const document = task.artifacts.deep || task.artifacts.fast
    ? (dir ? chatPath(`${dir}/${documentName}`, options.chatDir) : documentName)
    : undefined
  if (note) {
    lines.push('', `Правка PO к документу${document ? ` ${document}` : ''}:`, note)
    if (!task.artifacts.deep) {
      // Fast-документ принадлежит стенографисту, но повторный `/bft-fast` по
      // одному описанию задачи потерял бы то, что PO диктовал в прошлый раз.
      // Правка вносится в сам документ, и страница пересобирается — иначе
      // замечания придут повторно.
      lines.push(
        '',
        'Внеси правку в документ стадии fast (шапка; канон deep не собирать), затем в этом порядке:',
        `1. python3 <skills_path>/bft-writer/scripts/bft-lint.py ${document ?? '<документ>'}  (ненулевой код — исправить, с ошибками не сохранять)`,
        `2. python3 <skills_path>/bft-writer/scripts/bft-html-export.py ${document ?? '<документ>'}  (пересобрать страницу ревью)`,
        'skills_path — из bft-config.md рабочего пространства.',
      )
    }
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

  if (document || page) {
    const parts = [document ? `Документ: ${document}` : '', page ? `страница ревью: ${page}` : ''].filter(Boolean)
    lines.push('', `${parts.join(', ')} (пути от рабочего пространства чата).`)
  }

  if (needsMcp(command)) lines.push('', MCP_ENVIRONMENT)
  lines.push('', RESPONSE_FORMAT)
  return { prompt: lines.join('\n'), command, contextUrl, continued: !!contextUrl }
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
export function buildCreateDraft(task: BftTask, details: BoardTaskDetails, note?: string): Handoff {
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
  // Слова PO из мини-промта — часть диктовки, а не команда: стенографист кладёт их в документ дословно.
  if (note?.trim()) lines.push('', 'Дополнительно от PO (дословно, источник — PO):', note.trim())
  lines.push('', RESPONSE_FORMAT)
  return { prompt: lines.join('\n'), command: `/bft-fast ${task.id} ${slug}`, continued: false }
}

function shortDate(iso: string | undefined): string {
  if (!iso) return 'дата неизвестна'
  const date = new Date(iso)
  if (isNaN(date.getTime())) return 'дата неизвестна'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}
