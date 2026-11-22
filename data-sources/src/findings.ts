/**
 * Находки источников данных: разбор ответов MCP (Jira/Confluence) в единый
 * вид, токенизация и ранжирование, чистка тел, триаж и карта находок для
 * полного БФТ. Чистые функции — без сети, их проверяют тесты.
 */

export type FindingKind = 'confluence' | 'jira'

/** Вердикт триажа: та же система, та же функция, смежное, не относится. */
export type Relevance = 'same_system' | 'same_function' | 'adjacent' | 'unrelated'
export const RELEVANCES: readonly Relevance[] = ['same_system', 'same_function', 'adjacent', 'unrelated']

/** Факт из находки, подтверждённый дословной цитатой из её текста. */
export interface Fact { fact: string; quote: string }

export interface Finding {
  kind: FindingKind
  /** Confluence: id страницы; Jira: ключ задачи. */
  id: string
  title: string
  url: string
  /** Пространство Confluence или проект Jira (ключ). */
  container?: string
  /** Название пространства или проекта. */
  containerName?: string
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
  /** Нашлась поиском по названию (JQL summary ~). */
  titleMatch?: boolean
  /** Второй шаг: найдена по ссылке из тела другой находки (её ключ или название). */
  via?: string
  /** Полный текст (страница/описание), если его дочитали; уже очищен. */
  body?: string
  /** Вердикт триажа (если триаж прошёл). */
  relevance?: Relevance
  /** Факты триажа, сверенные с текстом находки. */
  facts?: Fact[]
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
      ...(page.space?.name ? { containerName: page.space.name } : {}),
      type: page.type ?? 'page',
      ...(page.updated ? { updated: page.updated } : {}),
      snippet: clean(page.content?.value ?? '', 300),
      hits: 1,
      queries: [query],
    }]
  })
}

/** Одна задача из ответа jira_search / jira_get_issue. */
export function jiraIssueFinding(item: unknown, query: string | undefined): Finding | undefined {
  const issue = item as { key?: string; summary?: string; fields?: { summary?: string }; browse_url?: string; url?: string; description?: string; status?: { name?: string }; issue_type?: { name?: string }; project?: { key?: string; name?: string }; updated?: string }
  const summary = issue.summary ?? issue.fields?.summary
  if (!issue.key || !summary) return undefined
  return {
    kind: 'jira',
    id: issue.key,
    title: summary,
    url: issue.browse_url ?? issue.url ?? '',
    ...(issue.project?.key ? { container: issue.project.key } : {}),
    ...(issue.project?.name ? { containerName: issue.project.name } : {}),
    ...(issue.issue_type?.name ? { type: issue.issue_type.name } : {}),
    ...(issue.status?.name ? { status: issue.status.name } : {}),
    ...(issue.updated ? { updated: issue.updated } : {}),
    snippet: clean(issue.description ?? '', 300),
    hits: 1,
    queries: query ? [query] : [],
  }
}

export function jiraFindings(text: string, query: string): Finding[] {
  const value = unwrap(text) as { issues?: unknown[] }
  const items = Array.isArray(value?.issues) ? value.issues : []
  return items.flatMap((item): Finding[] => {
    const finding = jiraIssueFinding(item, query)
    return finding ? [finding] : []
  })
}

// ── Тип и статус ────────────────────────────────────────────────────────────

const EPIC_TYPE = /эпик|epic|инициатив|бизнес|требован|feature|фича/
const BUG_TYPE = /ошибка|bug|дефект/
const SUBTASK_TYPE = /подзадач|sub-task|subtask/
const STORY_TYPE = /истори|story/
const TASK_TYPE = /задача|task/

/** Тип находки по-русски: «Эпик (объём работ)», «Ошибка (дефект)»…; неизвестное — в скобках. */
export function typeLabel(finding: Finding): string {
  if (finding.kind === 'confluence') return 'Страница вики'
  const raw = (finding.type ?? '').trim()
  const type = raw.toLowerCase()
  if (!type) return '(не указан)'
  if (BUG_TYPE.test(type)) return 'Ошибка (дефект)'
  if (SUBTASK_TYPE.test(type)) return 'Подзадача'
  if (EPIC_TYPE.test(type)) return 'Эпик (объём работ)'
  if (STORY_TYPE.test(type)) return 'История'
  if (TASK_TYPE.test(type)) return 'Задача'
  return `(${raw})`
}

export const isBug = (finding: Finding) => finding.kind === 'jira' && BUG_TYPE.test((finding.type ?? '').toLowerCase())

const CLOSED_STATUS = /закры|заверш|done|closed|resolved|complete|решен|готов|выполн|отмен|cancel|отклон|reject/
const PROGRESS_STATUS = /работ|progress|review|ревью|тест|test|разраб|develop|анализ|analys|внедр|согласов/

/** Статус по-русски: открыт / в работе / закрыт; исходное значение — в скобках, если отличается. */
export function statusLabel(status: string | undefined): string | undefined {
  const raw = (status ?? '').trim()
  if (!raw) return undefined
  const lower = raw.toLowerCase()
  const norm = CLOSED_STATUS.test(lower) ? 'закрыт' : PROGRESS_STATUS.test(lower) ? 'в работе' : 'открыт'
  return lower === norm ? norm : `${norm} (${raw})`
}

export const isClosed = (finding: Finding) => CLOSED_STATUS.test((finding.status ?? '').toLowerCase())

// ── Токенизация ─────────────────────────────────────────────────────────────

/** Термин запроса: основа (совпадение по началу слова) или целое слово (аббревиатура — точно). */
export interface Term { key: string; exact: boolean }

/**
 * Процессные основы — есть почти в любой заявке и в любой задаче: очков не
 * дают (иначе «маршрут согласования» чужого продукта равен находке по теме).
 */
export const STOP_STEMS: ReadonlySet<string> = new Set(['согла', 'маршр', 'руков', 'интег', 'заявк', 'проце', 'систе', 'дораб', 'настр', 'порта'])
/** Короткие латинские аббревиатуры ролей и слоёв — не предмет. */
const STOP_EXACT: ReadonlySet<string> = new Set(['be', 'fe', 'ui', 'ux', 'api', 'it', 'po', 'sa', 'qa', 'ba'])

const SPLIT = /[^\p{L}\p{N}]+/u
const normalize = (text: string) => text.replace(/ё/g, 'е').replace(/Ё/g, 'Е')
/** Аббревиатура: 2–4 заглавные буквы/цифры, хотя бы одна буква (ЗУП, КЭДО, ЛК, 1С, BFF). */
const ACRONYM = /^(?=[\p{N}]*\p{Lu})[\p{Lu}\p{N}]{2,4}$/u

function termOf(raw: string): Term | undefined {
  const word = normalize(raw)
  if (!word) return undefined
  const lower = word.toLowerCase()
  if (/^\p{N}+$/u.test(word)) return undefined
  if (ACRONYM.test(word)) return STOP_EXACT.has(lower) ? undefined : { key: lower, exact: true }
  // Латиница, цифры, CamelCase — целиком: MarketA и MarketsHub — разные системы.
  if (/^[a-z0-9]+$/.test(lower)) return lower.length >= 4 ? { key: lower, exact: false } : undefined
  return lower.length >= 4 ? { key: lower.slice(0, 5), exact: false } : undefined
}

/** Термины текстов: основы слов от 4 букв (5 букв), латиница целиком, аббревиатуры точно. */
export function terms(texts: string[]): Term[] {
  const out = new Map<string, Term>()
  for (const raw of texts.join(' ').split(SPLIT)) {
    const term = termOf(raw)
    if (term && !out.has(term.key)) out.set(term.key, term)
  }
  return [...out.values()]
}

/** Термины без процессных основ — только они дают очки. */
export function contentTerms(texts: string[]): Term[] {
  return terms(texts).filter((term) => !STOP_STEMS.has(term.key))
}

/** Основы слов запросов (ключи терминов). */
export function stems(queries: string[]): string[] {
  return terms(queries).map((term) => term.key)
}

/** Слова текста для сравнения с терминами. */
export function words(text: string): Set<string> {
  return new Set(normalize(text).toLowerCase().split(SPLIT).filter(Boolean))
}

/** Термин есть в тексте: аббревиатура — целым словом, остальное — по началу слова. */
export function hasTerm(textWords: Set<string>, term: Term): boolean {
  if (term.exact) return textWords.has(term.key)
  for (const word of textWords) if (word.startsWith(term.key)) return true
  return false
}

/** Сколько терминов встречается в тексте. */
export function countTerms(text: string, list: Term[]): number {
  const set = words(text)
  return list.filter((term) => hasTerm(set, term)).length
}

// ── Ранжирование ────────────────────────────────────────────────────────────

/** Добавка за тип: эпик чуть выше истории; баг по предмету заявки не штрафуется. */
function typeWeight(finding: Finding, onSubject = true): number {
  if (finding.kind === 'confluence') return 1
  const type = (finding.type ?? '').toLowerCase()
  if (BUG_TYPE.test(type)) return onSubject ? 0 : -1
  if (SUBTASK_TYPE.test(type)) return -1
  if (EPIC_TYPE.test(type)) return 1.5
  if (STORY_TYPE.test(type) || TASK_TYPE.test(type)) return 1
  return 0.5
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
    if (finding.titleMatch) seen.titleMatch = true
    if (!seen.body && finding.body) seen.body = finding.body
    for (const query of finding.queries) if (!seen.queries.includes(query)) seen.queries.push(query)
  }
  return [...byKey.values()].sort((a, b) => (b.hits * 2 + typeWeight(b)) - (a.hits * 2 + typeWeight(a)) || (b.updated ?? '').localeCompare(a.updated ?? '') || stableKey(a).localeCompare(stableKey(b)))
}

/** Ключ последнего тай-брейка: порядок карты не зависит от порядка ответов источников. */
export const stableKey = (finding: Finding) => `${finding.kind}:${finding.id}`

/** Инциденты и обращения поддержки — не про требования: в карту не берём. */
const NOISE_TYPE = /инцидент|incident|\binc\b|remedy|обращени|service request/i

export interface RankOptions {
  /** Предмет заявки: название (первым) и имена систем. Находка без его терминов (или без имени продукта из названия и с одним словом предмета) — ×0,3. */
  subject?: string[]
  /** Относительный порог: доля лучшего результата своего вида (по умолчанию 0,4). */
  floor?: number
  /**
   * Объект заявки — то, что она меняет («промокод», «заявление»), а не
   * платформа. Не меньше половины мест своего вида — находкам с этим словом
   * (порог среди них — от лучшей из них): страницы платформы не вытесняют
   * находки о самом действии (раунд 5).
   */
  object?: string
}

/**
 * Ранжировать для карты. Очки — покрытие каждого запроса (доля его
 * непроцессных терминов) в названии ×6 и в выдержке ×2, лучшее по запросам;
 * маленькие добавки за повторные находки, за совпадение в названии Jira и за
 * тип. Находка без терминов предмета заявки — ×0,3 (если после порога
 * осталось меньше трёх — добор до трёх из порядка без фильтра, после предметных). Порог — 0,4 от лучшего своего вида;
 * perKind — верхняя граница, а не квота. Инциденты и находки без совпадений — вон.
 */
export function rank(findings: Finding[], queries: string[], perKind = 5, options: RankOptions = {}): Finding[] {
  let perQuery = queries.map((query) => contentTerms([query])).filter((list) => list.length > 0)
  // Запросы только из процессных слов — лучше считать по ним, чем не найти ничего.
  if (!perQuery.length) perQuery = queries.map((query) => terms([query])).filter((list) => list.length > 0)
  const subject = options.subject ? contentTerms(options.subject) : []
  const floor = options.floor ?? 0.4
  const objectTerms = options.object ? contentTerms([options.object]) : []
  // Имена продуктов — только из названия заявки (первый элемент subject): системы из «Команд» в названиях находок редки.
  const names = options.subject?.[0] ? contentTerms([options.subject[0]]).filter((term) => term.exact || /^[a-z0-9]+$/.test(term.key)) : []
  // Повторные находки — только по запросам ранга: запросы модели расширяют выдачу, но очки от них не растут (раунд 6).
  const rankSet = new Set(queries.map((q) => q.trim().toLowerCase()))
  const hitsOf = (finding: Finding) => {
    if (!finding.queries.length) return finding.hits
    const own = finding.queries.filter((q) => rankSet.has(q.trim().toLowerCase())).length
    return own === finding.queries.length ? finding.hits : Math.max(1, Math.round(finding.hits * own / finding.queries.length))
  }
  const base = merge(findings).flatMap((finding) => {
    if (NOISE_TYPE.test(finding.type ?? '')) return []
    const title = words(finding.title)
    const snippet = words(finding.snippet)
    const cover = (set: Set<string>) => Math.max(0, ...perQuery.map((list) => list.filter((term) => hasTerm(set, term)).length / list.length))
    const inTitle = cover(title)
    const inSnippet = cover(snippet)
    if (inTitle + inSnippet === 0) return []
    // Предмет с именами продуктов (латиница, аббревиатуры): находка без единого имени и лишь с одним
    // общим словом предмета («промокод», «отпуск») — чужой продукт или частный случай, не предмет (раунд 4).
    const subjectHits = subject.filter((term) => hasTerm(title, term) || hasTerm(snippet, term))
    const named = names.length === 0 || names.some((term) => subjectHits.includes(term)) || subjectHits.length >= 2
    const onSubject = subject.length === 0 || (subjectHits.length > 0 && named)
    // Фокус названия: доля его непроцессных слов, которые покрывает запрос. «Процесс согласования
    // заявления на отпуск» — целиком о предмете; «Заявление об отпуске по уходу за ребёнком» — о частном случае.
    const titleWords = [...title].filter((w) => contentTerms([w]).length > 0)
    const focus = titleWords.length ? Math.max(0, ...perQuery.map((list) => titleWords.filter((w) => list.some((term) => hasTerm(new Set([w]), term))).length / titleWords.length)) : 0
    const base = Math.max(0, inTitle * 6 + inSnippet * 2 + Math.min(hitsOf(finding) - 1, 3) * 0.5 + (finding.titleMatch ? 1 : 0) + typeWeight(finding, onSubject))
    // Фокус двигает порядок, а не порог: порог — по очкам без него.
    return [{ finding, score: base + focus * 2, base, onSubject }]
  })
  const select = (filtered: boolean) => {
    const scored = base.map((item) => ({ ...item, ...(filtered && !item.onSubject ? { score: item.score * 0.3, base: item.base * 0.3 } : {}) }))
      // Давность — только тай-брейк: свежее выше при равных очках.
      .sort((a, b) => b.score - a.score || (b.finding.updated ?? '').localeCompare(a.finding.updated ?? '') || stableKey(a.finding).localeCompare(stableKey(b.finding)))
    const pick = (kind: FindingKind) => {
      const ofKind = scored.filter((item) => item.finding.kind === kind)
      const top = Math.max(0, ...ofKind.map((item) => item.base))
      const passing = ofKind.filter((item) => item.base > 0 && item.base >= floor * top)
      if (!objectTerms.length) return passing.slice(0, perKind)
      const withObject = ofKind.filter((item) => item.base > 0 && objectTerms.some((term) => hasTerm(words(`${item.finding.title} ${item.finding.snippet}`), term)))
      const objectTop = Math.max(0, ...withObject.map((item) => item.base))
      const reserved = withObject.filter((item) => item.base >= floor * objectTop).slice(0, Math.ceil(perKind / 2))
      const rest = passing.filter((item) => !reserved.includes(item)).slice(0, perKind - reserved.length)
      return [...reserved, ...rest]
    }
    return [...pick('confluence'), ...pick('jira')].sort((a, b) => b.score - a.score || (b.finding.updated ?? '').localeCompare(a.finding.updated ?? '') || stableKey(a.finding).localeCompare(stableKey(b.finding)))
  }
  const chosen = select(subject.length > 0)
  // Фильтр оставил меньше трёх — добираем из порядка без фильтра (после предметных): карта не пустеет.
  if (subject.length > 0 && chosen.length < 3) {
    for (const item of select(false)) {
      if (chosen.length >= 3) break
      if (!chosen.some((c) => c.finding === item.finding)) chosen.push(item)
    }
  }
  return chosen.map((item) => item.finding)
}

/** Находка про предмет заявки: термин предмета есть в названии. */
export function titleOnSubject(finding: Finding, subject: string[]): boolean {
  const list = contentTerms(subject)
  const title = words(finding.title)
  return list.some((term) => hasTerm(title, term))
}

// ── Запросы к Jira ──────────────────────────────────────────────────────────

const phraseOf = (query: string) => query.replace(/[\\"]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * JQL по фразе: по названию (точнее) и по всему тексту (полнее), без
 * подзадач и без ORDER BY — Jira отдаёт в порядке релевантности, а не
 * «что трогали последним».
 */
export function jqlsFor(query: string): { jql: string; titleMatch: boolean }[] {
  const phrase = phraseOf(query)
  const notSub = 'issuetype not in subTaskIssueTypes()'
  return [
    { jql: `summary ~ "${phrase}" AND ${notSub}`, titleMatch: true },
    { jql: `text ~ "${phrase}" AND ${notSub}`, titleMatch: false },
  ]
}

/** JQL состава эпика (пустое описание): дочерние задачи двумя способами. */
export function childJqls(key: string): string[] {
  return [`"Epic Link" = ${key}`, `parent = ${key}`]
}

// ── Тела находок ────────────────────────────────────────────────────────────

/** Шаблонные разделы страниц — не содержание: вырезаются до следующего заголовка того же уровня. */
const BOILERPLATE = /^(История изменений|Общая информация|Полезные артефакты|Ревью|Согласовани)/i

const quoteKey = (text: string) => normalize(text).toLowerCase().replace(/[\\*_|`>#]/g, ' ').replace(/\s+/g, ' ').trim()

/** Ячейки строки таблицы — только @-упоминания, даты и номера. */
function onlyMentionsAndDates(line: string): boolean {
  if (!/^\s*\|/.test(line)) return false
  const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean)
  if (!cells.length || cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return false
  const meaningful = cells.filter((cell) => !/^\d{1,3}$/.test(cell))
  return meaningful.length > 0 && meaningful.every((cell) => /^@/.test(cell) || /^\d{4}-\d{2}-\d{2}([ T][\d:]+)?$|^\d{2}\.\d{2}\.\d{4}$/.test(cell))
}

/**
 * Очистить тело находки и уложить в бюджет: без шаблонных разделов,
 * макросов («true»), картинок и figma, строк «кто и когда», абзацев, уже
 * выведенных в этой разведке (seen). Заголовки опускаются до «###» и ниже —
 * чтобы не ломать разбор карты по «## ». Режется по целой строке, с «…».
 */
export function cleanBody(raw: string, budget: number, seen: Set<string> = new Set()): string {
  const text = raw
    .replace(/\r/g, '')
    // Макрос Jira в Confluence оставляет «Jira<uuid>KEY-1» — убираем uuid, ключ остаётся.
    .replace(/Jira[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/![^!\n]+\|thumbnail!/g, '')
    .replace(/![^!\s]+\.(?:png|jpe?g|gif|svg|webp)(?:\|[^!\n]*)?!/gi, '')
    .replace(/\[[^\]\n]*\]\(https?:\/\/[^)\s]*figma\.com[^)]*\)/gi, '')
    .replace(/https?:\/\/\S*figma\.com\S*/gi, '')
    .replace(/@Unknown User/gi, '')
    .replace(/\{(?:code|noformat|panel|quote|color|anchor|status)(?::[^}]*)?\}/gi, '')
  const source = text.split('\n')
  type Line = { text: string; level?: number }
  const lines: Line[] = []
  for (let i = 0; i < source.length; i++) {
    const line = source[i]!
    const next = source[i + 1]
    const atx = /^(#{1,6})\s+(.*)$/.exec(line) ?? /^h([1-6])\.\s+(.*)$/.exec(line)
    if (atx) {
      lines.push({ text: atx[2]!.trim(), level: atx[1]!.startsWith('#') ? atx[1]!.length : Number(atx[1]) })
      continue
    }
    if (line.trim() && next !== undefined && /^\s*(={2,}|-{2,})\s*$/.test(next) && !/^\s*[|>*+-]/.test(line)) {
      lines.push({ text: line.trim(), level: next.trim().startsWith('=') ? 1 : 2 })
      i++
      continue
    }
    lines.push({ text: line })
  }
  // Шаблонные разделы — до заголовка того же или более высокого уровня.
  const kept: Line[] = []
  let skipLevel: number | undefined
  for (const line of lines) {
    if (line.level !== undefined) {
      if (skipLevel !== undefined && line.level <= skipLevel) skipLevel = undefined
      if (skipLevel === undefined && BOILERPLATE.test(line.text)) { skipLevel = line.level; continue }
    }
    if (skipLevel !== undefined) continue
    if (line.level === undefined) {
      const t = line.text.trim()
      if (/^(true|false)$/i.test(t)) continue
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue
      if (onlyMentionsAndDates(line.text)) continue
      // Повтор шаблонного заголовка обычным текстом («История изменений» под одноимённым заголовком).
      if (BOILERPLATE.test(t) && t.length < 40) continue
    }
    kept.push(line)
  }
  // Блоки по пустым строкам; повторы абзацев из прошлых находок — вон.
  type Block = { text: string; level?: number }
  const blocks: Block[] = []
  let current: string[] = []
  const flush = () => {
    const body = current.join('\n').trim()
    current = []
    if (!body) return
    const key = quoteKey(body)
    if (key.length >= 40) {
      if (seen.has(key)) return
      seen.add(key)
    }
    blocks.push({ text: body })
  }
  for (const line of kept) {
    if (line.level !== undefined) {
      flush()
      blocks.push({ text: line.text, level: line.level })
    } else if (!line.text.trim()) flush()
    else current.push(line.text.replace(/\s+$/, ''))
  }
  flush()
  // Пустые разделы (заголовок, за которым сразу заголовок того же уровня или выше, или конец) — вон.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!
    if (block.level === undefined) continue
    const next = blocks[i + 1]
    if (!next || (next.level !== undefined && next.level <= block.level)) blocks.splice(i, 1)
  }
  const out = blocks.map((block) => (block.level !== undefined ? `${'#'.repeat(Math.min(6, block.level + 2))} ${block.text}` : block.text)).join('\n\n')
  if (out.length <= budget) return out
  const result: string[] = []
  let size = 0
  for (const line of out.split('\n')) {
    if (size + line.length + 1 > budget - 1) break
    result.push(line)
    size += line.length + 1
  }
  return `${result.join('\n').trimEnd()}\n…`
}

/** Ответ jira_search дочерних задач → строки «Состав эпика». */
export function epicChildren(key: string, findings: Finding[]): string {
  const children = merge(findings).filter((child) => child.id !== key).slice(0, 8)
  if (!children.length) return '(описание пустое)'
  return ['Состав эпика:', ...children.map((child) => `- ${child.id} — ${child.title.replace(/\s+/g, ' ').trim()}${child.status ? ` (${child.status})` : ''}`)].join('\n')
}

// ── Второй шаг: ссылки из тел ───────────────────────────────────────────────

export type Lead = { kind: 'jira'; id: string } | { kind: 'confluence'; id: string; url: string; label: string }

/** Подписанная строка: эпик, аналитика, родитель, связанные. */
const SIGNED = /(?:^|[\s|*>(-])(epic|эпик|аналитик|родител|parent|связан|related)/i
const KEY = /(?<![\w/-])([A-Z][A-Z0-9_]{1,15}-\d{1,7})(?![\w-])/g
/** Markdown-ссылка; подпись может содержать одну пару скобок ([[BI\\_28] Страница](url)). */
const LINK = /\[((?:[^[\]\n]|\[[^\]\n]*\])+)\]\((https?:\/\/[^)\s]+)\)/g

/**
 * Куда идти вторым шагом: ключи Jira и страницы Confluence из подписанных
 * строк (Epic / Аналитика / Родитель / Связано) или из ссылок, в подписи
 * которых есть термин предмета заявки. Уже известные находки — мимо.
 */
export function extractLeads(body: string, subject: string[], known: Set<string>, max = 3): Lead[] {
  const subjectTerms = contentTerms(subject)
  const out: Lead[] = []
  const add = (lead: Lead) => {
    const key = `${lead.kind}:${lead.id}`
    if (known.has(key) || out.some((item) => `${item.kind}:${item.id}` === key) || out.length >= max) return
    out.push(lead)
  }
  for (const line of body.split('\n')) {
    const signed = SIGNED.test(line)
    for (const match of line.matchAll(LINK)) {
      const [, label, url] = match as unknown as [string, string, string]
      if (!signed && !subjectTerms.some((term) => hasTerm(words(label), term))) continue
      const page = /pageId=(\d+)/.exec(url)?.[1]
      const key = /\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(url)?.[1]
      if (page) add({ kind: 'confluence', id: page, url, label: label.replace(/\\/g, '').replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim() })
      else if (key) add({ kind: 'jira', id: key })
    }
    if (signed) {
      const plain = line.replace(LINK, ' ')
      for (const match of plain.matchAll(KEY)) add({ kind: 'jira', id: match[1]! })
    }
  }
  return out
}

/** Синоним системы: «Имя (Синоним)», где одна сторона в точности — система из заявки. */
export interface Synonym { system: string; alias: string }

export function synonymsIn(texts: string[], systems: string[]): Synonym[] {
  const names = systems.map((system) => system.trim()).filter((system) => system.length >= 2)
  const same = (a: string, b: string) => normalize(a).toLowerCase() === normalize(b).toLowerCase()
  const out: Synonym[] = []
  const add = (system: string, alias: string) => {
    const clean = alias.replace(/[\\*_`"«»]/g, '').trim()
    if (clean.length < 2 || clean.length > 30 || same(clean, system)) return
    // Имя системы начинается с заглавной или цифры и не содержит отдельных чисел:
    // «(из OrdersDB)», «(Этапе 1)» — обстоятельство в скобках, не другое название.
    if (!/^[\p{Lu}\p{N}]/u.test(clean) || clean.split(/\s+/).some((w) => /^\p{N}+$/u.test(w))) return
    if (out.some((item) => same(item.system, system) && same(item.alias, clean))) return
    out.push({ system, alias: clean })
  }
  for (const text of texts) {
    for (const match of text.matchAll(/([\p{L}\p{N}][\p{L}\p{N} .-]{0,40}?)\s*\(([\p{L}\p{N}][\p{L}\p{N} .-]{0,30}?)\)/gu)) {
      const left = match[1]!.trim()
      const inner = match[2]!.trim()
      for (const system of names) {
        // Левая часть может начинаться с чужих слов («Система Saleport (Опора)») — сверяем её хвост.
        const leftTail = left.split(/\s+/).slice(-system.split(/\s+/).length).join(' ')
        if (same(inner, system)) add(system, left.split(/\s+/).at(-1) ?? '')
        else if (same(leftTail, system)) add(system, inner)
      }
    }
  }
  return out.slice(0, 3)
}

// ── Триаж ───────────────────────────────────────────────────────────────────

/** Находка для триажа: ссылка-идентификатор, тип, статус, начало текста. */
export interface TriageItem { ref: string; kind: FindingKind; title: string; type: string; status?: string; text: string }
export interface TriageVerdict { ref: string; relevance: Relevance; facts?: Fact[] }

export const triageRef = (finding: Finding) => (finding.kind === 'jira' ? finding.id : `page-${finding.id}`)

/** Находки для триажа — вся карта (до 14: ранжированные и вторым шагом), по ~1,2 тыс. символов текста; без вердикта находка остаётся без ссылки для БФТ. */
export function triageItems(findings: Finding[], max = 14, chars = 1200): TriageItem[] {
  return findings.slice(0, max).map((finding) => ({
    ref: triageRef(finding),
    kind: finding.kind,
    title: finding.title,
    type: typeLabel(finding),
    ...(statusLabel(finding.status) ? { status: statusLabel(finding.status)! } : {}),
    text: (finding.body || finding.snippet || '').slice(0, chars),
  }))
}

/** Нормализация для сверки цитаты: без экранирования и разметки, пробелы схлопнуты, нижний регистр. */
export function quoteNorm(text: string): string {
  return normalize(text).toLowerCase().replace(/\\/g, '').replace(/[*_|`«»"„“”]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[\s.,;:…-]+|[\s.,;:…-]+$/g, '')
}

/**
 * Вердикты триажа → в находки. Факт остаётся, только если его цитата
 * дословно есть в тексте находки (после нормализации); не больше четырёх.
 */
export function applyTriage(findings: Finding[], verdicts: TriageVerdict[]): Finding[] {
  const byRef = new Map(verdicts.filter((v) => v && typeof v.ref === 'string' && RELEVANCES.includes(v.relevance)).map((v) => [v.ref, v]))
  return findings.map((finding) => {
    const verdict = byRef.get(triageRef(finding))
    if (!verdict) return finding
    const haystack = quoteNorm(`${finding.title}\n${finding.body ?? ''}\n${finding.snippet}`)
    const facts = (Array.isArray(verdict.facts) ? verdict.facts : [])
      .filter((f) => f && typeof f.fact === 'string' && typeof f.quote === 'string')
      .filter((f) => { const q = quoteNorm(f.quote); return q.length >= 8 && haystack.includes(q) })
      .slice(0, 4)
      .map((f) => ({ fact: f.fact.replace(/\s+/g, ' ').trim(), quote: f.quote.replace(/\s+/g, ' ').trim() }))
    return { ...finding, relevance: verdict.relevance, ...(facts.length ? { facts } : {}) }
  })
}

// ── Карта находок ───────────────────────────────────────────────────────────

/** Подпись ссылки: название целиком; длинное — по границе слова с «…» (не посреди слова). */
function labelOf(title: string, max = 140): string {
  if (title.length <= max) return title
  const cut = title.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:—–-]+$/, '')}…`
}

/** Готовая ссылка на находку для БФТ — в форме, которую принимает bft-lint
 * (ключ задачи и страница вики — только markdown-ссылкой, LN001/LN002). */
export function citation(finding: Finding): string {
  const label = finding.kind === 'jira'
    ? `Jira ${finding.id}`
    : `Confluence: ${labelOf(finding.title.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim())}`
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

const YEAR_MS = 365.25 * 24 * 3600 * 1000
const years = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'год' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'года' : 'лет')

/** Давность от метки разведки (не от «сейчас» — тесты детерминированы); закрытые задачи Jira — без пометки. */
export function staleness(finding: Finding, at: string): string | undefined {
  if (!finding.updated || (finding.kind === 'jira' && isClosed(finding))) return undefined
  const updated = Date.parse(finding.updated.slice(0, 10))
  const now = Date.parse(at.slice(0, 10))
  if (Number.isNaN(updated) || Number.isNaN(now)) return undefined
  const age = Math.floor((now - updated) / YEAR_MS)
  return age >= 3 ? `давность: ${age} ${years(age)}, актуальность не подтверждена` : undefined
}

const RELEVANCE_LABEL: Record<Relevance, string> = {
  same_system: 'та же система',
  same_function: 'та же функция',
  adjacent: 'смежное',
  unrelated: 'не относится',
}

/**
 * Место находки в БФТ по вердикту триажа, типу и статусу (раунд 6) — подсказка
 * модели, куда её ставить; текст БФТ пишет модель, код ничего не вставляет.
 * Найденная вторым шагом и без вердикта — без подсказки (указатель).
 */
export function roleOf(finding: Finding): string | undefined {
  if (finding.via || !finding.relevance || finding.relevance === 'unrelated') return undefined
  if (finding.relevance === 'adjacent') return 'смежное: не больше строки «Якорей» R2, в текст БФТ не переносится'
  const same = finding.relevance === 'same_function'
  if (isBug(finding)) {
    if (isClosed(finding)) return 'закрытая ошибка: только строка «Якорей» R2'
    return same ? '«Риски»: открытая ошибка той же функции — строка со ссылкой' : '«Зависимости»: открытая ошибка той же системы, не этого действия — сверить, не риск'
  }
  if (finding.kind === 'jira' && !isClosed(finding)) return '«Зависимости»: параллельная работа — «Параллельная работа: сверить объём — {ссылка}»'
  return same
    ? 'решение того же действия: сверь с ASIS — «По {ссылка}: …» в «Было» шага UJM, который оно описывает; пересечение с заявкой — строка «Рисков» со ссылкой; уже покрытое — не новое требование'
    : '«Зависимости»: предпосылка (та же система, другое действие) — «Опирается на {ссылка}: {факт}»'
}

export interface MapMeta {
  source: string
  queries: string[]
  at: string
  /** Синонимы систем, найденные в телах (и дополнительный запрос по ним). */
  synonyms?: Synonym[]
}

/**
 * Карта находок для полного БФТ: указатель (что и где лежит) с выдержками.
 * Модель берёт из неё факты только с якорем и ссылкой — это не фактбаза.
 * Если прошёл триаж: сперва находки про ту же систему или функцию (с
 * фактами-цитатами), потом прочие, потом найденные вторым шагом, в хвосте —
 * отсеянные триажем, без ссылок.
 */
export function findingsMarkdown(findings: Finding[], meta: MapMeta): string {
  if (findings.length === 0) {
    return `# Корпоративные источники\n\nИсточник: ${meta.source}. Запросы: ${meta.queries.map((q) => `«${q}»`).join(', ')}. Ничего не найдено.\n`
  }
  const base = jiraBrowseBase(findings)
  const lines = [
    '# Корпоративные источники',
    '',
    `Источник: ${meta.source} · ${meta.at}. Запросы: ${meta.queries.map((q) => `«${q}»`).join(', ')}.`,
  ]
  if (meta.synonyms?.length) lines.push(`Другие названия систем (из найденных страниц): ${meta.synonyms.map((s) => `«${s.system}» — «${s.alias}»`).join('; ')}.`)
  lines.push('Это указатель: факт из находки в БФТ — только со ссылкой на неё (строка «Ссылка для БФТ» — копировать как есть). Совпадение по словам ещё не значит, что находка про эту заявку.', '')

  const block = (finding: Finding) => {
    const container = finding.container && finding.containerName && finding.containerName !== finding.container ? `${finding.container} (${finding.containerName})` : finding.container ?? finding.containerName
    const where = [finding.kind === 'confluence' ? 'Confluence' : 'Jira', container, finding.type, finding.status, finding.updated?.slice(0, 10), staleness(finding, meta.at)].filter(Boolean).join(' · ')
    const status = finding.kind === 'jira' ? statusLabel(finding.status) : undefined
    lines.push(`## ${finding.kind === 'jira' ? `${finding.id} · ` : ''}${finding.title}`)
    lines.push(where)
    lines.push(`Тип: ${typeLabel(finding)}${status ? ` · Статус: ${status}` : ''}`)
    lines.push(`Ссылка для БФТ: ${citation(finding)}`)
    if (finding.relevance) lines.push(`Отношение к заявке: ${RELEVANCE_LABEL[finding.relevance]}`)
    const role = roleOf(finding)
    if (role) lines.push(`→ ${role}`)
    if (finding.facts?.length) {
      lines.push('Факты (цитаты сверены с текстом находки):')
      for (const fact of finding.facts) lines.push(`- ${linkKeys(fact.fact, base)} — «${fact.quote}»`)
    }
    if (finding.body) lines.push('', linkKeys(finding.body, base))
    else if (finding.snippet) lines.push('', `> ${linkKeys(finding.snippet, base)}`)
    lines.push('')
  }

  const direct = findings.filter((f) => !f.via)
  const related = findings.filter((f) => f.via && f.relevance !== 'unrelated')
  const triaged = findings.some((f) => f.relevance)
  if (triaged) {
    const same = direct.filter((f) => f.relevance === 'same_system' || f.relevance === 'same_function')
    const other = direct.filter((f) => f.relevance !== 'same_system' && f.relevance !== 'same_function' && f.relevance !== 'unrelated')
    if (same.length) {
      lines.push('## Про ту же систему или функцию — факты (R2, со ссылкой)', '')
      same.forEach(block)
    }
    if (other.length) {
      lines.push('## Смежные и без вердикта — только как указатель', '')
      other.forEach(block)
    }
  } else direct.forEach(block)
  const parents = [...new Set(related.map((f) => f.via!))]
  for (const parent of parents) {
    lines.push(`## Связанные (через ${parent})`, '')
    related.filter((f) => f.via === parent).forEach(block)
  }
  const dropped = findings.filter((f) => f.relevance === 'unrelated')
  if (dropped.length) {
    lines.push('## Отсеяно триажем (не использовать)', '')
    for (const f of dropped) lines.push(`- ${f.kind === 'jira' ? `${f.id} · ` : 'Confluence · '}${f.title}`)
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
