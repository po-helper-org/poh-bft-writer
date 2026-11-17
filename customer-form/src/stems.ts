/**
 * Термины текста для разведки и фильтра Кортекса — та же токенизация, что в
 * плагине data-sources (data-sources/src/findings.ts: terms, contentTerms,
 * hasTerm): основы русских слов от 4 букв (5 букв), латиница и CamelCase
 * целиком, аббревиатуры (ЗУП, КЭДО, 1С) — целым словом. Пакеты не зависят
 * друг от друга, поэтому код повторён; правила меняются в обоих местах.
 */

export interface Term { key: string; exact: boolean }

/** Процессные основы: есть почти в любой заявке, предметом не считаются. */
export const STOP_STEMS: ReadonlySet<string> = new Set(['согла', 'маршр', 'руков', 'интег', 'заявк', 'проце', 'систе', 'дораб', 'настр', 'порта'])
const STOP_EXACT: ReadonlySet<string> = new Set(['be', 'fe', 'ui', 'ux', 'api', 'it', 'po', 'sa', 'qa', 'ba'])

const SPLIT = /[^\p{L}\p{N}]+/u
const normalize = (text: string) => text.replace(/ё/g, 'е').replace(/Ё/g, 'Е')
const ACRONYM = /^(?=[\p{N}]*\p{Lu})[\p{Lu}\p{N}]{2,4}$/u

function termOf(raw: string): Term | undefined {
  const word = normalize(raw)
  if (!word || /^\p{N}+$/u.test(word)) return undefined
  const lower = word.toLowerCase()
  if (ACRONYM.test(word)) return STOP_EXACT.has(lower) ? undefined : { key: lower, exact: true }
  if (/^[a-z0-9]+$/.test(lower)) return lower.length >= 4 ? { key: lower, exact: false } : undefined
  return lower.length >= 4 ? { key: lower.slice(0, 5), exact: false } : undefined
}

export function terms(texts: string[]): Term[] {
  const out = new Map<string, Term>()
  for (const raw of texts.join(' ').split(SPLIT)) {
    const term = termOf(raw)
    if (term && !out.has(term.key)) out.set(term.key, term)
  }
  return [...out.values()]
}

/** Термины без процессных основ. */
export function contentTerms(texts: string[]): Term[] {
  return terms(texts).filter((term) => !STOP_STEMS.has(term.key))
}

export function words(text: string): Set<string> {
  return new Set(normalize(text).toLowerCase().split(SPLIT).filter(Boolean))
}

export function hasTerm(textWords: Set<string>, term: Term): boolean {
  if (term.exact) return textWords.has(term.key)
  for (const word of textWords) if (word.startsWith(term.key)) return true
  return false
}

/** Сколько терминов списка встречается в тексте. */
export function countTerms(text: string, list: Term[]): number {
  const set = words(text)
  return list.filter((term) => hasTerm(set, term)).length
}

/** Имя продукта/системы: латиница, CamelCase, аббревиатура, «1С:ЗУП». */
export const PROPER = /^(?:[A-Za-z][\w.-]*|[\p{Lu}\p{N}]{2,6}(?::[\p{Lu}\p{N}]{2,6})?)$/u

/** Окончание прилагательного («Электронное», «корпоративного»): такое слово — признак, а не предмет. */
const ADJECTIVE = /(?:ое|ая|яя|ый|ой|ые|ого|его|ому|ему|ыми|ими|ую|юю)$/i
const bare = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')

/** Содержательные существительные названия по порядку: от 4 букв, не процессные, не имена продуктов, не прилагательные. */
export function titleNouns(title: string): string[] {
  return title.split(/\s+/).map(bare).filter((w) => w.length >= 4 && !PROPER.test(w) && !ADJECTIVE.test(w) && contentTerms([w]).length > 0)
}

/**
 * Объект заявки — главное слово названия: первое содержательное
 * существительное (то, что заявка меняет, а не платформа); нет такого —
 * первое слово от 4 букв, которое не процессное.
 */
export function subjectNoun(title: string): string | undefined {
  return titleNouns(title)[0] ?? title.split(/\s+/).map(bare).find((w) => w.length >= 4 && contentTerms([w]).length > 0)
}
