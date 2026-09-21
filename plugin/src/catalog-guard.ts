/**
 * Страж дублей: секция системного промпта харнесса с каталогом инициатив.
 *
 * `/bft-fast` — стенографист, наружу он не ходит по замыслу, и в чате харнесса
 * запускается по любому источнику: PO диктует тему, по которой документ уже
 * есть, — и получает второй каталог эпика с другим слагом, а доска — вторую
 * задачу. Проверять это внутри навыка нельзя, не сломав его контракт («только
 * текст, который дал PO»), поэтому проверяет раздел: он единственный, кто
 * видит и документы, и доску, и уже держит их снимок после каждого скана.
 *
 * Секция уходит в каждую сессию харнесса (тот же механизм, что у глобальных
 * стилей `dsh-plugin-caveman`/`dsh-plugin-antislop`), но включается только по
 * команде `/bft-fast` или `/bft-deep` — на остальные чаты она текст не даёт.
 * Каталог — строка на инициативу: идентификатор, стадия, название, что
 * осталось, ссылки. Этого хватает и чтобы узнать тему, и чтобы ответить
 * карточкой, не ходя в CLI.
 *
 * Правило «дубль или штатный шаг» — по тому, что команда произвела бы:
 * `/bft-fast` дублирует, когда документ стадии fast уже есть; `/bft-deep` —
 * когда deep уже отгружен (`DEEP-DONE` и дальше). `/bft-deep` по `FAST-DONE`
 * и `/bft-fast` по задаче доски без документа — это следующий шаг, а не
 * повтор, и страж их пропускает.
 */
import { nextCommand } from './handoff.js'
import { stageRank, type BftStage, type BftTask } from './model.js'

/** Имя секции в реестре системного промпта харнесса. */
export const CATALOG_GUARD_SECTION = 'bft:catalog-guard'

/**
 * Порядок секции: после стилей (caveman 10, antislop 11), до всего, что
 * харнесс кладёт дальше сотнями. Внешние секции берут любой конечный порядок.
 */
export const CATALOG_GUARD_ORDER = 20

/** Одна инициатива каталога — то, что модель видит в промпте. */
export interface CatalogRow {
  id: string
  slug?: string
  title: string
  stage: BftStage
  /** Что осталось по этой инициативе — словами, по стадии и нехватке. */
  remaining: string
  jira?: string
  confluence?: string
  html?: string
}

/**
 * Что осталось по инициативе. Терминальные стадии говорят это одним словом;
 * рабочие — нехваткой до следующей стадии и командой следующего навыка
 * (`nextCommand` — тот же выбор, что у «Работать в чате» на детальной странице).
 */
export function remainingWork(task: BftTask): string {
  switch (task.stage) {
    case 'BFT-CANCELED': return 'отменено'
    case 'OKR-DONE': return 'реализовано в рамках OKR'
    case 'OKR-VLET': return 'в работе влётом'
    case 'OKR-ADDED': return 'реализация по плану OKR'
    case 'DEEP-DONE': return 'БФТ готов: передать в OKR или оформить влётом'
    default: {
      const parts: string[] = []
      if (task.missing.length) parts.push(task.missing.join(', '))
      const command = task.artifacts.fast || task.artifacts.deep
        ? nextCommand(task, undefined)
        : `/bft-fast ${task.id}`
      if (command) parts.push(command)
      return parts.join(' → ') || '—'
    }
  }
}

export function catalogRows(tasks: readonly BftTask[]): CatalogRow[] {
  return tasks.map(task => ({
    id: task.id,
    slug: task.slug,
    title: task.title,
    stage: task.stage,
    remaining: remainingWork(task),
    jira: task.links.epic,
    confluence: task.links.confluence,
    html: task.links.html,
  }))
}

const RULES = [
  '## Каталог БФТ — проверка на дубль',
  '',
  'Действует только когда сообщение PO начинается с `/bft-fast` или `/bft-deep`. В остальных случаях этот раздел игнорируй.',
  '',
  'Перед тем как выполнять навык, сверь тему запроса с каталогом ниже. Совпадение — тот же идентификатор задачи',
  '(PO-N), тот же слаг каталога или та же инициатива по сути (та же система, тот же заказчик, та же проблема)',
  'под другим названием. Сомневаешься — считай, что совпало, и спроси.',
  '',
  'Дубль — это когда команда произвела бы то, что уже есть:',
  '- `/bft-fast` — по инициативе уже есть документ (стадия FAST-DONE и дальше);',
  '- `/bft-deep` — deep-документ уже отгружен (стадия DEEP-DONE и дальше).',
  'Не дубль, а штатный шаг: `/bft-fast <id>` по задаче доски без документа (To Do, NEED-CUSTDEV — в каталоге «осталось:',
  '/bft-fast <id>»), `/bft-deep` по инициативе в FAST-DONE или DEEP-REVIEW. Такие запросы выполняй как обычно.',
  'Тема совпала с задачей доски без документа — работай под её идентификатором (epic_slug = id строчными), новую не заводи.',
  '',
  'Дубль — навык не запускай, файлы не трогай. Ответь одной карточкой и остановись:',
  '<id> — <название> · <стадия>',
  'JIRA: <url или нет>',
  'Confluence: <url или нет>',
  'HTML: <путь или нет>',
  'Осталось: <из колонки «осталось»>',
  'Продолжить по этой инициативе или завести новую?',
  'Дальше — только по явному ответу PO. Ничего сверх карточки: без пересказа документа, без предложений, без списков.',
  '',
] as const

const NO_SNAPSHOT = [
  'Снимка каталога ещё нет (раздел не сканировал воркспейс). Сверься сам: `backlog task list --type bft --plain`',
  'и каталоги документов в docs_path из bft-config.md; правило выше — то же.',
].join('\n')

function cell(value: string | undefined): string {
  return value === undefined || value === '' ? '—' : value.replace(/\s*\|\s*/g, ' / ').trim()
}

/**
 * Текст секции. Строки каталога — в порядке стадий (ближе к финалу выше:
 * готовое узнаётся первым), внутри стадии как пришли. `null` — снимка ещё нет,
 * и модели говорится, чем его заменить, а не выдаётся пустая таблица.
 */
export function catalogGuardText(snapshot: { at: string; rows: readonly CatalogRow[] } | null): string {
  const lines: string[] = [...RULES]
  if (snapshot === null) {
    lines.push(NO_SNAPSHOT)
    return lines.join('\n')
  }
  const rows = [...snapshot.rows].sort((a, b) => stageRank(b.stage) - stageRank(a.stage))
  lines.push(`Каталог (снимок ${snapshot.at}; колонки: id | стадия | название | осталось | JIRA | Confluence | HTML):`)
  if (!rows.length) lines.push('(пусто — инициатив ещё нет)')
  for (const row of rows) {
    const id = row.slug && row.slug !== row.id ? `${row.id} (${row.slug})` : row.id
    lines.push([id, row.stage, cell(row.title), cell(row.remaining), cell(row.jira), cell(row.confluence), cell(row.html)].join(' | '))
  }
  return lines.join('\n')
}

/** Снимок стар — пора сканировать заново; свежее не дёргаем скан на каждый ход. */
export const CATALOG_STALE_MS = 5 * 60 * 1000

export function isStale(at: string | undefined, now: number): boolean {
  if (at === undefined) return true
  const then = Date.parse(at)
  return !Number.isFinite(then) || now - then > CATALOG_STALE_MS
}
