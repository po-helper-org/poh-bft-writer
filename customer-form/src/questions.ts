/**
 * Что нужно для согласования (план качества, C8; раунд 4): сводный список
 * открытых вопросов полного БФТ — кодом, без модели.
 *
 * Источник — только маркеры канона «[УТОЧНИТЬ у X: вопрос?]» с адресатом и
 * настоящим вопросом (не обрывок, не пересказ риска, не служебное слово), из
 * ячеек таблиц и прозы разделов. Голые маркеры, остатки ячеек, хвост
 * «Открытые вопросы» модели и вопросы приёма в список не идут: первые видно в
 * документе, вторые уже разложены моделью по маркерам.
 *
 * Близкие дубли схлопываются (у пункта — все ID и разделы, где он стоит),
 * группы — по адресату, не больше десяти пунктов. Список живёт в deep.json и показывается вне канона (страница
 * заявки, выгрузка): bft-lint его не видит.
 */
import { parseCanon } from './canon-table.js'

export const UNASSIGNED = 'Адресат не назначен'

/** Где стоит вопрос: ID строки (или первая ячейка) и раздел. */
export interface QuestionRef { id: string; section: string }

export interface OpenQuestion {
  /** Что нужно узнать. */
  text: string
  /** Кто может ответить: «у X» из маркера; нет — UNASSIGNED. */
  addressee: string
  refs: QuestionRef[]
}

const ID = /^(?:БТ|ПТ|ИТ|ФТ|НФТ)-\d+$/
const MARKER = /`?\[УТОЧНИТЬ([^\]]*)\]`?/g

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
const strip = (s: string) => squash(s.replace(/\*\*|__|`/g, '').replace(/^[\s.,;:!?—–-]+|[\s,;:—–-]+$/g, ''))
/** Ключ дубля: регистр, ё, кавычки, пунктуация. */
export const questionKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'`*_]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Адресат и вопрос из тела маркера (то, что после «УТОЧНИТЬ» до «]»): «у X: вопрос» или «у X — вопрос». */
export function parseMarker(inner: string): { addressee?: string; question?: string } {
  const body = inner.trim()
  const m = /^у\s+([^:—–]+?)\s*(?::|\s[—–]\s)\s*(.*)$/is.exec(body)
  if (m) {
    const question = strip(m[2]!)
    return { addressee: squash(m[1]!), ...(question ? { question } : {}) }
  }
  const who = /^у\s+(.+)$/i.exec(body)?.[1]
  return who ? { addressee: squash(who) } : {}
}

/** Слова вопроса (буквы и цифры). */
const wordsOf = (s: string) => s.match(/[\p{L}\p{N}]+/gu) ?? []
/** Служебные «вопросы», которые без своей ячейки ничего не спрашивают. */
const HOLLOW = /^(?:статус|сроки?|проработать|открыто|уточнить|детали|подробности|тип|вероятность|влияние|приоритет|согласовать)\??$/i

/**
 * Настоящий вопрос (раунд 4): не обрывок. Не меньше двух слов, без висящей
 * пунктуации («— ;», «(см.»), не служебное слово и не пересказ риска
 * (длиннее 25 слов).
 */
export function realQuestion(q: string): boolean {
  const t = q.trim()
  const w = wordsOf(t)
  if (w.length < 2 || w.length > 25 || HOLLOW.test(t)) return false
  if (/(?:^|\s)[—–-]\s*[;,]|[;,:—–-]\s*$|\(см\.?\s*$|^\(|^(?:и|или|а|но)\s/iu.test(t)) return false
  return true
}

/** Вопрос для списка: с большой буквы, со знаком вопроса. */
const asQuestion = (q: string) => {
  const t = q.trim().replace(/[.;]+$/, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase())
  return /\?$/.test(t) ? t : `${t}?`
}

/**
 * Вопросы канона (раунд 4) — только маркеры «[УТОЧНИТЬ у X: вопрос?]» с
 * адресатом и настоящим вопросом (realQuestion), из ячеек таблиц и прозы
 * разделов. Голый маркер, маркер без вопроса и остаток ячейки вопросом не
 * становятся: их видно в документе, в список согласования они не идут.
 */
export function canonQuestions(canon: string): OpenQuestion[] {
  const out: OpenQuestion[] = []
  const parsed = parseCanon(canon)
  for (const section of parsed.sections) {
    if (!section.title) continue
    const title = section.title.replace(/\*+$/, '').trim()
    const push = (cell: string, id: string) => {
      for (const m of cell.matchAll(MARKER)) {
        const { addressee, question } = parseMarker(m[1] ?? '')
        if (!addressee || !question || /не опубликовано/.test(m[1] ?? '') || !realQuestion(question)) continue
        out.push({ text: asQuestion(question), addressee, refs: [{ id, section: title }] })
      }
    }
    const tableLines = new Set<number>()
    for (const table of section.tables) {
      for (let i = table.start; i < table.end; i++) tableLines.add(i)
      for (const row of table.rows) {
        const first = strip((row.cells[0] ?? '').replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1'))
        const id = ID.test(first) ? first : first.replace(MARKER, '').trim().slice(0, 60) || title
        row.cells.forEach((cell) => push(cell, id))
      }
    }
    let fence = false
    for (let i = section.start + 1; i < section.end; i++) {
      const line = parsed.lines[i] ?? ''
      if (/^\s*```/.test(line)) { fence = !fence; continue }
      if (!fence && !tableLines.has(i)) push(line, title)
    }
  }
  return out
}

/** Пункты списка (маркеры «- », «1. », «* ») — по строке на вопрос; пустые и заголовки — вон. */
export function listItems(text: string): string[] {
  return text.split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^\*\*[^*]+\*\*:?$/.test(l) && !/^-{3,}$/.test(l) && !/^Открытые вопросы/i.test(l.replace(/^\*\*/, '')))
}

export interface QuestionSources {
  /** Канон после автоправок. */
  canon: string
}

/** Основы слов вопроса (5 букв) — для близких дублей. */
const stemsOf = (s: string) => new Set(wordsOf(s.toLowerCase().replace(/ё/g, 'е')).filter((w) => w.length >= 3).map((w) => w.slice(0, 5)))
/** Близкий дубль: тот же нормализованный текст, один содержит другой или 80% основ общие. */
export function nearDuplicate(a: string, b: string): boolean {
  const [ka, kb] = [questionKey(a), questionKey(b)]
  if (ka === kb || (ka.length >= 8 && kb.includes(ka)) || (kb.length >= 8 && ka.includes(kb))) return true
  const [sa, sb] = [stemsOf(a), stemsOf(b)]
  const shared = [...sa].filter((x) => sb.has(x)).length
  return shared >= 2 && shared / Math.min(sa.size, sb.size) >= 0.8
}

/** Потолок списка «Что нужно для согласования». */
export const QUESTIONS_MAX = 10

/**
 * Сводный список (раунд 4): только вопросы маркеров канона; близкие дубли
 * (normalized/вложение/80% основ) — один пункт со всеми ссылками; порядок —
 * по числу мест, где вопрос стоит, затем по документу; не больше max
 * (QUESTIONS_MAX; форма вопросов берёт все — Infinity).
 */
export function collectQuestions(src: QuestionSources, max: number = QUESTIONS_MAX): OpenQuestion[] {
  const out: OpenQuestion[] = []
  for (const q of canonQuestions(src.canon)) {
    const seen = out.find((o) => o.addressee.toLowerCase() === q.addressee.toLowerCase() && nearDuplicate(o.text, q.text))
      ?? out.find((o) => questionKey(o.text) === questionKey(q.text))
    if (!seen) { out.push({ text: q.text, addressee: q.addressee, refs: [...q.refs] }); continue }
    // Короче — обычно точнее сформулирован; оставляем более полный вопрос.
    if (q.text.length > seen.text.length && nearDuplicate(seen.text, q.text)) seen.text = q.text
    for (const ref of q.refs) if (!seen.refs.some((r) => r.id === ref.id && r.section === ref.section)) seen.refs.push(ref)
  }
  return out
    .map((q, i) => ({ q, i }))
    .sort((a, b) => b.q.refs.length - a.q.refs.length || a.i - b.i)
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map(({ q }) => q)
}

/** Группы по адресату: названные — по числу вопросов, «Адресат не назначен» — последней. */
export function groupQuestions(list: readonly OpenQuestion[]): { addressee: string; items: OpenQuestion[] }[] {
  const groups = new Map<string, OpenQuestion[]>()
  for (const q of list) {
    const key = [...groups.keys()].find((k) => k.toLowerCase() === q.addressee.toLowerCase()) ?? q.addressee
    groups.set(key, [...(groups.get(key) ?? []), q])
  }
  return [...groups.entries()]
    .map(([addressee, items]) => ({ addressee, items }))
    .sort((a, b) => Number(a.addressee === UNASSIGNED) - Number(b.addressee === UNASSIGNED) || b.items.length - a.items.length)
}

export const QUESTIONS_HEAD = 'Что нужно для согласования'
const EMPTY = 'Открытых вопросов нет: в документе не осталось пометок [УТОЧНИТЬ].'

/** Подпись группы: «Спросить у X» (адресат из маркера — в родительном падеже); без адресата — как есть. */
const groupTitle = (addressee: string) => (addressee === UNASSIGNED ? addressee : `Спросить у ${addressee}`)

const refText = (refs: readonly QuestionRef[]) => refs.map((r) => (r.id && r.id !== r.section ? `${r.id} (${r.section})` : r.section)).join(', ')

/** Блок для выгрузки (.md, .docx, .pdf): заголовок второго уровня, группы по адресату. */
export function questionsMarkdown(list: readonly OpenQuestion[]): string {
  const lines = [`## ${QUESTIONS_HEAD}`, '']
  if (!list.length) return [...lines, EMPTY, ''].join('\n')
  for (const group of groupQuestions(list)) {
    lines.push(`**${groupTitle(group.addressee)}**`, '')
    for (const q of group.items) lines.push(`- ${q.text.replace(/\n/g, ' ')}${q.refs.length ? ` — ${refText(q.refs)}` : ''}`)
    lines.push('')
  }
  return lines.join('\n')
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Тот же блок для страницы заявки. */
export function questionsHtml(list: readonly OpenQuestion[]): string {
  const body = list.length
    ? groupQuestions(list).map((g) => `<h3>${esc(groupTitle(g.addressee))}</h3><ul>${g.items.map((q) => `<li>${esc(q.text)}${q.refs.length ? ` <span class="cs-q-ref">— ${esc(refText(q.refs))}</span>` : ''}</li>`).join('')}</ul>`).join('')
    : `<p>${esc(EMPTY)}</p>`
  return `<section class="cs-questions" id="customer-questions"><h2 id="sec-questions">${esc(QUESTIONS_HEAD)}</h2>${body}</section>`
}
