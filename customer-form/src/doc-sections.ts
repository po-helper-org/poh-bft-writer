/**
 * Разделы страницы ревью полного БФТ (bft-html-export.py) — для точечной
 * перерисовки после правки агента: страница собирается целиком (это дёшево), а
 * в браузер уходят только изменённые разделы.
 *
 * Раздел — верхний блок `<main>` от `<h2 id>` (или свёрнутого
 * `<details class="fold"><summary><h2 id>`) до следующего такого же; «шапка» —
 * всё до первого раздела, подвал (`<footer>`) не входит.
 */

export interface PageBlock { id: string; html: string }

const START = /(<details class="fold"><summary>)?<h2 id="([^"]+)"/g

/** Блоки `<main>` по порядку; id шапки — пустая строка. Нет `<main>` — null. */
export function pageBlocks(page: string): PageBlock[] | null {
  const open = page.indexOf('<main>')
  if (open < 0) return null
  const from = open + '<main>'.length
  const close = page.indexOf('</main>', from)
  const footer = page.lastIndexOf('<footer>', close < 0 ? page.length : close)
  const to = footer > from ? footer : close > from ? close : page.length
  const body = page.slice(from, to)
  const blocks: PageBlock[] = []
  let id = ''
  let at = 0
  START.lastIndex = 0
  for (let m = START.exec(body); m; m = START.exec(body)) {
    blocks.push({ id, html: body.slice(at, m.index) })
    id = m[2]!
    at = m.index
  }
  blocks.push({ id, html: body.slice(at) })
  return blocks
}

/**
 * Какие разделы поменялись между двумя версиями страницы. null — точечно не
 * выйдет (поменялся порядок или число разделов, шапка, нет `<main>`): страницу
 * надо перезагрузить целиком.
 */
export function changedBlocks(before: string, after: string): string[] | null {
  const a = pageBlocks(before)
  const b = pageBlocks(after)
  if (!a || !b || a.length !== b.length) return null
  const changed: string[] = []
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.id !== b[i]!.id) return null
    if (a[i]!.html === b[i]!.html) continue
    if (!a[i]!.id) return null
    changed.push(a[i]!.id)
  }
  return changed
}

/** HTML разделов по id (порядок — как в запросе; неизвестные пропускаются). */
export function pickBlocks(page: string, ids: readonly string[]): PageBlock[] {
  const blocks = pageBlocks(page) ?? []
  return ids.flatMap((id) => blocks.filter((b) => b.id && b.id === id))
}

/** Хэш документа страницы ревью (DOC_REV в bft-html-export.js). */
export function docRevOf(page: string): string | null {
  const m = /var DOC_REV = ("[^"]*")/.exec(page)
  return m ? (JSON.parse(m[1]!) as string) : null
}
