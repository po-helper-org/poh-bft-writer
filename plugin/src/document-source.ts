/**
 * Какой файл эпика показывать на детальной странице.
 *
 * Порядок не произвольный. Сначала канонический `{slug}.html` — собранная
 * страница ревью, ради которой раздел и нужен: в ней комментирование, обход
 * `[УТОЧНИТЬ]` и сборка промта. Затем любой другой `.html` — эпик могли
 * назвать иначе. Затем markdown: единый `{slug}.md`, а после него
 * `{slug}-fast.md` — быстрый проход, у которого страницы может не быть вовсе.
 * Благодаря последнему шагу раздел показывает документ уже после `/bft-fast`,
 * а не только после `/bft-deep`.
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

  const otherHtml = entries
    .filter(entry => entry.toLowerCase().endsWith('.html'))
    .sort()[0]
  if (otherHtml) return { name: otherHtml, kind: 'html' }

  const deep = pick(`${slug}.md`)
  if (deep) return { name: deep, kind: 'markdown' }

  const fast = pick(`${slug}-fast.md`)
  if (fast) return { name: fast, kind: 'markdown' }

  return null
}
