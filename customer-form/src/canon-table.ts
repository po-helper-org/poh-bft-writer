/**
 * Разбор канона БФТ на разделы и таблицы и обратная сборка (план качества, C0).
 *
 * Этим пользуются все детерминированные пост-проходы (canon-check.ts autoFix)
 * и метрики качества: правка идёт по ячейкам, а не регэкспами по сплошному
 * тексту. Цикл «разбор → сборка» без правок даёт тот же текст байт-в-байт
 * (тест на эталоне навыка), поэтому пост-проход меняет только то, что тронул.
 *
 * Таблицы внутри ```-блоков (plantuml, text) — не таблицы.
 */

export interface CanonRow {
  cells: string[]
  /** Номер строки в тексте (0 — первая). */
  line: number
}

export interface CanonTable {
  header: string[]
  /** Строка-разделитель как есть: `|---|---|` и `| --- | --- |` оба допустимы. */
  separator: string
  rows: CanonRow[]
  /** Строки текста [start, end): заголовок, разделитель и все строки таблицы. */
  start: number
  end: number
  /** Ближайший заголовок третьего уровня внутри раздела («Акторы»), если есть. */
  subsection?: string
}

export interface CanonSection {
  /** Заголовок второго уровня без «## »; '' — текст до первого раздела. */
  title: string
  /** Строки [start, end): от строки заголовка до следующего «## ». */
  start: number
  end: number
  tables: CanonTable[]
}

export interface ParsedCanon {
  lines: string[]
  sections: CanonSection[]
}

const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/

/** Ячейки строки таблицы: экранированный «\|» — не разделитель; ячейки без краевых пробелов. */
export function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
  return body.split(/(?<!\\)\|/).map((c) => c.trim())
}

/** Строка таблицы в канонической форме `| a | b |`. */
export function renderRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

/** Таблица целиком: заголовок, разделитель как был, строки. */
export function renderTable(table: Pick<CanonTable, 'header' | 'separator' | 'rows'>): string[] {
  return [renderRow(table.header), table.separator, ...table.rows.map((r) => renderRow(r.cells))]
}

const isRow = (line: string) => line.trim().startsWith('|')

export function parseCanon(md: string): ParsedCanon {
  const lines = md.split('\n')
  const sections: CanonSection[] = []
  let current: CanonSection = { title: '', start: 0, end: lines.length, tables: [] }
  let subsection: string | undefined
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^\s*```/.test(line)) { fence = !fence; continue }
    if (fence) continue
    const h2 = /^## (.+?)\s*$/.exec(line)
    if (h2) {
      current.end = i
      if (current.title || current.start < i) sections.push(current)
      current = { title: h2[1]!, start: i, end: lines.length, tables: [] }
      subsection = undefined
      continue
    }
    const h3 = /^###\s+(.+?)\s*$/.exec(line)
    if (h3) { subsection = h3[1]; continue }
    if (isRow(line) && i + 1 < lines.length && SEPARATOR.test(lines[i + 1]!) && lines[i + 1]!.includes('|')) {
      const table: CanonTable = { header: splitRow(line), separator: lines[i + 1]!, rows: [], start: i, end: i + 2, ...(subsection ? { subsection } : {}) }
      let j = i + 2
      while (j < lines.length && isRow(lines[j]!)) {
        table.rows.push({ cells: splitRow(lines[j]!), line: j })
        j++
      }
      table.end = j
      current.tables.push(table)
      i = j - 1
    }
  }
  current.end = lines.length
  sections.push(current)
  return { lines, sections }
}

/**
 * Собрать текст обратно: строки таблиц — из их ячеек (renderTable), всё
 * остальное — как было. Число строк таблицы может измениться (строки
 * удалены/добавлены пост-проходом) — остальной текст сдвигается.
 */
export function renderCanon(parsed: ParsedCanon): string {
  const tables = parsed.sections.flatMap((s) => s.tables).sort((a, b) => a.start - b.start)
  const out: string[] = []
  let at = 0
  for (const table of tables) {
    out.push(...parsed.lines.slice(at, table.start))
    out.push(...renderTable(table))
    at = table.end
  }
  out.push(...parsed.lines.slice(at))
  return out.join('\n')
}

/** Раздел по заголовку (без «*» на конце, без регистра). */
export function sectionOf(parsed: ParsedCanon, title: string): CanonSection | undefined {
  const norm = (s: string) => s.replace(/\*+$/, '').trim().toLowerCase()
  return parsed.sections.find((s) => norm(s.title) === norm(title))
}

/** Колонка по началу заголовка (без регистра); -1 — нет. */
export function columnOf(table: CanonTable, prefix: string): number {
  const p = prefix.toLowerCase()
  return table.header.findIndex((h) => h.replace(/\*/g, '').trim().toLowerCase().startsWith(p))
}

/** Текст раздела (строки от заголовка до следующего «## »). */
export function sectionText(parsed: ParsedCanon, section: CanonSection): string {
  return parsed.lines.slice(section.start, section.end).join('\n')
}

/**
 * Ссылка на ID требования в тексте («НФТ-1» не даёт лишнего «ФТ-1»). Как
 * REQ_ID_INLINE_RE bft-lint.py: номер любой, «ИТ-0» — тоже ссылка (и TR001,
 * если такой строки нет).
 */
export const ID_RE = /(?<![А-ЯЁA-Za-z])(?:БТ|ПТ|ИТ|ФТ|НФТ)-\d+/g
/**
 * ID строки требования, которое линтер считает определённым, — ровно ID_RE
 * bft-lint.py: номер с 1, без ведущих нулей. Строка «ИТ-0» требование не
 * определяет, ссылки на неё — TR001; autoFix перенумеровывает её (normalize-ids).
 */
export const CANON_ID = /^(?:БТ|ПТ|ИТ|ФТ|НФТ)-[1-9]\d*$/
