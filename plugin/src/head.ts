/**
 * Шапка документа БФТ: то, что превью показывает без открытия страницы.
 *
 * Скелет шапки задаёт `skills/bft-fast/resources/document_assembly.md`: блок
 * `Цель` — одна SMART-таблица, `How to demo` — нумерованные шаги, «Общая
 * информация» — карточка `Поле | Значение`. Deep копирует шапку байт-в-байт,
 * поэтому разбор один на обе стадии.
 *
 * Разбор терпимый, а не строгий: заголовки бывают `##` и `###`, у старых
 * документов шаги демо — абзац `[УТОЧНИТЬ] — …` без нумерации. Строгость —
 * дело линтера навыка; здесь задача показать то, что в документе есть, а не
 * спрятать поле за отклонение от шаблона.
 */

export interface DocumentHead {
  /** SMART-таблица цели строками `S (Specific): …`, порядок как в документе. Нет таблицы — нет поля. */
  smart?: string
  /** Шаги How to demo. Пусто — блока нет или он пуст. */
  howToDemo: string[]
  /** «Ответственный за продукт» из «Общей информации». */
  customer?: string
}

const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/
const FENCE = '---'

/** Заголовок блока без решёток, хвостового двоеточия и регистра. */
function headingKey(title: string): string {
  return title.replace(/:\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Тело документа без frontmatter, построчно. */
function bodyLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== FENCE) return lines
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE)
  return end === -1 ? lines : lines.slice(end + 1)
}

/** Строки блока под заголовком — до следующего заголовка любого уровня. */
function sectionBody(lines: readonly string[], matches: (key: string) => boolean): string[] | null {
  const start = lines.findIndex((line) => {
    const heading = HEADING_RE.exec(line)
    return heading !== null && matches(headingKey(heading[1]))
  })
  if (start === -1) return null
  const body: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) break
    body.push(lines[i])
  }
  return body
}

/** Ячейки строки markdown-таблицы. Не строка таблицы — `null`. `\|` внутри ячейки — не разделитель. */
function tableCells(line: string): string[] | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) return null
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map(cell => cell.replace(/\\\|/g, '|').trim())
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every(cell => /^:?-{2,}:?$/.test(cell) || cell === '')
}

function parseSmart(lines: readonly string[]): string | undefined {
  const body = sectionBody(lines, key => key === 'цель' || key === 'цель (smart)' || key === 'smart')
  if (!body) return undefined
  const rows: string[] = []
  for (const line of body) {
    const cells = tableCells(line)
    if (!cells || cells.length < 2 || isSeparatorRow(cells)) continue
    // Заголовок таблицы (`SMART | Значение`) — не строка цели.
    if (!/^[SMART]\b/i.test(cells[0]) || /^smart$/i.test(cells[0])) continue
    if (cells[1] === '') continue
    rows.push(`${cells[0]}: ${cells[1]}`)
  }
  return rows.length ? rows.join('\n') : undefined
}

const LIST_ITEM_RE = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/

function parseHowToDemo(lines: readonly string[]): string[] {
  const body = sectionBody(lines, key => key.replace(/[\s-]+/g, '') === 'howtodemo')
  if (!body) return []

  const steps: string[] = []
  let listed = false
  for (const line of body) {
    if (line.trim() === '') continue
    const item = LIST_ITEM_RE.exec(line)
    if (item) {
      steps.push(item[1].trim())
      listed = true
      continue
    }
    // Продолжение шага с отступом — часть предыдущего пункта, а не новый шаг.
    if (listed && /^\s+\S/.test(line) && steps.length) {
      steps[steps.length - 1] = `${steps[steps.length - 1]} ${line.trim()}`
      continue
    }
    if (!listed && !tableCells(line)) steps.push(line.trim())
  }
  // Без нумерации блок — один абзац (`[УТОЧНИТЬ] — сценарий не обсуждался`), не список шагов.
  return listed ? steps : (steps.length ? [steps.join(' ')] : [])
}

function parseCustomer(lines: readonly string[]): string | undefined {
  const body = sectionBody(lines, key => key === 'общая информация')
  if (!body) return undefined
  for (const line of body) {
    const cells = tableCells(line)
    if (!cells || cells.length < 2) continue
    if (/^ответственный за продукт$/i.test(cells[0]) && cells[1] !== '') return cells[1]
  }
  return undefined
}

export function parseDocumentHead(text: string): DocumentHead {
  const lines = bodyLines(text)
  const head: DocumentHead = { howToDemo: parseHowToDemo(lines) }
  const smart = parseSmart(lines)
  if (smart !== undefined) head.smart = smart
  const customer = parseCustomer(lines)
  if (customer !== undefined) head.customer = customer
  return head
}
