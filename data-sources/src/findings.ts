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
  if (/ошибка|bug|дефект|подзадач|sub-task|subtask/.test(type)) return 0
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

/** JQL полнотекстового поиска по фразе; кавычки и обратные слэши экранированы. */
export function jqlFor(query: string): string {
  const phrase = query.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim()
  return `text ~ "${phrase}" ORDER BY updated DESC`
}

/** Якорь находки в карте: [CF-1], [JR-2] — на них ссылается БФТ. */
export function anchors(findings: Finding[]): Map<Finding, string> {
  const result = new Map<Finding, string>()
  let cf = 0
  let jr = 0
  for (const finding of findings) result.set(finding, finding.kind === 'confluence' ? `CF-${++cf}` : `JR-${++jr}`)
  return result
}

/**
 * Карта находок для полного БФТ: указатель (что и где лежит) с выдержками.
 * Модель берёт из неё факты только с якорем и ссылкой — это не фактбаза.
 */
export function findingsMarkdown(findings: Finding[], meta: { source: string; queries: string[]; at: string }): string {
  if (findings.length === 0) {
    return `# Корпоративные источники\n\nИсточник: ${meta.source}. Запросы: ${meta.queries.map((q) => `«${q}»`).join(', ')}. Ничего не найдено.\n`
  }
  const marks = anchors(findings)
  const lines = [
    '# Корпоративные источники',
    '',
    `Источник: ${meta.source} · ${meta.at}. Запросы: ${meta.queries.map((q) => `«${q}»`).join(', ')}.`,
    'Это указатель: факт из находки в БФТ — только со ссылкой на неё. Совпадение по словам ещё не значит, что находка про эту заявку.',
    '',
  ]
  for (const finding of findings) {
    const where = [finding.kind === 'confluence' ? 'Confluence' : 'Jira', finding.container, finding.type, finding.status, finding.updated?.slice(0, 10)].filter(Boolean).join(' · ')
    lines.push(`## [${marks.get(finding)}] ${finding.title}`)
    lines.push(`${where} — ${finding.url}`)
    if (finding.body) lines.push('', finding.body)
    else if (finding.snippet) lines.push('', `> ${finding.snippet}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
