/**
 * Подсказка терминов распознавателю (ADR-0008): имена, названия систем и
 * аббревиатуры, которые уже прозвучали в диалоге, — в prompt
 * gpt-4o-mini-transcribe. Так «1С:ЗУП», «Битрикс24» и «Ирина Петрова»
 * пишутся так же, как в переписке, а не «один эс зуп».
 *
 * Тексты диалога приходят от источников подсказок (speechHints.register):
 * плагин речи не знает, какой это диалог, — знает тот, кто его ведёт
 * (customer-form). Запись и диалог связываются ключом записи (audioKey).
 */

/** Ключ записи: длина + FNV-1a 32 по байтам. Тот же расчёт — в клиенте customer-form. */
export function audioKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193)
  return `${bytes.length}:${(h >>> 0).toString(16)}`
}

/** Источник подсказок: тексты диалога, к которому относится запись, или ничего. */
export type HintSource = (request: { audioKey: string }) => Promise<readonly string[] | undefined> | readonly string[] | undefined

/** Служба ctx.speechHints: кто ведёт диалоги, регистрирует источник. */
export interface SpeechHints {
  register(source: HintSource): () => void
}

const STOP = new Set([
  'Я', 'Мы', 'Вы', 'Ты', 'Он', 'Она', 'Они', 'Оно', 'Это', 'Этот', 'Эта', 'Эти', 'Там', 'Тут', 'Здесь',
  'Привет', 'Здравствуйте', 'Спасибо', 'Пожалуйста', 'Да', 'Нет', 'Ок', 'OK', 'Ok', 'Итог', 'ИТОГ',
  'S', 'I', 'A', 'The', 'Сейчас', 'Потом', 'Сначала', 'Затем', 'Если', 'Когда', 'Как', 'Что', 'Где',
])

const URL_OR_EMAIL = /https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.-]+|\[\d{1,2}:\d{2}(?::\d{2})?\]|\bS\d+\b/g
const NAME = /^\p{Lu}\p{Ll}+$/u
// Окончания прилагательных (без «-ий»: Дмитрий, Василий — имена).
const ADJECTIVE = /(?:ый|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему)$/u
const TOKEN = /[\p{L}\d][\p{L}\d:+_\-./]*[\p{L}\d]|\p{L}/gu

function interesting(word: string, sentenceStart: boolean): boolean {
  if (STOP.has(word) || word.length > 40) return false
  if (/[A-Za-z]/.test(word) && word.length >= 2) return true // JIRA, Outlook, Confluence
  if (/\d/.test(word) && /\p{L}/u.test(word)) return true // 1С:ЗУП, Битрикс24
  if (/^[\p{Lu}\d]{2,10}$/u.test(word) && /\p{Lu}/u.test(word)) return true // ЗУП, БФТ, СЭД
  return !sentenceStart && /^\p{Lu}\p{Ll}+/u.test(word) // имя или название посреди фразы
}

/**
 * Термины из текстов: частые раньше редких, при равенстве — что встретилось раньше.
 * Соседние слова с большой буквы склеиваются: «Ирина Петрова».
 */
export function glossary(texts: readonly string[], limit = 40): string[] {
  const score = new Map<string, { n: number; first: number }>()
  let order = 0
  for (const raw of texts) {
    const text = raw.replace(URL_OR_EMAIL, ' . ')
    let phrase: string[] = []
    let tentative = false // слово с большой буквы в начале фразы: термин, только если за ним имя
    let lastEnd = -1
    let sentenceStart = true
    const flush = () => {
      // «Ответственный Олег Сидоров» в начале фразы: прилагательное — не часть имени.
      if (tentative && phrase.length > 2 && ADJECTIVE.test(phrase[0])) phrase.shift()
      if (phrase.length && !(tentative && phrase.length < 2)) {
        const term = phrase.join(' ')
        const seen = score.get(term) ?? { n: 0, first: order++ }
        seen.n++
        score.set(term, seen)
      }
      phrase = []
      tentative = false
    }
    for (const m of text.matchAll(TOKEN)) {
      const word = m[0].replace(/[.\-/:]+$/, '')
      const gap = text.slice(lastEnd < 0 ? 0 : lastEnd, m.index)
      if (/[.!?\n…]/.test(gap) || lastEnd < 0) sentenceStart = true
      const keep = interesting(word, sentenceStart)
      if (phrase.length && NAME.test(word) && NAME.test(phrase[phrase.length - 1]) && gap === ' ' && !STOP.has(word)) {
        phrase.push(word) // «Ирина Петрова», «Outlook Web»
      } else if (!keep && sentenceStart && NAME.test(word) && !STOP.has(word)) {
        flush()
        phrase = [word]
        tentative = true
      } else {
        flush()
        if (keep) phrase.push(word)
      }
      sentenceStart = false
      lastEnd = m.index + m[0].length
    }
    flush()
  }
  return [...score.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[1].first - b[1].first)
    .slice(0, limit)
    .map(([term]) => term)
}

/** Базовая подсказка + термины диалога в пределах бюджета символов. */
export function composePrompt(base: string, terms: readonly string[], budget = 900): string {
  if (!terms.length) return base
  const head = `${base} Термины этого обращения: `
  const picked: string[] = []
  let length = head.length
  for (const term of terms) {
    if (length + term.length + 2 > budget) break
    picked.push(term)
    length += term.length + 2
  }
  return picked.length ? `${head}${picked.join(', ')}.` : base
}
