/**
 * Как сейчас — словами заказчика (раунд 4). Заказчик часто описывает текущий
 * процесс только в общей реплике (want.quote): «Сейчас … — уходит до недели».
 * Тогда это и есть ASIS (дословная подстрока цитаты), а число из неё — базовое
 * значение эффекта для SMART M. Код ничего не перефразирует: только вырезает.
 */

/** Слова о текущем состоянии. */
const NOW = /(?<![\p{L}])(?:сейчас|сегодня|пока\s+что|на\s+данный\s+момент|в\s+данный\s+момент|в\s+настоящее\s+время|раньше|обычно|вручную)(?![\p{L}])/iu
/** Слова о желаемом — такое предложение не ASIS. */
const WANT = /(?<![\p{L}])(?:хотим|хочу|хотелось|нужно|надо|необходимо|должн\p{L}*|чтобы)(?![\p{L}])/iu

/** Реплика без обёртки «Заказчик: «…»». */
function unwrapQuote(quote: string): string {
  const t = quote.trim()
  const m = /^[^«"]{0,60}:\s*[«"]([\s\S]*)[»"]\s*$/.exec(t)
  return (m ? m[1]! : t.replace(/^[«"]|[»"]$/g, '')).trim()
}

/**
 * Предложения реплики о том, как сейчас (дословно, подряд идущие): с «сейчас»,
 * «сегодня», «вручную»… и без «хотим/нужно». Нет таких — undefined.
 */
export function presentState(quote: string | undefined): string | undefined {
  if (!quote?.trim()) return undefined
  const sentences = unwrapQuote(quote).split(/(?<=[.!?])\s+(?=[\p{Lu}«"])/u).map((s) => s.trim()).filter(Boolean)
  const start = sentences.findIndex((s) => NOW.test(s) && !WANT.test(s))
  if (start < 0) return undefined
  const out = [sentences[start]!]
  // Следующие предложения о том же «сейчас» (без желаемого) — продолжение описания.
  for (const s of sentences.slice(start + 1)) {
    if (WANT.test(s)) break
    out.push(s)
  }
  return out.join(' ').replace(/[.!]+$/, '').trim() || undefined
}

const NUMBER = '(?:\\d+(?:[.,]\\d+)?(?:\\s*[-–]\\s*\\d+(?:[.,]\\d+)?)?|\\p{L}+-\\p{L}+|одн\\p{L}*|один|два|две|двух|три|трёх|трех|четыр\\p{L}*|пят\\p{L}*|шест\\p{L}*|сем\\p{L}*|восьм\\p{L}*|девят\\p{L}*|десят\\p{L}*|несколько|нескольких|пару)'
const UNIT = '(?:минут\\p{L}*|час(?:а|ов)?|сут\\p{L}*|дн(?:я|ей|и)|день|недел\\p{L}*|месяц\\p{L}*|раз(?:а)?|%|процент\\p{L}*)'
const PREFIX = '(?:до|около|примерно|почти|более|больше|меньше|не\\s+менее|не\\s+более|в\\s+среднем)'
const BASELINE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${PREFIX}\\s+)?${NUMBER}\\s+${UNIT}(?![\\p{L}])|(?<![\\p{L}])${PREFIX}\\s+${UNIT}(?![\\p{L}])`, 'iu')

/** Базовое значение эффекта в словах о текущем состоянии («до недели», «два-три дня», «40 минут»). */
export function baselineOf(text: string | undefined): string | undefined {
  return text ? BASELINE.exec(text)?.[0]?.trim() : undefined
}
