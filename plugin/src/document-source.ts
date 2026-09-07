/**
 * Какой файл эпика показывать на детальной странице.
 *
 * Порядок не произвольный. Сначала канонический `{slug}.html` — собранная
 * страница ревью, ради которой раздел и нужен: в ней комментирование, обход
 * `[УТОЧНИТЬ]` и сборка промта. Затем `{slug}-fast.html` — та же страница
 * стадии fast. Затем любой другой `.html` — эпик могли назвать иначе. Затем
 * markdown: единый `{slug}.md`, а после него `{slug}-fast.md` — быстрый проход,
 * у которого страницы может не быть вовсе. Благодаря последнему шагу раздел
 * показывает документ уже после `/bft-fast`, а не только после `/bft-deep`.
 *
 * `{slug}-custdev.html` из выбора исключён совсем. Это страница встречи, а не
 * документ требования, и по алфавиту она обходит `{slug}-fast.html`: без явного
 * исключения раздел показывал бы скрипт интервью вместо самого БФТ.
 */

export type DocumentKind = 'html' | 'markdown'

export interface DocumentChoice {
  /** Имя файла внутри каталога эпика. */
  name: string
  kind: DocumentKind
}

export function chooseDocument(slug: string, entries: readonly string[]): DocumentChoice | null {
  const lower = new Map(entries.map(entry => [entry.toLowerCase(), entry]))
  const pick = (name: string): string | undefined => lower.get(name.toLowerCase())

  const canonicalHtml = pick(`${slug}.html`)
  if (canonicalHtml) return { name: canonicalHtml, kind: 'html' }

  const fastHtml = pick(`${slug}-fast.html`)
  if (fastHtml) return { name: fastHtml, kind: 'html' }

  const custdevHtml = `${slug}-custdev.html`.toLowerCase()
  const otherHtml = entries
    .filter(entry => entry.toLowerCase().endsWith('.html'))
    .filter(entry => entry.toLowerCase() !== custdevHtml)
    .sort()[0]
  if (otherHtml) return { name: otherHtml, kind: 'html' }

  const deep = pick(`${slug}.md`)
  if (deep) return { name: deep, kind: 'markdown' }

  const fast = pick(`${slug}-fast.md`)
  if (fast) return { name: fast, kind: 'markdown' }

  return null
}

/**
 * Документ CustDev-интервью: собранная страница встречи, а если её ещё нет — сам скрипт.
 *
 * Отдельная функция, а не ветка в `chooseDocument`: это разные документы с разной судьбой.
 * Документ требования показывают всегда, скрипт интервью — только когда PO его спросил, и
 * порядок предпочтений у них свой. Общая функция с флагом склеила бы два правила в одно.
 */
export function chooseCustdevDocument(slug: string, entries: readonly string[]): DocumentChoice | null {
  const lower = new Map(entries.map(entry => [entry.toLowerCase(), entry]))
  const pick = (name: string): string | undefined => lower.get(name.toLowerCase())

  const page = pick(`${slug}-custdev.html`)
  if (page) return { name: page, kind: 'html' }

  const script = pick(`${slug}-custdev.md`)
  if (script) return { name: script, kind: 'markdown' }

  return null
}
