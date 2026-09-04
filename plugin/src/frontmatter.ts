/**
 * Разбор frontmatter документа БФТ.
 *
 * Полноценный YAML здесь не нужен и вреден: frontmatter этого репозитория —
 * десять плоских ключей фиксированного состава (`document_assembly.md`
 * §Frontmatter), а тянуть парсер ради них значило бы принять чужие правила
 * экранирования и утечку типов там, где нужен только текст.
 */

export interface Frontmatter {
  [key: string]: string
}

const FENCE = '---'

/**
 * Возвращает пары ключ-значение из головы документа. Frontmatter нет —
 * пустой объект: документ без него не ошибка, просто про него ничего не известно.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trim() !== FENCE) return {}

  const out: Frontmatter = {}
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === FENCE) break
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!match) continue
    out[match[1]] = unquote(match[2].trim())
  }
  return out
}

/** Значение бывает в кавычках — они часть записи YAML, а не часть значения. */
function unquote(raw: string): string {
  if (raw.length >= 2) {
    const first = raw[0]
    if ((first === '"' || first === "'") && raw[raw.length - 1] === first) {
      return raw.slice(1, -1)
    }
  }
  return raw
}

/**
 * Страница Confluence создана и документ отгружен.
 *
 * `pending` — единственное значение, которым `/bft-fast` помечает «страницы ещё
 * нет»; всё остальное непустое считается реальным `pageId`. Пометки вида
 * `[УТОЧНИТЬ]` реальным идентификатором тоже не являются.
 */
export function isPublished(frontmatter: Frontmatter): boolean {
  const pageId = frontmatter.pageId?.trim()
  if (!pageId || pageId === 'pending') return false
  return !pageId.startsWith('[')
}

/**
 * Эпик в трекере заведён и на него можно сослаться.
 *
 * `[СОЗДАТЬ эпик]` и любая другая пометка в скобках — не ключ: ссылка на них
 * была бы выдуманной, а это прямо запрещено (ЗМ-009).
 */
export function hasEpicKey(frontmatter: Frontmatter): boolean {
  const jira = frontmatter.jira?.trim()
  return !!jira && !jira.startsWith('[')
}
