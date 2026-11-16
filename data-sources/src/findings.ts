/**
 * Находки источников данных: разбор ответов MCP (Jira/Confluence) в единый
 * вид, ранжирование и карта находок для полного БФТ. Чистые функции — без
 * сети, их проверяют тесты.
 */

export type FindingKind = 'confluence' | 'jira'

export interface Finding {
  kind: FindingKind
  /** Confluence: id страницы; Jira: ключ задачи. */
  id: string
  title: string
  url: string
  /** Пространство Confluence или проект Jira. */
  container?: string
  /** Тип задачи Jira / «page» Confluence. */
  type?: string
  status?: string
  updated?: string
  /** Короткая выдержка: подсветка поиска или начало описания. */
  snippet: string
  /** По скольким запросам нашлось (для ранжирования). */
  hits: number
  /** Запросы, которые нашли эту находку. */
  queries: string[]
  /** Полный текст (страница/описание), если его дочитали. */
  body?: string
}

/** Ответ инструмента: JSON, иногда завёрнутый в {"result": "<json>"}. */
export function unwrap(text: string): unknown {
  let value: unknown = JSON.parse(text)
  if (value && typeof value === 'object' && typeof (value as { result?: unknown }).result === 'string') {
    try { value = JSON.parse((value as { result: string }).result) } catch { value = (value as { result: string }).result }
  }
  return value
}

const clean = (text: string, max: number) => text
  .replace(/@@@(?:end)?hl@@@/g, '')
  .replace(/![^!\n]+\|thumbnail!/g, '')
  .replace(/\{[a-z]+(?::[^}]*)?\}/gi, '')
  .replace(/h\d\.\s*/g, '')
  .replace(/\r/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

export function confluenceFindings(text: string, query: string): Finding[] {
  const value = unwrap(text)
  const items = Array.isArray(value) ? value : []
  return items.flatMap((item): Finding[] => {
    const page = item as { id?: string | number; title?: string; url?: string; type?: string; updated?: string; space?: { key?: string; name?: string }; content?: { value?: string } }
    if (!page.id || !page.title || !page.url) return []
    return [{
      kind: 'confluence',
      id: String(page.id),
      title: page.title,
      url: page.url,
      ...(page.space?.key ? { container: page.space.key } : {}),
      type: page.type ?? 'page',
      ...(page.updated ? { updated: page.updated } : {}),
      snippet: clean(page.content?.value ?? '', 300),
      hits: 1,
      queries: [query],
    }]
  })
}

export function jiraFindings(text: string, query: string): Finding[] {
  const value = unwrap(text) as { issues?: unknown[] }
  const items = Array.isArray(value?.issues) ? value.issues : []
  return items.flatMap((item): Finding[] => {
    const issue = item as { key?: string; summary?: string; browse_url?: string; url?: string; description?: string; status?: { name?: string }; issue_type?: { name?: string }; project?: { key?: string }; updated?: string }
    if (!issue.key || !issue.summary) return []
    return [{
      kind: 'jira',
      id: issue.key,
      title: issue.summary,
      url: issue.browse_url ?? issue.url ?? '',
      ...(issue.project?.key ? { container: issue.project.key } : {}),
      ...(issue.issue_type?.name ? { type: issue.issue_type.name } : {}),
      ...(issue.status?.name ? { status: issue.status.name } : {}),
      ...(issue.updated ? { updated: issue.updated } : {}),
      snippet: clean(issue.description ?? '', 300),
      hits: 1,
      queries: [query],
    }]
  })
}

/** Ошибки и подзадачи — ниже эпиков, историй и требований: БФТ о том, что нужно, а не о багах. */
function typeWeight(finding: Finding): number {
  if (finding.kind === 'confluence') return 2
  const type = (finding.type ?? '').toLowerCase()
  if (/эпик|epic|инициатив|бизнес|требован|feature|фича/.test(type)) return 3
  if (/истори|story|задача|task/.test(type)) return 2
  if (/ошибка|bug|дефект|подзадач|sub-task|subtask/.test(type)) return -1
  return 1
}

/** Слить находки разных запросов: одна находка — одна строка, hits копятся. */
export function merge(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>()
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.id}`
    const seen = byKey.get(key)
    if (!seen) {
      byKey.set(key, { ...finding, queries: [...finding.queries] })
      continue
    }
    seen.hits += finding.hits
    for (const query of finding.queries) if (!seen.queries.includes(query)) seen.queries.push(query)
  }
  return [...byKey.values()].sort((a, b) => (b.hits * 2 + typeWeight(b)) - (a.hits * 2 + typeWeight(a)) || (b.updated ?? '').localeCompare(a.updated ?? ''))
}

/** Инциденты и обращения поддержки — не про требования: в карту не берём. */
const NOISE_TYPE = /инцидент|incident|\binc\b|remedy|обращени|service request/i

/** Основы слов запросов: слова от 4 букв, обрезанные до 5 (грубая основа для русского). */
export function stems(queries: string[]): string[] {
  const words = queries.join(' ').toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}:]+/u).filter((word) => word.length >= 4)
  return [...new Set(words.map((word) => word.slice(0, 5)))]
}

/** Сколько основ запросов встречается в тексте. */
function matches(text: string, keys: string[]): number {
  const haystack = text.toLowerCase().replace(/ё/g, 'е')
  return keys.filter((key) => haystack.includes(key)).length
}

/**
 * Ранжировать для карты: совпадения основ в названии весят втрое больше, чем в
 * выдержке; повторные находки и тип (эпик > история > ошибка) — добавка.
 * Без единого совпадения и инциденты — вон. Confluence и Jira — поровну:
 * иначе эпики Jira вытесняют страницы требований.
 */
export function rank(findings: Finding[], queries: string[], perKind = 5): Finding[] {
  const keys = stems(queries)
  const scored = merge(findings).flatMap((finding) => {
    if (NOISE_TYPE.test(finding.type ?? '')) return []
    const title = matches(finding.title, keys)
    const snippet = matches(finding.snippet, keys)
    if (title + snippet === 0) return []
    // Тип весит вдвое: эпик с одним словом запроса в названии выше бага с двумя.
    return [{ finding, score: title * 3 + snippet + (finding.hits - 1) * 2 + typeWeight(finding) * 2 }]
  }).sort((a, b) => b.score - a.score || (b.finding.updated ?? '').localeCompare(a.finding.updated ?? ''))
  const pick = (kind: FindingKind) => scored.filter((item) => item.finding.kind === kind).slice(0, perKind)
  return [...pick('confluence'), ...pick('jira')].sort((a, b) => b.score - a.score).map((item) => item.finding)
}

/** JQL полнотекстового поиска по фразе; кавычки и обратные слэши экранированы. */
export function jqlFor(query: string): string {
  const phrase = query.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim()
  return `text ~ "${phrase}" ORDER BY updated DESC`
}

/**
 * Готовая ссылка на находку для БФТ — в форме, которую принимает bft-lint
 * (ключ задачи и страница вики — только markdown-ссылкой, LN001/LN002).
 */
export function citation(finding: Finding): string {
  const label = finding.kind === 'jira'
    ? `Jira ${finding.id}`
    : `Confluence: ${finding.title.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}`
  return `[${label}](${finding.url})`
}

/** Адрес Jira для ссылок на ключи: из browse_url любой находки Jira. */
export function jiraBrowseBase(findings: Finding[]): string | undefined {
  for (const finding of findings) {
    const match = finding.kind === 'jira' ? finding.url.match(/^(https?:\/\/[^\s]+\/browse\/)[A-Z][A-Z0-9_]+-\d+/) : null
    if (match) return match[1]
  }
  return undefined
}

/** Голые ключи задач в тексте находки → markdown-ссылки (bft-lint LN001). */
export function linkKeys(text: string, base: string | undefined): string {
  if (!base) return text
  // Готовые markdown-ссылки пропускаем целиком: ключ в их подписи уже оформлен.
  return text.replace(/(\[[^\]\n]*\]\([^)\s]*\))|(^|[^\w[\/-])([A-Z][A-Z0-9_]{1,15}-\d{1,7})(?![\w\]-])/g,
    (match, link: string | undefined, lead: string, key: string) => (link ? match : `${lead}[${key}](${base}${key})`))
}

/**
 * Карта находок для полного БФТ: указатель (что и где лежит) с выдержками.
 * Модель берёт из неё факты только с якорем и ссылкой — это не фактбаза.
 */
export function findingsMarkdown(findings: Finding[], meta: { source: string; queries: string[]; at: string }): string {
  if (findings.length === 0) {
    return `# Корпоративные источники\n\nИсточник: ${meta.source}. Запросы: ${meta.queries.map((q) => `«${q}»`).join(', ')}. Ничего не найдено.\n`
  }
  const base = jiraBrowseBase(findings)
  const lines = [
    '# Корпоративные источники',
    '',
    `Источник: ${meta.source} · ${meta.at}. Запросы: ${meta.queries.map((q) => `«${q}»`).join(', ')}.`,
    'Это указатель: факт из находки в БФТ — только со ссылкой на неё (строка «Ссылка для БФТ» — копировать как есть). Совпадение по словам ещё не значит, что находка про эту заявку.',
    '',
  ]
  for (const finding of findings) {
    const where = [finding.kind === 'confluence' ? 'Confluence' : 'Jira', finding.container, finding.type, finding.status, finding.updated?.slice(0, 10)].filter(Boolean).join(' · ')
    lines.push(`## ${finding.kind === 'jira' ? `${finding.id} · ` : ''}${finding.title}`)
    lines.push(`${where}`)
    lines.push(`Ссылка для БФТ: ${citation(finding)}`)
    if (finding.body) lines.push('', linkKeys(finding.body, base))
    else if (finding.snippet) lines.push('', `> ${linkKeys(finding.snippet, base)}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
