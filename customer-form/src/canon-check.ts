/**
 * Детерминированные пост-проходы и проверки канона deep (план качества, C0).
 *
 * Два входа:
 *  - `autoFix(canon, ctx)` — цепочка правок, которые код делает сам (модели
 *    повтор на них не тратится). Каждая правка пишет в лог, что поменяла;
 *  - `check(fullDoc, ctx)` — проверки портала поверх bft-lint.py: ERROR уходит
 *    модели на повтор (как ошибки линтера), WARN — в отчёт о качестве
 *    (deep.json) и в промт повтора, только если повтор и так нужен.
 *
 * Правила, специфичные для портала (принадлежность ссылки к sources.md, ID
 * скелета, тип задачи Jira, утечки), живут здесь, а не в общем bft-lint.py:
 * линтер разделён с навыком Claude Code и обязан пропускать эталон.
 *
 * Здесь только каркас и контекст; правки и правила добавляют следующие шаги
 * плана (C1, C2, C5, C6, C9, C10) — строкой в FIXES/RULES.
 */
import { baselineOf, presentState } from './present.js'
import { CANON_ID, columnOf, ID_RE, parseCanon, renderCanon, renderRow, sectionOf, type CanonRow, type CanonSection, type CanonTable, type ParsedCanon } from './canon-table.js'
import { contentTerms, hasTerm, PROPER, subjectNoun, words } from './stems.js'

export type Level = 'ERROR' | 'WARN'

/** Замечание проверки портала (в отличие от SourceFinding — находки разведки). */
export interface CheckFinding {
  code: string
  level: Level
  message: string
  /** Номер строки в документе (с 1), если известен. */
  line?: number
  section?: string
}

/** Строка «Критичных требований» bft-fast: ID → TOBE → цитата. */
export interface SkeletonRow { id: string; asis?: string; tobe: string; related: string[]; quote: string }

/** Находка разведки, разобранная из sources.md (формат findingsMarkdown плагина data-sources). */
export interface SourceFinding {
  kind: 'jira' | 'confluence'
  /** Ключ Jira или pageId Confluence (из ссылки); '' — не распознан. */
  id: string
  title: string
  url: string
  /** Готовая markdown-ссылка из строки «Ссылка для БФТ». */
  citation: string
  container?: string
  type?: string
  status?: string
  updated?: string
  /** Вердикт триажа (строка «Отношение к заявке», план C4). */
  relevance?: 'same_system' | 'same_function' | 'adjacent' | 'unrelated'
  /** Найдена вторым шагом (блок «Связанные (через …)»). */
  via?: string
  /** Факты триажа с дословной цитатой (строки «- факт — «цитата»» после «Факты …:»). */
  facts: { fact: string; quote: string }[]
  body: string
}

const RELEVANCE_OF: Record<string, NonNullable<SourceFinding['relevance']>> = {
  'та же система': 'same_system', 'та же функция': 'same_function', 'смежное': 'adjacent', 'не относится': 'unrelated',
}

/** Сколько находок триаж отсеял (хвост «Отсеяно триажем» в sources.md). */
export function droppedSources(sourcesMd: string): number {
  const start = sourcesMd.indexOf('\n## Отсеяно триажем')
  if (start < 0) return 0
  const tail = sourcesMd.slice(start + 1).split(/\n(?=## )/)[0]!
  return tail.split('\n').filter((l) => /^- /.test(l)).length
}

/** Что заказчик сказал при приёме (intake.json, план C1); всё необязательно. */
export interface Intake {
  asis?: string
  gap?: string
  tobe?: string
  glossary?: { term: string; meaning: string }[]
  openQuestions?: string[]
  unclear?: string[]
  links?: string[]
  [key: string]: unknown
}

/** primary.json — только поля, которые читают проверки (остальное — как есть). */
export interface PrimaryLike {
  args?: {
    want?: { what?: string; why?: string; quote?: string; asis?: string }
    metric?: { now?: string; target?: string; quote?: string }
    deadline?: { when?: string }
    requirements?: { text?: string; quote?: string; asis?: string }[]
    achievable?: { vision?: string; teams?: string[]; approvals?: string[]; questions?: string[] }
    openQuestions?: string[]
    people?: { name?: string; role?: string }[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface CheckContext {
  skeleton: SkeletonRow[]
  findings: SourceFinding[]
  intake?: Intake
  /**
   * primary.json заявки. Есть — значит документ портала: приём заявки шёл
   * перепиской (встречи и PO в ней нет), и правки происхождения утверждений
   * (риски, статусы, ASIS в «Проблеме») сверяются со словами заказчика.
   */
  primary?: PrimaryLike
  /** Канон эталона навыка (образец формы) — дословные фразы из него в документ не переносятся. */
  golden?: string
  /** Строка R3-якоря «Заказчик …, согласовано …, заявка #…» (план C6). */
  anchor?: string
  fastMd: string
  sourcesMd: string
  /** Замечания PO (ИИ-агент правок, ADR-0021): источник риска и статуса «Зависимостей» наравне со словами заказчика. */
  po?: string[]
}

const CRITICAL_HEAD = '### Критичные требования (скелет на цитатах)'

/** Скелет из bft-fast: таблица с колонкой «ID» в «Критичных требованиях». */
export function parseSkeleton(fastMd: string): SkeletonRow[] {
  const start = fastMd.indexOf(CRITICAL_HEAD)
  if (start < 0) return []
  const next = fastMd.indexOf('\n### ', start + CRITICAL_HEAD.length)
  const block = fastMd.slice(start, next < 0 ? undefined : next)
  const parsed = parseCanon(block)
  const table = parsed.sections.flatMap((s) => s.tables).find((t) => t.header[0]?.trim() === 'ID')
  if (!table) return []
  const col = (prefix: string) => table.header.findIndex((h) => h.toLowerCase().startsWith(prefix.toLowerCase()))
  const [asis, tobe, related, quote] = [col('ASIS'), col('TOBE'), col('Связанные'), col('Источник')]
  return table.rows.map((r) => ({
    id: r.cells[0] ?? '',
    ...(asis >= 0 && r.cells[asis] ? { asis: r.cells[asis] } : {}),
    tobe: tobe >= 0 ? r.cells[tobe] ?? '' : '',
    related: related >= 0 ? (r.cells[related] ?? '').split(/[,;\s]+/).filter(Boolean) : [],
    quote: quote >= 0 ? r.cells[quote] ?? '' : '',
  })).filter((r) => r.id)
}

/** Находки из sources.md: «## [KEY · ]заголовок», строка «где», «Ссылка для БФТ», тело. */
export function parseSources(sourcesMd: string): SourceFinding[] {
  const out: SourceFinding[] = []
  const blocks = sourcesMd.split(/\n(?=## )/).filter((b) => b.startsWith('## '))
  let via: string | undefined
  for (const block of blocks) {
    // Заголовки групп карты (без строки «Ссылка для БФТ»): «Связанные (через X)» — для следующих находок.
    const group = /^## Связанные \(через (.+)\)\s*$/m.exec(block.split('\n')[0]!)
    if (group) { via = group[1]; continue }
    if (/^## (Про ту же систему|Смежные и без вердикта|Отсеяно триажем)/.test(block)) { via = undefined; continue }
    const lines = block.split('\n')
    const heading = lines[0]!.slice(3).trim()
    const where = lines[1]?.trim() ?? ''
    const kind = /^Jira\b/.test(where) ? 'jira' : /^Confluence\b/.test(where) ? 'confluence' : undefined
    const linkLine = lines.find((l) => l.startsWith('Ссылка для БФТ:'))
    if (!kind || !linkLine) continue
    const citation = linkLine.slice('Ссылка для БФТ:'.length).trim()
    const url = /\]\(([^)\s]+)\)/.exec(citation)?.[1] ?? ''
    const parts = where.split(' · ').map((p) => p.trim())
    const date = parts.find((p) => /^\d{4}-\d{2}-\d{2}$/.test(p))
    const fields = parts.slice(1).filter((p) => p !== date)
    // Строка «Тип: … · Статус: …» (план C4) — точнее позиционных полей.
    const typeLine = lines.find((l) => /^Тип:/.test(l))
    const typeOf = typeLine ? /Тип:\s*([^·]+)/.exec(typeLine)?.[1]?.trim() : undefined
    const statusOf = typeLine ? /Статус:\s*([^·]+)/.exec(typeLine)?.[1]?.trim() : undefined
    const keyed = kind === 'jira' ? /^([A-Z][A-Z0-9_]+-\d+)\s+·\s+(.*)$/.exec(heading) : null
    const id = kind === 'jira' ? keyed?.[1] ?? /\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(url)?.[1] ?? '' : /pageId=(\d+)/.exec(url)?.[1] ?? ''
    const relevanceLine = lines.find((l) => l.startsWith('Отношение к заявке:'))
    const relevanceOf = relevanceLine ? RELEVANCE_OF[relevanceLine.slice('Отношение к заявке:'.length).trim()] : undefined
    const bodyStart = lines.indexOf(linkLine) + 1
    const factsAt = lines.findIndex((l) => /^Факты(?:\s|:).*:\s*$/.test(l))
    const facts: { fact: string; quote: string }[] = []
    for (let i = factsAt + 1; factsAt >= 0 && i < lines.length && /^- /.test(lines[i]!); i++) {
      const m = /^- (.+?) — «(.+)»\s*$/.exec(lines[i]!)
      if (m) facts.push({ fact: m[1]!.trim(), quote: m[2]!.trim() })
    }
    out.push({
      kind, id, title: keyed?.[2] ?? heading, url, citation,
      ...(fields[0] ? { container: fields[0] } : {}),
      ...((typeOf ?? fields[1]) ? { type: typeOf ?? fields[1] } : {}),
      ...((statusOf ?? (kind === 'jira' ? fields[2] : undefined)) ? { status: statusOf ?? fields[2] } : {}),
      ...(date ? { updated: date } : {}),
      ...(relevanceOf ? { relevance: relevanceOf } : {}),
      ...(via ? { via } : {}),
      facts,
      body: lines.slice(bodyStart).filter((l) => !/^Тип:/.test(l) && !/^→ /.test(l)).join('\n').trim(),
    })
  }
  return out
}

export function checkContext(input: { fastMd: string; sourcesMd?: string; intake?: Intake; anchor?: string; primary?: unknown; golden?: string; po?: string[] }): CheckContext {
  const sourcesMd = input.sourcesMd ?? ''
  return {
    skeleton: parseSkeleton(input.fastMd),
    findings: parseSources(sourcesMd),
    ...(input.intake ? { intake: input.intake } : {}),
    ...(input.primary && typeof input.primary === 'object' ? { primary: input.primary as PrimaryLike } : {}),
    ...(input.golden ? { golden: input.golden } : {}),
    ...(input.anchor ? { anchor: input.anchor } : {}),
    ...(input.po?.length ? { po: input.po } : {}),
    fastMd: input.fastMd,
    sourcesMd,
  }
}

/**
 * Правка канона: `rewrite` — по тексту (до разбора), `apply` — по таблицам
 * (меняет `parsed` на месте). Что сделала — в log.
 */
export interface Fix {
  name: string
  rewrite?(text: string, ctx: CheckContext, log: string[]): string
  apply?(parsed: ParsedCanon, ctx: CheckContext, log: string[]): void
}

const ASIS_PLACEHOLDER = /^(`?)\[ASIS не озвучен[^\]]*\]\1/

/**
 * C1: «[ASIS не озвучен] — …» с пояснением без ссылки на находку — догадка
 * модели о текущем процессе. Остаётся голый плейсхолдер; с markdown-ссылкой
 * (существующее решение по находке) — не трогаем.
 */
export const asisPlaceholderFix: Fix = {
  name: 'asis-placeholder',
  apply(parsed, _ctx, log) {
    for (const section of parsed.sections) {
      const problem = /^Проблема которую решаем/i.test(section.title)
      const ujm = /^Изменение в UJM/i.test(section.title)
      if (!problem && !ujm) continue
      for (const table of section.tables) {
        const col = ujm ? columnOf(table, 'Было') : 1
        if (col < 0) continue
        for (const row of table.rows) {
          if (problem && !/ASIS/.test(row.cells[0] ?? '')) continue
          const value = (row.cells[col] ?? '').trim()
          const m = ASIS_PLACEHOLDER.exec(value)
          if (!m || value === m[0]) continue
          if (/\]\((?:https?:|mailto:)/.test(value)) continue
          row.cells[col] = m[0]
          log.push(`${section.title}: ASIS «${value.slice(0, 80)}» → ${m[0]} (пояснение без источника)`)
        }
      }
    }
  },
}

// ── Общие помощники ────────────────────────────────────────────────────────

/** Строка требования — только с каноническим ID (как ID_RE bft-lint.py), иначе линтер её не видит. */
const TYPED_ID = CANON_ID
const TYPE_ORDER = ['БТ', 'ПТ', 'ИТ', 'ФТ', 'НФТ']
const idsIn = (text: string): string[] => text.match(ID_RE) ?? []
const idRank = (id: string) => { const [t, n] = id.split('-'); return TYPE_ORDER.indexOf(t!) * 100_000 + Number(n) }
/** Ячейка «Связанные» только из ID и разделителей — её можно пересобрать списком. */
const ONLY_IDS = /^[\s,;]*(?:(?<![А-ЯЁA-Za-z])(?:БТ|ПТ|ИТ|ФТ|НФТ)-\d+[\s,;]*)*$/
const MD_LINK = /\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g
const HTTP_LINK = /\]\(https?:\/\//
const CORP_URL = /\/browse\/[A-Z]|pageId=|\/display\/|\/pages\//
const JIRA_KEY_OF = (url: string) => /\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(url)?.[1]
const linkId = (url: string) => JIRA_KEY_OF(url) ?? /pageId=(\d+)/.exec(url)?.[1]
const BUG_TYPE = /ошибк|bug|баг|дефект/i
const CLOSED = /закрыт|заверш|closed|done|resolved|complete|решен|выполнен|готов|отмен|cancel|отклон|reject/i
const RATING = /^(?:высок|средн|низк)/i
/** «подтверждено PO …», но не «не подтверждены». */
const CONFIRMED = /(?<!не )подтвержд/i
const DASH_RANK = /^[—–-]$/
const ANCHORS_TITLE = 'Якоря истины'
const CANON_TITLE = 'Проблема которую решаем'
const CONTINUE_TITLE = 'Продолжить / уточнить БФТ'
const unmark = (s: string) => s.replace(/`/g, '').trim()

/** Строка типизированной таблицы (первая ячейка — ID требования). */
interface IdRow { id: string; section: string; table: CanonTable; cells: string[]; line: number; related: number }

function typedRows(sections: readonly CanonSection[]): IdRow[] {
  return sections.flatMap((s) => s.tables.flatMap((t) => {
    const related = columnOf(t, 'Связанные')
    return t.rows.filter((r) => TYPED_ID.test(r.cells[0] ?? '')).map((r) => ({ id: r.cells[0]!, section: s.title, table: t, cells: r.cells, line: r.line, related }))
  }))
}

/** Разделы канона: от «Проблемы которую решаем» до «Продолжить» (в документе целиком — без шапки и хвоста). */
function canonSections(parsed: ParsedCanon): CanonSection[] {
  const norm = (s: string) => s.replace(/\*+$/, '').trim()
  const start = parsed.sections.findIndex((s) => norm(s.title) === CANON_TITLE)
  const from = start < 0 ? parsed.sections.filter((s) => s.title) : parsed.sections.slice(start)
  const stop = from.findIndex((s) => norm(s.title) === CONTINUE_TITLE)
  return stop < 0 ? from : from.slice(0, stop)
}

const sectionLike = (sections: readonly CanonSection[], re: RegExp) => sections.find((s) => re.test(s.title))
const textOf = (parsed: ParsedCanon, s: CanonSection | undefined) => (s ? parsed.lines.slice(s.start, s.end).join('\n') : '')

/** How to demo из шапки fast: результат шага — после «→», иначе шаг целиком. */
export function demoResults(fastMd: string): string[] {
  const block = /### How to demo\s*\n([\s\S]*?)(?=\n### |\n## |$)/.exec(fastMd)?.[1] ?? ''
  return block.split('\n').map((l) => /^\s*\d+\.\s+(.*)$/.exec(l)?.[1]).filter((s): s is string => !!s)
    .map((s) => (s.includes('→') ? s.slice(s.lastIndexOf('→') + 1) : s).trim())
}

/** Основы слов (нижний регистр, от 4 букв, кириллица — первые 5). */
function stemSet(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length >= 4) out.add(/^[a-z0-9]+$/.test(w) ? w : w.slice(0, 5))
  }
  return out
}

/** Команды из строки «Команды: …» шапки fast (SMART A). */
export function teamsOf(fastMd: string): string[] {
  const teams = /Команды:\s*([^·|\n]+)/.exec(fastMd)?.[1] ?? ''
  return [...new Set(teams.split(/[,;]/).map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 2 && !/^\[?УТОЧНИТЬ/i.test(t)))]
}

/** Система из строки «Команды»: без пояснения в скобках и слова «Команда». */
const systemName = (team: string) => team.replace(/\([^)]*\)/g, ' ').replace(/^команд\p{L}*\s+/iu, '').replace(/\s+/g, ' ').trim()

// ── C6: якоря истины ────────────────────────────────────────────────────────

/** Дата согласования по Москве: DD.MM.YYYY; не разобралась — undefined. */
export function moscowDate(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * R3-якорь (план C6): «Заказчик {ФИО}, согласовано {DD.MM.YYYY}, заявка #{N}».
 * ФИО — персона с ролью «Заказчик», иначе первая названная; дата — согласование
 * fast (approval.json). Чего нет — [УТОЧНИТЬ] на месте значения.
 */
export function anchorLine(input: { people?: readonly { name?: string; role?: string }[]; approvedAt?: string; taskId?: string | number }): string {
  const people = (input.people ?? []).filter((p) => p?.name?.trim())
  const person = people.find((p) => /заказчик/i.test(p.role ?? '')) ?? people[0]
  const who = person?.name?.trim() || '[УТОЧНИТЬ: ФИО заказчика]'
  const date = moscowDate(input.approvedAt) ?? '[УТОЧНИТЬ: дата согласования]'
  const task = input.taskId !== undefined && String(input.taskId).trim() ? `#${input.taskId}` : '[УТОЧНИТЬ: номер заявки]'
  return `Заказчик ${who}, согласовано ${date}, заявка ${task}`.replace(/\|/g, '/').replace(/\s+/g, ' ')
}

/** Цитата скелета без подписи «Заказчик:» (её даёт якорь), в «…». */
function quoteText(quote: string): string {
  const q = quote.replace(/^\s*Заказчик[^:«]{0,40}:\s*/i, '').trim()
  if (!q || /^\[?УТОЧНИТЬ/i.test(q)) return ''
  return q.includes('«') ? q : `«${q.replace(/^["“]|["”]$/g, '')}»`
}

/** Строка «Якорей», которую собирает код: R3 по умолчанию; ранг «—» — вопрос об источнике. */
export interface AnchorRow { fact: string; source: string; rank?: string; type?: string }

/**
 * Строки R3, которые собирает код: ID скелета с одной цитатой — одной строкой;
 * плюс сценарий приёмки. Факт — «Наименование требования» строки канона
 * (`names`: ID → наименование), иначе TOBE скелета; каждый ID — один раз.
 * Код только переносит цитату заказчика к ID, за которым она закреплена в
 * скелете (раунд 6): соответствие по словам не подбирается, строки без
 * источника не сочиняются — их пишет модель (ранг «—» и [УТОЧНИТЬ]), а смысл
 * ID скелета держит проверка SK002. ID, чей смысл в каноне уплыл (`drifted`),
 * цитату не получает: факт — TOBE скелета без ID.
 */
export function anchorRows(ctx: Pick<CheckContext, 'skeleton' | 'anchor' | 'fastMd'>, names: ReadonlyMap<string, string> = new Map(), drifted: ReadonlySet<string> = new Set()): AnchorRow[] {
  if (!ctx.anchor) return []
  const groups = new Map<string, { quote: string; items: string[] }>()
  const seen = new Set<string>()
  for (const row of ctx.skeleton) {
    const quote = quoteText(row.quote)
    if (!quote || seen.has(row.id)) continue
    seen.add(row.id)
    const own = !drifted.has(row.id)
    const fact = ((own ? names.get(row.id) : undefined) ?? row.tobe).replace(/\|/g, '/').trim()
    if (!fact) continue
    const key = quote.toLowerCase().replace(/\s+/g, ' ')
    if (!groups.has(key)) groups.set(key, { quote, items: [] })
    groups.get(key)!.items.push(own ? `${fact} (${row.id})` : fact)
  }
  const out: AnchorRow[] = [...groups.values()].map((g) => ({ fact: g.items.join('; '), source: `${ctx.anchor}: ${g.quote}` }))
  if (demoResults(ctx.fastMd).length) out.push({ fact: 'Сценарий приёмки (How to demo)', source: ctx.anchor })
  return out
}

/**
 * R3-строка модели по шагу How to demo: источник — «{R3-якорь}: сценарий
 * приёмки, шаг N — «…»», шаг N есть в How to demo. Такие строки — слова
 * заказчика (согласованный сценарий), их пишет модель для требований, которые
 * шаг описывает; код только проверяет форму.
 */
function demoStepAnchor(source: string, ctx: Pick<CheckContext, 'anchor' | 'fastMd'>): boolean {
  if (!ctx.anchor || !source.includes(ctx.anchor)) return false
  const n = /сценари\p{L}*\s+при[её]мки,?\s+шаг\s+(\d+)/iu.exec(source)?.[1]
  return !!n && demoSteps(ctx.fastMd).some((st) => st.n === Number(n))
}

/** Аббревиатуры и короткие имена систем (1С, ЗУП): основы от четырёх букв их не видят. */
function acronymsOf(text: string): string[] {
  return (text.replace(/\]\([^)]*\)/g, ']').match(/(?<![\p{L}\p{N}])[\p{Lu}\p{N}]{2,6}(?![\p{L}\p{N}])/gu) ?? [])
    .filter((t) => /\p{Lu}/u.test(t) && !SYS_STOP.has(t)).map((t) => t.toLowerCase().replace(/ё/g, 'е'))
}

/** Различающие основы текста: без слов названия заявки и маркеров, плюс аббревиатуры. */
function distinctStems(text: string, subject: ReadonlySet<string>): Set<string> {
  const clean = text.replace(MARKER, ' ')
  const out = new Set([...contentStems(clean)].filter((x) => !inSubject(x, subject)))
  for (const a of acronymsOf(clean)) if (!subject.has(a)) out.add(a)
  return out
}

const ANCHOR_HEADER = ['Факт в БФТ', 'Источник (якорь)', 'Ранг', 'Тип']

/** Ссылка строки ведёт на находку без вердикта «та же система/функция/смежное» (или найденную вторым шагом). */
function offTopicLink(text: string, findings: readonly SourceFinding[]): boolean {
  if (!findings.some((f) => f.relevance)) return false
  return [...text.matchAll(MD_LINK)].some((m) => { const f = findingOf(m[2]!, findings); return !!f && ((!isSame(f) && f.relevance !== 'adjacent') || !!f.via) })
}

/**
 * C6: «Якоря истины». Код удаляет строки, которые якорем не являются
 * (нерелевантные, ранг «—» без [УТОЧНИТЬ], карта контекста и скелет fast
 * без ссылки, R2 без ссылки, R3 от модели), ставит «Тип» R2 по ссылке и —
 * если известен R3-якорь — вставляет строки R3 из скелета первыми.
 */
export const anchorsFix: Fix = {
  name: 'anchors',
  rewrite(text, ctx, log) {
    if (!ctx.anchor) return text
    const parsed = parseCanon(text)
    const section = sectionOf(parsed, ANCHORS_TITLE)
    if (!section || section.tables.length) return text
    const lines = [...parsed.lines]
    let at = section.end
    while (at > section.start + 1 && !lines[at - 1]!.trim()) at--
    lines.splice(at, 0, '', renderRow(ANCHOR_HEADER), `| ${ANCHOR_HEADER.map(() => '---').join(' | ')} |`)
    log.push(`${ANCHORS_TITLE}: таблицы не было — добавлена`)
    return lines.join('\n')
  },
  apply(parsed, ctx, log) {
    const section = sectionOf(parsed, ANCHORS_TITLE)
    const table = section?.tables.find((t) => columnOf(t, 'Ранг') >= 0) ?? section?.tables[0]
    if (!table) return
    const pick = (prefix: string, fallback: number) => { const c = columnOf(table, prefix); return c >= 0 ? c : fallback }
    const col = { fact: pick('Факт', 0), src: columnOf(table, 'Источник') >= 0 ? columnOf(table, 'Источник') : pick('Якорь', 1), rank: pick('Ранг', 2), type: pick('Тип', 3) }
    const before = table.rows.map((r) => r.cells.join('|')).join('\n')
    const names = new Map<string, string>()
    for (const r of typedRows(canonSections(parsed))) {
      const c = columnOf(r.table, 'Наименование')
      if (c >= 0 && r.cells[c]?.trim() && !names.has(r.id)) names.set(r.id, unmark(r.cells[c]!))
    }
    const drifted = new Set(skeletonDrift(parsed, ctx).map((d) => d.id))
    const generated = anchorRows(ctx, names, drifted).map((g) => {
      const cells = Array.from({ length: table.header.length }, () => '')
      cells[col.fact] = g.fact
      cells[col.src] = g.source
      cells[col.rank] = g.rank ?? 'R3'
      cells[col.type] = g.type ?? 'Решение заказчика'
      return { cells, line: -1 }
    })
    const sig = (cells: string[]) => cells.join('|')
    const own = new Set(generated.map((g) => sig(g.cells)))
    const seenRows = new Set<string>()
    // R2 — только находки, на которые опирается текст БФТ: строка про находку, которой в тексте нет, — не якорь.
    const bodyText = canonSections(parsed).filter((s) => s.title.replace(/\*+$/, '').trim() !== ANCHORS_TITLE).map((s) => textOf(parsed, s)).join('\n')
    const uncitedInBody = (rowText: string) => {
      const linked = [...rowText.matchAll(MD_LINK)].map((m) => findingOf(m[2]!, ctx.findings)).filter((f): f is SourceFinding => !!f)
      // Смежная находка (вердикт триажа) в текст БФТ не переносится — её место только здесь, строкой R2.
      return linked.length > 0 && linked.every((f) => f.relevance !== 'adjacent' && !mentions(bodyText, f) && !(f.kind === 'jira' && f.id && bodyText.includes(f.id)))
    }
    const kept = table.rows.filter((row) => {
      if (seenRows.has(sig(row.cells))) { log.push(`${ANCHORS_TITLE}: повтор строки «${(row.cells[col.fact] ?? '').slice(0, 60)}» удалён`); return false }
      seenRows.add(sig(row.cells))
      const all = row.cells.join(' ')
      const rank = unmark(row.cells[col.rank] ?? '')
      const type = row.cells[col.type] ?? ''
      const src = row.cells[col.src] ?? ''
      const reason = /не\s+релевант/i.test(all) ? 'нерелевантная находка'
        : DASH_RANK.test(rank) && !type.includes('[УТОЧНИТЬ') ? 'ранг «—» без [УТОЧНИТЬ]'
        : /карт[аеуы]\s+контекста|кортекс|критичн\p{L}*\s+требовани/iu.test(src) && !HTTP_LINK.test(all) ? 'источник — карта контекста или скелет fast'
        : rank === 'R2' && !HTTP_LINK.test(all) ? 'R2 без ссылки'
        : ctx.anchor && rank === 'R3' && !own.has(sig(row.cells)) && !demoStepAnchor(src, ctx) ? 'R3 собирает система (модель — только по шагу How to demo)'
        : rank === 'R2' && offTopicLink(all, ctx.findings) ? 'находка без вердикта триажа, «не относится» или найдена вторым шагом'
        : rank === 'R2' && uncitedInBody(all) ? 'факт находки не использован в тексте БФТ'
        : undefined
      if (reason) log.push(`${ANCHORS_TITLE}: строка «${(row.cells[col.fact] ?? '').slice(0, 60)}» удалена — ${reason}`)
      return !reason
    })
    for (const row of kept) {
      if (unmark(row.cells[col.rank] ?? '') !== 'R2') continue
      const url = [...(row.cells[col.src] ?? row.cells.join(' ')).matchAll(MD_LINK)].map((m) => m[2]!)[0] ?? [...row.cells.join(' ').matchAll(MD_LINK)].map((m) => m[2]!)[0] ?? ''
      const kind = JIRA_KEY_OF(url) ? 'Jira' : /pageId=|\/display\/|\/pages\//.test(url) ? 'Confluence' : undefined
      if (kind && unmark(row.cells[col.type] ?? '') !== kind) {
        row.cells[col.type] = kind
        log.push(`${ANCHORS_TITLE}: тип R2 «${(row.cells[col.fact] ?? '').slice(0, 40)}» → ${kind}`)
      }
    }
    // Строки R2 пишет модель (раунд 6): код их не сочиняет, пропуск ловит WARN AN101.
    if (!generated.length) { table.rows = kept; return }
    const rest = kept.filter((r) => !own.has(sig(r.cells)))
    const rankOf = (r: CanonRow) => unmark(r.cells[col.rank] ?? '')
    table.rows = [...generated, ...rest.filter((r) => rankOf(r) === 'R3'), ...rest.filter((r) => rankOf(r) === 'R2'), ...rest.filter((r) => rankOf(r) !== 'R2' && rankOf(r) !== 'R3')]
    const after = table.rows.map((r) => sig(r.cells)).join('\n')
    if (after !== before) log.push(`${ANCHORS_TITLE}: строки R3 по ID скелета собраны кодом — ${generated.length}`)
  },
}

/** C6: id узлов Кортекса в бэктиках (`sys-…`, `person-…`) — внутренние идентификаторы; обёртка снимается. */
export const cortexIdsFix: Fix = {
  name: 'cortex-ids',
  rewrite(text, _ctx, log) {
    let n = 0
    const out = text.split(/(^\s*```[\s\S]*?^\s*```)/m).map((part, i) => (i % 2 ? part
      : part.replace(/`((?:sys|person|init|team|segment)-[\p{L}\p{N}_.-]+)`/gu, (_m, id: string) => { n++; return id }))).join('')
    if (n) log.push(`id узлов карты контекста без обёртки: ${n}`)
    return out
  },
}

// ── C5: ссылки в ячейке, риски ─────────────────────────────────────────────

/**
 * Ссылка на один URL в ячейке — один раз: повтор — текстом ключа (Jira — в
 * `код`, чтобы не стать голым ключом LN001) или подписью; хвост «: [ссылка]»
 * на уже названный URL — убирается.
 */
export function dedupLinks(cell: string): string {
  const seen = new Set<string>()
  return cell.replace(/(\s*[:—–]\s*)?\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, (match, sep: string | undefined, label: string, url: string, offset: number, whole: string) => {
    if (!seen.has(url)) { seen.add(url); return match }
    const tail = whole.slice(offset + match.length).replace(/[\s.;,)]+$/, '')
    if (sep && !tail) return ''
    const key = JIRA_KEY_OF(url)
    return `${sep ?? ''}${key ? `\`${key}\`` : label}`
  })
}

export const citationDedupFix: Fix = {
  name: 'citation-dedup',
  apply(parsed, _ctx, log) {
    for (const section of parsed.sections) {
      for (const table of section.tables) {
        for (const row of table.rows) {
          row.cells = row.cells.map((cell, i) => {
            const next = cell.includes('](http') ? dedupLinks(cell) : cell
            if (next !== cell) log.push(`${section.title}: повтор ссылки в ячейке «${(row.cells[0] ?? '').slice(0, 40)}» (колонка ${i + 1}) убран`)
            return next
          })
        }
      }
    }
  },
}

/**
 * C5: оценка риска без источника — «Вероятность»/«Влияние» называет только
 * заказчик или PO («подтверждено …») или находка со ссылкой; иначе
 * [УТОЧНИТЬ у PO] (гейт bft-lint RK002 — без траты повтора).
 */
export const riskRatingFix: Fix = {
  name: 'risk-rating',
  apply(parsed, _ctx, log) {
    const section = sectionOf(parsed, 'Риски')
    for (const table of section?.tables ?? []) {
      const cols = [columnOf(table, 'Вероятность'), columnOf(table, 'Влияние')].filter((c) => c >= 0)
      for (const row of table.rows) {
        const all = row.cells.join(' ')
        if (CONFIRMED.test(all) || HTTP_LINK.test(all)) continue
        for (const c of cols) {
          if (!RATING.test(unmark(row.cells[c] ?? ''))) continue
          log.push(`Риски: «${(row.cells[0] ?? '').slice(0, 50)}» — оценка «${row.cells[c]}» без источника → [УТОЧНИТЬ у PO]`)
          row.cells[c] = '[УТОЧНИТЬ у PO]'
        }
      }
    }
  },
}

// ── C2: граф трассировки ───────────────────────────────────────────────────

/**
 * C2: «Связанные требования» указывают вверх. Ссылки на несуществующие ID
 * удаляются; строке без пути к БТ дописывается единственный БТ; в ячейку БТ
 * — все ID, которые на него ссылаются. Взаимность для остальных типов не
 * навязывается.
 */
export const linkGraphFix: Fix = {
  name: 'link-graph',
  apply(parsed, _ctx, log) {
    const rows = typedRows(canonSections(parsed))
    const defined = new Set(rows.map((r) => r.id))
    const byId = new Map<string, IdRow>()
    for (const r of rows) if (!byId.has(r.id)) byId.set(r.id, r)
    for (const row of rows) {
      if (row.related < 0) continue
      const cell = row.cells[row.related] ?? ''
      const bad = idsIn(cell).filter((id) => !defined.has(id))
      if (!bad.length) continue
      let next = cell
      if (ONLY_IDS.test(cell)) next = idsIn(cell).filter((id) => defined.has(id)).join(', ')
      else for (const id of bad) next = next.replace(new RegExp(`(?:[,;]\\s*)?(?<![А-ЯЁA-Za-z])${id}(?!\\d)`), '').replace(/^\s*[,;]\s*/, '').trim()
      row.cells[row.related] = next
      log.push(`${row.section}: ${row.id} — убраны ссылки на несуществующие ${bad.join(', ')}`)
    }
    const refsOf = (row: IdRow) => (row.related >= 0 ? idsIn(row.cells[row.related] ?? '').filter((id) => defined.has(id)) : [])
    /** БТ, до которых доходит строка по «Связанным» (вверх по графу), в порядке обхода. */
    const btsOf = (from: IdRow): string[] => {
      const seen = new Set<string>([from.id])
      const queue = refsOf(from)
      const out: string[] = []
      while (queue.length) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        if (id.startsWith('БТ-')) { out.push(id); continue }
        const next = byId.get(id)
        if (next) queue.push(...refsOf(next))
      }
      return out
    }
    const bts = [...byId.values()].filter((r) => r.id.startsWith('БТ-'))
    const btStems = new Map(bts.map((b) => [b.id, contentStems(b.cells.filter((_, i) => i !== 0 && i !== b.related).join(' '))]))
    /** Ближайший по словам БТ (несколько БТ, пути нет). */
    const closestBt = (row: IdRow) => {
      const own = contentStems(row.cells.filter((_, i) => i !== 0 && i !== row.related).join(' '))
      return [...bts].sort((a, b) => shareIn(btStems.get(b.id)!, own) - shareIn(btStems.get(a.id)!, own))[0]!.id
    }
    // ПТ и ФТ ссылаются на БТ напрямую; остальные (ИТ, НФТ) — хотя бы через цепочку.
    if (bts.length) {
      for (const row of rows) {
        if (row.id.startsWith('БТ-') || row.related < 0) continue
        const direct = refsOf(row).some((id) => id.startsWith('БТ-'))
        const needDirect = /^(?:ПТ|ФТ)-/.test(row.id)
        const reached = btsOf(row)
        if (direct || (!needDirect && reached.length)) continue
        const bt = reached[0] ?? (bts.length === 1 ? bts[0]!.id : closestBt(row))
        const cell = (row.cells[row.related] ?? '').trim()
        row.cells[row.related] = ONLY_IDS.test(cell) ? [...new Set([bt, ...idsIn(cell)])].sort((a, b) => idRank(a) - idRank(b)).join(', ') : cell ? `${cell}, ${bt}` : bt
        log.push(`${row.section}: ${row.id} — нет ${needDirect ? 'прямой ссылки' : 'пути'} к БТ, добавлен ${bt}`)
      }
    }
    // Каскад вверх (раунд 5, TR002): ИТ — к ПТ, НФТ — к ФТ/ПТ; цель — ближайшая по словам строка нужного типа.
    const closest = (row: IdRow, prefixes: readonly string[]) => {
      const own = contentStems(row.cells.filter((_, i) => i !== 0 && i !== row.related).join(' '))
      const pool = rows.filter((r) => prefixes.some((p) => r.id.startsWith(p)))
      return pool.map((r) => ({ id: r.id, score: shareIn(own, contentStems(r.cells.filter((_, i) => i !== 0 && i !== r.related).join(' '))) }))
        .sort((a, b) => b.score - a.score || idRank(a.id) - idRank(b.id))[0]?.id
    }
    for (const row of rows) {
      if (row.related < 0) continue
      const prefixes = row.id.startsWith('ИТ-') ? ['ПТ-'] : row.id.startsWith('НФТ-') ? ['ФТ-', 'ПТ-'] : []
      if (!prefixes.length || refsOf(row).some((id) => prefixes.some((p) => id.startsWith(p)))) continue
      const target = closest(row, prefixes)
      if (!target) continue
      const cell = (row.cells[row.related] ?? '').trim()
      row.cells[row.related] = ONLY_IDS.test(cell) ? [...new Set([...idsIn(cell), target])].sort((a, b) => idRank(a) - idRank(b)).join(', ') : cell ? `${cell}, ${target}` : target
      log.push(`${row.section}: ${row.id} — нет связи вверх (${prefixes.join('/')}), добавлен ${target}`)
    }
    // «Связанные» БТ — пересчёт после всех правок (linkGraph идёт после удалений и добавлений строк): все, кто ссылается на него.
    for (const bt of bts) {
      if (bt.related < 0) continue
      const current = refsOf(bt)
      const missing = rows.filter((r) => r.id !== bt.id && refsOf(r).includes(bt.id) && !current.includes(r.id)).map((r) => r.id)
      const unique = [...new Set(missing)]
      if (!unique.length) continue
      const cell = bt.cells[bt.related] ?? ''
      bt.cells[bt.related] = ONLY_IDS.test(cell)
        ? [...new Set([...current, ...unique])].sort((a, b) => idRank(a) - idRank(b)).join(', ')
        : `${cell.trim()}${cell.trim() ? ', ' : ''}${unique.join(', ')}`
      log.push(`${bt.section}: ${bt.id} — добавлены ссылающиеся ${unique.join(', ')}`)
    }
  },
}

// ── C9: адресат маркера ────────────────────────────────────────────────────

const BARE_MARKER = /`?\[УТОЧНИТЬ\]`?/g
const teamKey = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\([^)]*\)/g, ' ').replace(/\bкоманд\p{L}*/gu, ' ').replace(/[^\p{L}\p{N}:]+/gu, ' ').trim()

/**
 * C9: голый [УТОЧНИТЬ] в строке «Зависимостей», чья первая ячейка — команда
 * из «Команд» шапки, адресуется этой команде. Голые маркеры ФТ/НФТ/ИТ — WARN
 * (UT001), их код не трогает.
 */
export const dependencyAddresseeFix: Fix = {
  name: 'dependency-addressee',
  apply(parsed, ctx, log) {
    const teams = teamsOf(ctx.fastMd).map((t) => ({ name: t, key: teamKey(t) })).filter((t) => t.key.length >= 3)
    if (!teams.length) return
    for (const table of sectionOf(parsed, 'Зависимости')?.tables ?? []) {
      for (const row of table.rows) {
        const first = teamKey(row.cells[0] ?? '')
        if (!first) continue
        // Точное совпадение важнее вхождения: «MarketA BE» — не команда «BE».
        const team = teams.find((t) => first === t.key) ?? teams.find((t) => first.length >= 3 && (first.includes(t.key) || t.key.includes(first)))
        if (!team) continue
        // «Команда портала» → «команды портала»; имя без слова «команда» — в кавычках («команды «Каталог»»).
        const who = /^команд\p{L}*\s+/iu.test(team.name) ? team.name.replace(/^команд\p{L}*\s+/iu, 'команды ') : `команды «${team.name}»`
        for (let i = 1; i < row.cells.length; i++) {
          const cell = row.cells[i] ?? ''
          const next = cell.replace(BARE_MARKER, `[УТОЧНИТЬ у ${who}]`)
          if (next === cell) continue
          row.cells[i] = next
          log.push(`Зависимости: «${row.cells[0]}» — маркер адресован ${who}`)
        }
      }
    }
  },
}

// ── C10: приоритет ─────────────────────────────────────────────────────────

/**
 * C10: голый Высокий/Средний/Низкий у ФТ — «(предварительно)», если в
 * bft-fast заказчик приоритет не задавал (нет поля или колонки «Приоритет»).
 */
export const priorityFix: Fix = {
  name: 'priority',
  apply(parsed, ctx, log) {
    if (/Приоритет/i.test(ctx.fastMd)) return
    for (const table of sectionOf(parsed, 'Функциональные требования')?.tables ?? []) {
      const col = columnOf(table, 'Приоритет')
      if (col < 0) continue
      for (const row of table.rows) {
        const value = (row.cells[col] ?? '').trim()
        if (!/^(?:Высокий|Средний|Низкий)$/i.test(value)) continue
        row.cells[col] = `${value} (предварительно)`
        log.push(`Функциональные требования: ${row.cells[0]} — приоритет «${value}» без источника → «(предварительно)»`)
      }
    }
  },
}

// ── Раунд 2: происхождение утверждений, существующее решение, покрытие ─────

/** Документ портала: есть primary.json (приём — переписка, без встречи и без PO). */
const portal = (ctx: CheckContext) => !!ctx.primary

/** Все строки значения (рекурсивно): слова заказчика из primary.json/intake.json. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') { if (value.trim()) out.push(value) }
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out)
  return out
}

/** Пункты «Согласования», «Проработать» и открытые вопросы приёма — не риски, а зависимости/маркеры. */
export function workItems(ctx: Pick<CheckContext, 'primary' | 'intake'>): string[] {
  const a = ctx.primary?.args
  return [...(a?.achievable?.approvals ?? []), ...(a?.achievable?.questions ?? []), ...(a?.openQuestions ?? []), ...(ctx.intake?.openQuestions ?? [])]
    .filter((s): s is string => typeof s === 'string' && !!s.trim())
}

/** Что заказчик сказал как факт (primary.json и intake.json без пунктов работы и допущений ассистента). */
function customerStrings(ctx: Pick<CheckContext, 'primary' | 'intake'>): string[] {
  const items = new Set(workItems(ctx))
  const intake = ctx.intake ? { asis: ctx.intake.asis, gap: ctx.intake.gap, tobe: ctx.intake.tobe, glossary: ctx.intake.glossary } : undefined
  return [...allStrings(ctx.primary?.args), ...allStrings(intake)].filter((s) => !items.has(s))
}

const OVERLAP_STOP = new Set(['котор', 'чтобы', 'когда', 'после', 'перед', 'через', 'также', 'может', 'нужно', 'будет', 'этого', 'всех', 'есть', 'более', 'менее'])
/** Основы для сравнения формулировок (без служебных). */
export function contentStems(text: string): Set<string> {
  return new Set([...stemSet(text.replace(/\]\([^)]*\)/g, ']'))].filter((s) => !OVERLAP_STOP.has(s) && !/^\d+$/.test(s)))
}
/** Доля основ `a`, найденных в `b`. */
function shareIn(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size) return 0
  let n = 0
  for (const s of a) if (b.has(s)) n++
  return n / a.size
}
/** Сходство двух формулировок: большая из долей пересечения основ. */
export function similarity(x: string, y: string): number {
  const [a, b] = [contentStems(x), contentStems(y)]
  return Math.max(shareIn(a, b), shareIn(b, a))
}

const isSame = (f: SourceFinding) => f.relevance === 'same_function' || f.relevance === 'same_system'
const isBug = (f: SourceFinding) => BUG_TYPE.test(f.type ?? '')
const isClosed = (f: SourceFinding) => CLOSED.test(f.status ?? '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Цитирует ли текст находку (по адресу, ключу Jira или pageId). */
export function cites(text: string, f: SourceFinding): boolean {
  if (f.url && text.includes(f.url)) return true
  if (!f.id) return false
  return f.kind === 'jira' ? new RegExp(`(?<![\\w-])${escapeRe(f.id)}(?![\\w])`).test(text) : text.includes(`pageId=${f.id}`)
}

/** Текст называет находку: ссылкой, ключом или pageId (cites) либо подписью без ссылки — «название» или `ключ` (после citationOnce). */
export function mentions(text: string, f: SourceFinding): boolean {
  return cites(text, f) || (f.title.length >= 8 && text.includes(`«${f.title.trim()}»`))
}

/** Находка по адресу ссылки из канона. */
function findingOf(url: string, findings: readonly SourceFinding[]): SourceFinding | undefined {
  const id = linkId(url)
  return findings.find((f) => (!!f.url && f.url === url) || (!!id && f.id === id))
}

/**
 * Существующее или проектируемое решение того же действия (раунд 3): находка
 * триажа «та же функция», не ошибка, найдена первым шагом, и это описание
 * решения — страница вики или закрытая задача Jira. Открытые эпик, история,
 * задача — параллельная работа («Зависимости»), «та же система» — не то же
 * действие. Порядок — ранг карты. Одна функция для автоправок, CT004 и
 * метрики existing_solution_unsurfaced.
 */
export const isExisting = (f: SourceFinding) => f.relevance === 'same_function' && !isBug(f) && !f.via && (f.kind === 'confluence' || isClosed(f))

export function existingSolutions(findings: readonly SourceFinding[]): SourceFinding[] {
  return findings.filter(isExisting)
}

/** Открытая задача Jira (эпик, история, задача — не ошибка) — параллельная работа. */
const isOpenWork = (f: SourceFinding) => f.kind === 'jira' && !isBug(f) && !isClosed(f)

/** Существующие решения, которых канон не цитирует нигде. */
export function unsurfacedExisting(canon: string, findings: readonly SourceFinding[]): SourceFinding[] {
  return existingSolutions(findings).filter((f) => !cites(canon, f))
}

/** Работающее решение: так сказано в тексте находки (внедрено, в эксплуатации, работает). */
const OPERATING_TEXT = /(?<![\p{L}])(?:внедрен\p{L}*|внедрил\p{L}*|в\s+эксплуатаци\p{L}*|запущен\p{L}*|работает|работают|в\s+продуктив\p{L}*|в\s+проде|на\s+проде)(?![\p{L}])/iu
/** Закрытая задача Jira как сделанная работа (не «отменена»/«отклонена»). */
const DONE = /закрыт|заверш|done|closed|resolved|complete|решен|выполн|готов/i
const CANCELLED = /отмен|cancel|отклон|reject|won.?t/i

/**
 * Зрелость решения по находке (раунд 4) — только как сказано в источнике:
 * работает, если это говорит её текст или факт (внедрено, в эксплуатации…)
 * либо задача Jira закрыта как сделанная; иначе — «описано», со статусом из
 * карты (Jira) или «не указан». Страница требований — не работающее решение.
 */
export function maturityOf(f: SourceFinding): { operating: boolean; status: string } {
  const text = [f.title, ...f.facts.map((x) => `${x.fact} ${x.quote}`), f.body].join('\n')
  const said = OPERATING_TEXT.exec(text)?.[0]
  const done = f.kind === 'jira' && !!f.status && DONE.test(f.status) && !CANCELLED.test(f.status)
  return { operating: !!said || done, status: f.status?.trim() || (said ? said.toLowerCase() : 'не указан') }
}

/** Как назвать решение по находке: «существующее решение {ссылка}» или «решение, описанное в {ссылка} (статус в источнике: …)». */
export function solutionPhrase(f: SourceFinding, citation = f.citation): string {
  const m = maturityOf(f)
  return m.operating ? `существующее решение ${citation}` : `решение, описанное в ${citation} (статус в источнике: ${m.status})`
}

/**
 * Ссылка в «Рисках» допустима: находка той же системы/функции, первым шагом,
 * не закрытая ошибка. Карта без триажа (ни одного вердикта — триаж упал или
 * старая карта) вердиктом не судится: проходит любая находка первого шага.
 */
const riskWorthy = (f: SourceFinding, findings: readonly SourceFinding[]) => {
  if (f.via) return false
  if (!f.relevance) return !findings.some((x) => x.relevance)
  return isBug(f) ? isSame(f) && !isClosed(f) : isExisting(f)
}
/** Почему ссылка в «Рисках» не основание (для лога и CT005). */
const riskWhy = (f: SourceFinding) => f.via ? 'найдена вторым шагом'
  : isBug(f) ? (isClosed(f) ? 'закрытая ошибка' : f.relevance ?? 'без вердикта')
  : f.relevance === 'same_system' ? 'та же система, но не решение того же действия'
  : f.relevance === 'same_function' ? 'открытая задача — параллельная работа' : f.relevance ?? 'без вердикта'

const workItemOf = (name: string, items: readonly string[]) => items.find((it) => similarity(name, it) >= 0.5)
const saidRisk = (name: string, said: readonly string[]) => said.some((s) => shareIn(contentStems(name), contentStems(s)) >= 0.6)

const RISK_HEADER = ['Риск', 'Вероятность', 'Влияние', 'Митигация']
const NO_RISKS = 'Риски заказчиком не названы.'
const separatorOf = (header: readonly string[]) => `| ${header.map(() => '---').join(' | ')} |`

/**
 * «Риски» — код только чистит (раунд 6: содержание пишет модель):
 *  - ссылка на находку, которая не основание риска (смежная, вторым шагом,
 *    закрытая ошибка, «та же система», открытая задача), — ключ в `код`
 *    (CT005); куда её деть, говорит модели вердикт в карте находок;
 *  - строка, повторяющая «Согласования»/«Проработать»/вопрос приёма, —
 *    удаляется (место пункта — «Зависимости», пропуск ловит WARN DP001);
 *  - строка без ссылки на находку и без слов заказчика — удаляется (RK003);
 *  - «Митигация» без источника — [УТОЧНИТЬ у PO: …?];
 *  - проза раздела не сохраняется: таблица или ровно «Риски заказчиком не названы.».
 * Строки «Пересечение с решением» и «Открытая ошибка» код не сочиняет: их
 * пропуск — CT003/CT004 модели на повтор.
 * Правила «слов заказчика» и прозы — только для документа портала (есть primary.json).
 */
export const risksFix: Fix = {
  name: 'risks',
  rewrite(text, ctx, log) {
    const parsed = parseCanon(text)
    const section = sectionOf(parsed, 'Риски')
    if (!section) return text
    const isPortal = portal(ctx)
    const table = section.tables[0]
    const header = table?.header ?? RISK_HEADER
    const fake = { header } as CanonTable
    const [pCol, iCol, mCol] = [columnOf(fake, 'Вероятность'), columnOf(fake, 'Влияние'), columnOf(fake, 'Митигац')]
    const items = workItems(ctx)
    const said = [...customerStrings(ctx), ...(ctx.po ?? [])]
    const rows: string[][] = []
    let changed = false
    for (const row of table?.rows ?? []) {
      const cells = [...row.cells]
      const name = unmark(cells[0] ?? '')
      let good = false
      for (let c = 0; c < cells.length; c++) {
        if (c === pCol || c === iCol) continue
        cells[c] = (cells[c] ?? '').replace(MD_LINK, (raw, label: string, url: string) => {
          const f = findingOf(url, ctx.findings)
          if (!f) return raw
          if (riskWorthy(f, ctx.findings)) { good = true; return raw }
          changed = true
          log.push(`Риски: ссылка на ${f.id || label} убрана — не основание риска (${riskWhy(f)})`)
          return `\`${f.kind === 'jira' && f.id ? f.id : label.replace(/^Confluence:\s*/, '')}\``
        })
      }
      if (!good && isPortal) {
        if (workItemOf(name, items)) {
          changed = true
          log.push(`Риски: «${name.slice(0, 60)}» удалён — пункт согласования/проработки, его место — «Зависимости»`)
          continue
        }
        if (!saidRisk(name, said)) {
          changed = true
          log.push(`Риски: «${name.slice(0, 60)}» удалён — ни ссылки на находку, ни слов заказчика`)
          continue
        }
      }
      if (isPortal && mCol >= 0) {
        const m = cells[mCol] ?? ''
        const sourced = /\[УТОЧНИТЬ/.test(m) || HTTP_LINK.test(m) || said.some((s) => similarity(m, s) >= 0.6)
          || ctx.findings.some((f) => cites(cells.join(' '), f) && f.facts.some((x) => similarity(m, `${x.fact} ${x.quote}`) >= 0.6))
        if (m.trim() && !sourced) {
          cells[mCol] = '[УТОЧНИТЬ у PO: как снижаем риск?]'
          changed = true
          log.push(`Риски: «${name.slice(0, 50)}» — митигация «${m.slice(0, 50)}» без источника → [УТОЧНИТЬ у PO]`)
        }
      }
      rows.push(cells)
    }
    const sig = (r: readonly string[]) => r.join('|')
    // Проза раздела: в документе портала — не сохраняется (таблица или «Риски заказчиком не названы.»).
    const body = parsed.lines.slice(section.start + 1, section.end)
    const tableLines = new Set<number>()
    for (const t of section.tables) for (let i = t.start; i < t.end; i++) tableLines.add(i - section.start - 1)
    const prose = body.filter((l, i) => !tableLines.has(i) && l.trim())
    const extraProse = prose.filter((l) => l.trim() !== NO_RISKS)
    if (isPortal && (extraProse.length || (rows.length && prose.length))) {
      changed = true
      for (const l of extraProse) log.push(`Риски: строка прозы «${l.trim().slice(0, 70)}» удалена — раздел пишет таблицу`)
    }
    if ((table?.rows ?? []).map((r) => sig(r.cells)).join('\n') !== rows.map(sig).join('\n')) changed = true
    if (!changed) return text
    const keepProse = isPortal ? [] : extraProse
    const block = rows.length ? [renderRow(header), table?.separator ?? separatorOf(header), ...rows.map(renderRow)] : [NO_RISKS]
    const next = [parsed.lines[section.start]!, '', ...keepProse.flatMap((l) => [l, '']), ...block, '']
    return [...parsed.lines.slice(0, section.start), ...next, ...parsed.lines.slice(section.end)].join('\n')
  },
}

const PROVENANCE = /(?<!не\s)(?<![\p{L}])(?:подтвержд\p{L}*|подтвердил\p{L}*|согласован[оаы]?|в\s+работе|вед[её]т\s+реализацию|ведут\s+реализацию)(?![\p{L}])/iu

/** Клауза утверждает статус/подтверждение без источника (нет ссылки, нет слов заказчика с тем же утверждением). */
function unsourcedClaim(clause: string, said: readonly string[]): boolean {
  const m = PROVENANCE.exec(clause)
  if (!m || HTTP_LINK.test(clause)) return false
  const word = m[0].toLowerCase().slice(0, 7)
  return !said.some((s) => s.toLowerCase().includes(word) && similarity(clause, s) >= 0.6)
}

/** Клаузы ячейки: по «;» и концу предложения. */
const clausesOf = (cell: string) => cell.split(/(?<=[;.])\s+/).filter((c) => c.trim())

/** Адресат по первой ячейке строки «Зависимостей»: команда из «Команд» шапки, иначе PO. */
function teamAddressee(first: string, fastMd: string): string | undefined {
  const teams = teamsOf(fastMd).map((t) => ({ name: t, key: teamKey(t) })).filter((t) => t.key.length >= 3)
  const key = teamKey(first)
  if (!key) return undefined
  const team = teams.find((t) => key === t.key) ?? teams.find((t) => key.length >= 3 && (key.includes(t.key) || t.key.includes(key)))
  if (!team) return undefined
  return /^команд\p{L}*\s+/iu.test(team.name) ? team.name.replace(/^команд\p{L}*\s+/iu, 'команды ') : `команды «${team.name}»`
}

const SYS_STOP = new Set(['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'API', 'URL', 'HTTP', 'HTTPS', 'PDF', 'XLSX', 'JSON', 'XML', 'SOAP', 'REST', 'ФИО', 'ООО', 'ПАО', 'ЭЦП', 'ЭП', 'TODO', 'UTC', 'MSK', 'НФТ', 'ФТ', 'ПТ', 'ИТ', 'БТ', 'БФТ', 'ID', 'UI', 'UX', 'SLA', 'FAQ'])

/**
 * «Зависимости» (раунд 2, документ портала):
 *  - утверждение о статусе («в работе», «подтверждено», «согласовано»,
 *    «ведёт реализацию») без ссылки и без таких слов заказчика — убирается
 *    из ячейки; пустой статус — [УТОЧНИТЬ у {команда}: статус?] (PV001);
 *  - «ранее» рядом со ссылкой на открытую задачу — убирается.
 * Строк код не добавляет (раунд 6): предпосылки и параллельную работу пишет
 * модель по вердиктам карты находок.
 */
export const dependenciesFix: Fix = {
  name: 'dependencies',
  apply(parsed, ctx, log) {
    if (!portal(ctx)) return
    const table = sectionOf(parsed, 'Зависимости')?.tables[0]
    if (!table) return
    const said = [...customerStrings(ctx), ...(ctx.po ?? [])]
    for (const row of table.rows) {
      for (let i = 1; i < row.cells.length; i++) {
        const cell = row.cells[i] ?? ''
        if (!cell.trim()) continue
        const clauses = clausesOf(cell)
        let kept = clauses.filter((c) => !unsourcedClaim(c, said))
        kept = kept.map((c) => {
          const open = [...c.matchAll(MD_LINK)].map((m) => findingOf(m[2]!, ctx.findings)).some((f) => f && f.status && !isClosed(f))
          return open ? c.replace(/(?<![\p{L}])[Рр]анее\s+/u, '').replace(/^\p{Ll}/u, (ch) => ch.toUpperCase()) : c
        })
        const next = kept.length ? kept.join(' ').replace(/[;,]\s*$/, '').replace(/^\p{Ll}/u, (ch) => (/^\p{Lu}/u.test(cell.trim()) ? ch.toUpperCase() : ch)) : `[УТОЧНИТЬ у ${teamAddressee(row.cells[0] ?? '', ctx.fastMd) ?? 'PO'}: статус?]`
        if (next === cell) continue
        row.cells[i] = next
        log.push(`Зависимости: «${(row.cells[0] ?? '').slice(0, 40)}» — «${cell.slice(0, 60)}» → «${next.slice(0, 60)}» (статус без источника)`)
      }
    }
  },
}

/** R2-строки «Якорей»: по одной на находку, которую цитирует тело канона (кроме уже заякоренных). */
function r2Rows(parsed: ParsedCanon, ctx: CheckContext, existing: readonly string[]): { fact: string; source: string; type: string }[] {
  const body = canonSections(parsed).filter((s) => s.title.replace(/\*+$/, '').trim() !== ANCHORS_TITLE)
  const text = body.map((s) => textOf(parsed, s)).join('\n')
  const out: { fact: string; source: string; type: string }[] = []
  const seen = new Set<SourceFinding>()
  const triaged = ctx.findings.some((f) => f.relevance)
  for (const m of text.matchAll(MD_LINK)) {
    const f = findingOf(m[2]!, ctx.findings)
    if (!f || seen.has(f) || existing.some((e) => cites(e, f))) continue
    seen.add(f)
    // R2 — факт находки той же системы/функции с цитатой; название находки фактом не считается.
    const fact = f.facts[0]
    if (!fact || (triaged && (!isSame(f) || f.via))) continue
    out.push({
      fact: fact.fact.replace(/\|/g, '/'),
      source: `${f.citation}: «${fact.quote.replace(/\|/g, '/').replace(/[«»]/g, '"')}»`,
      type: f.kind === 'jira' ? 'Jira' : 'Confluence',
    })
  }
  return out
}

/** Строка ФТ канона: ID, наименование, описание, параметры (и сама строка — для правки). */
interface FtRow { id: string; name: string; desc: string; params: string; table: CanonTable; row: CanonRow }

/** Строки ФТ канона: ID, наименование, описание, параметры. */
function ftRows(parsed: ParsedCanon): FtRow[] {
  const section = sectionLike(canonSections(parsed), /^Функциональные требования/)
  return (section?.tables ?? []).flatMap((table) => {
    const [name, desc, params] = [columnOf(table, 'Наименование'), columnOf(table, 'Функциональные'), columnOf(table, 'Параметры')]
    return table.rows.filter((r) => TYPED_ID.test(r.cells[0] ?? '') && r.cells[0]!.startsWith('ФТ-')).map((r) => ({
      id: r.cells[0]!, name: name >= 0 ? r.cells[name] ?? '' : '', desc: desc >= 0 ? r.cells[desc] ?? '' : r.cells.join(' '),
      params: params >= 0 ? r.cells[params] ?? '' : '', table, row: r,
    }))
  })
}

/**
 * Отказ, ошибка, «не …» — полярность ветки. Ветка-отказ закрывается только
 * требованием, где тоже есть отказ: «напоминание, если не согласовано» —
 * не про отклонение.
 */
const NEGATIVE = /(?<![\p{L}])(?:не|нет|без)(?![\p{L}])|отказ|ошибк|недейств|отклон|неудач|неуспеш|сбо[йяеи]|невозмож|запрещ|ист[её]к|просроч/iu
/**
 * Отказ в самом требовании: «не» рядом с условием («напомнить, если не
 * согласовано») — не описание отказа, нужен отказ, ошибка, отклонение,
 * отсутствие…
 */
const REFUSAL = /отказ|ошибк|отклон|неудач|недейств|невозмож|запрещ|сбо[йяеи]|ист[её]к|просроч|отсутств|нельзя/iu
const MARKER = /`?\[УТОЧНИТЬ[^\]]*\]`?/g
const minus = (a: ReadonlySet<string>, b: ReadonlySet<string>) => new Set([...a].filter((s) => !b.has(s)))

/** Название заявки из шапки fast («# [БФТ] slug: Название»). */
export function requestTitle(fastMd: string): string {
  return /^# \[БФТ\][^:\n]*:\s*(.+)$/m.exec(fastMd)?.[1]?.trim() ?? ''
}

/** Сообщение plantuml: от кого, кому, текст. */
interface UmlMessage { from: string; to: string; text: string }
/** Ветка alt/else сценария приёмки. */
export interface AltBranch {
  label: string
  /** Номер группы alt и порядок ветки в ней (0 — сама alt). */
  group: number
  index: number
  messages: UmlMessage[]
  /** Сообщение перед alt — шаг, после которого ветвится сценарий. */
  before?: UmlMessage
}

const MESSAGE = /^\s*([\p{L}\p{N}_."]+)\s*<?-+>{1,2}\s*([\p{L}\p{N}_."]+)\s*:\s*(.*)$/u

/** plantuml «Плана демонстрации» одним текстом. */
function planUml(parsed: ParsedCanon): string {
  const plan = sectionLike(canonSections(parsed), /^План демонстрации/)
  return textOf(parsed, plan).match(/```plantuml\s*\n[\s\S]*?\n\s*```/g)?.join('\n') ?? ''
}

/** Участники plantuml: alias → имя («actor "Руководитель" as Mgr»), и кто из них актор. */
function umlParticipants(uml: string): { names: Map<string, string>; actors: Set<string> } {
  const names = new Map<string, string>()
  const actors = new Set<string>()
  for (const m of uml.matchAll(/^\s*(actor|participant|database|queue|entity|collections|boundary|control)\s+(?:"([^"]+)"|(\S+))(?:\s+as\s+(\S+))?/gm)) {
    const name = (m[2] ?? m[3])!.trim()
    const alias = (m[4] ?? m[3] ?? name).trim()
    names.set(alias, name)
    if (m[1] === 'actor') actors.add(name)
  }
  return { names, actors }
}

/** Ветки alt/else сценария приёмки — все, включая саму alt (вложенные — тоже). */
export function altBranches(parsed: ParsedCanon): AltBranch[] {
  return parseUml(parsed).branches
}

/** Сценарий приёмки: ветки alt/else и сообщения основной линии (вне alt). */
function parseUml(parsed: ParsedCanon): { branches: AltBranch[]; main: UmlMessage[] } {
  const lines = planUml(parsed).split('\n')
  const out: AltBranch[] = []
  const main: UmlMessage[] = []
  const stack: { kind: string; branch?: AltBranch }[] = []
  let group = 0
  let last: UmlMessage | undefined
  const clean = (s: string) => s.replace(MARKER, '').replace(/\s+/g, ' ').trim()
  for (const line of lines) {
    const open = /^\s*(alt|opt|loop|par|group|critical|break)\b\s*(.*)$/.exec(line)
    if (open) {
      if (open[1] === 'alt') {
        const branch: AltBranch = { label: clean(open[2]!), group: ++group, index: 0, messages: [], ...(last ? { before: last } : {}) }
        out.push(branch)
        stack.push({ kind: 'alt', branch })
      } else stack.push({ kind: open[1]! })
      continue
    }
    const other = /^\s*else\b\s*(.*)$/.exec(line)
    const top = stack.at(-1)
    if (other && top?.kind === 'alt' && top.branch) {
      const branch: AltBranch = { label: clean(other[1]!), group: top.branch.group, index: top.branch.index + 1, messages: [], ...(top.branch.before ? { before: top.branch.before } : {}) }
      out.push(branch)
      top.branch = branch
      continue
    }
    if (/^\s*end\s*$/.test(line)) { stack.pop(); continue }
    const m = MESSAGE.exec(line)
    if (!m) continue
    const message = { from: m[1]!.replace(/"/g, ''), to: m[2]!.replace(/"/g, ''), text: m[3]!.trim() }
    const inAlt = [...stack].reverse().find((s) => s.kind === 'alt')
    if (inAlt?.branch) inAlt.branch.messages.push(message)
    else { last = message; main.push(message) }
  }
  return { branches: out, main }
}

/** Основы, которые не различают требования: слова названия заявки и имена акторов. */
function commonStems(parsed: ParsedCanon, fastMd: string): Set<string> {
  const { actors } = umlParticipants(planUml(parsed))
  return contentStems([requestTitle(fastMd), ...actors].join(' '))
}

const branchText = (b: AltBranch) => `${b.label} ${b.messages.map((m) => m.text).join(' ')}`

/**
 * Ветка — happy path, если в ней нет отказа (ни в подписи, ни в стрелках) и
 * её текст покрывает результат шага How to demo (половина основ). Если ни
 * одна ветка группы не совпала с демо, последний результат демо не на
 * основной линии, а не-отказ в группе один среди отказов — он happy path.
 */
function happyBranches(uml: { branches: AltBranch[]; main: UmlMessage[] }, fastMd: string): Set<AltBranch> {
  const { branches, main } = uml
  const results = demoResults(fastMd).map((r) => contentStems(r)).filter((s) => s.size)
  const mainStems = contentStems(main.map((m) => m.text).join(' ').replace(MARKER, ''))
  const lastOnMain = !!results.length && shareIn(results.at(-1)!, mainStems) >= 0.5
  const happy = new Set<AltBranch>()
  for (const group of new Set(branches.map((b) => b.group))) {
    const own = branches.filter((b) => b.group === group)
    const positive = own.filter((b) => !NEGATIVE.test(b.label) && !NEGATIVE.test(b.messages.map((m) => m.text).join(' ').replace(MARKER, '')))
    const matched = positive.filter((b) => { const t = contentStems(branchText(b).replace(MARKER, '')); return results.some((r) => shareIn(r, t) >= 0.5) })
    if (matched.length) matched.forEach((b) => happy.add(b))
    else if (!lastOnMain && own.length >= 2 && positive.length === 1) happy.add(positive[0]!)
  }
  return happy
}

/** Альтернативные ветки сценария (не happy path) — их и закрывают ФТ. */
export function alternativeBranches(parsed: ParsedCanon, fastMd = ''): AltBranch[] {
  const uml = parseUml(parsed)
  const happy = happyBranches(uml, fastMd)
  // Ветка, которая сама — шаг How to demo той же полярности («на странице без вопросов блока нет»), — не отклонение:
  // её покрытие — покрытие шага (CV001), а не отдельный ФТ.
  const steps = demoResults(fastMd).map((r) => ({ stems: contentStems(r.replace(MARKER, '')), negative: NEGATIVE.test(r) })).filter((r) => r.stems.size)
  // Шаг узнаётся по тому, что ветка показывает актору (стрелки), а не по подписи: 60% основ результата шага.
  const isStep = (b: AltBranch) => {
    const shown = b.messages.map((m) => m.text).join(' ').replace(MARKER, '')
    const own = contentStems(shown)
    return !!own.size && steps.some((r) => r.negative === NEGATIVE.test(`${b.label} ${shown}`) && shareIn(r.stems, own) >= 0.6)
  }
  return uml.branches.filter((b) => b.label && !happy.has(b) && !isStep(b))
}

/** Подписи альтернативных веток (метрики и проверки). */
export function elseLabels(parsed: ParsedCanon, fastMd = ''): string[] {
  return alternativeBranches(parsed, fastMd).map((b) => b.label)
}

/**
 * ФТ закрывает ветку: половина основ подписи ветки (без слов заявки и имён
 * акторов) есть в наименовании и описании ФТ, наименование ФТ называет то,
 * что есть в ветке, и полярность та же (ветка-отказ — ФТ про отказ). Или в
 * «Параметрах» ФТ уже названа эта ветка.
 */
function covers(ft: FtRow, branch: AltBranch, common: ReadonlySet<string>): boolean {
  return coverScore(ft, branch, common) > 0
}

const normLabel = (s: string) => unmark(s).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Насколько ФТ закрывает ветку (0 — не закрывает): доля основ подписи, общие с веткой основы наименования. */
function coverScore(ft: FtRow, branch: AltBranch, common: ReadonlySet<string>): number {
  if (ft.params.includes(`«${branch.label}»`) || normLabel(ft.name) === normLabel(branch.label)) return 2
  const label0 = contentStems(branch.label)
  const label = minus(label0, common).size ? minus(label0, common) : label0
  const text = `${ft.name} ${ft.desc}`
  const name = minus(contentStems(ft.name), common)
  const inBranch = contentStems(branchText(branch).replace(MARKER, ''))
  const share = label.size ? shareIn(label, contentStems(text)) : 0
  const named = [...name].filter((s) => inBranch.has(s)).length
  if (share < 0.5 || !named || (NEGATIVE.test(branch.label) && !REFUSAL.test(text))) return 0
  return share + 0.1 * named
}

/**
 * Какой ФТ закрывает какую ветку: пары по убыванию оценки, сперва ФТ, ещё не
 * занятые другой веткой («период больше допустимого» и «данных нет» — разные ФТ).
 */
function assignBranches(fts: readonly FtRow[], branches: readonly AltBranch[], common: ReadonlySet<string>): Map<AltBranch, FtRow> {
  const pairs = branches.flatMap((b) => fts.map((f) => ({ b, f, score: coverScore(f, b, common) }))).filter((p) => p.score > 0).sort((x, y) => y.score - x.score)
  const out = new Map<AltBranch, FtRow>()
  const used = new Set<FtRow>()
  for (const reuse of [false, true]) {
    for (const p of pairs) {
      if (out.has(p.b) || (!reuse && used.has(p.f))) continue
      out.set(p.b, p.f)
      used.add(p.f)
    }
  }
  return out
}

/** Альтернативные ветки без ФТ. */
export function uncoveredElse(parsed: ParsedCanon, fastMd = ''): string[] {
  const fts = ftRows(parsed)
  const common = commonStems(parsed, fastMd)
  return alternativeBranches(parsed, fastMd).filter((b) => !fts.some((f) => covers(f, b, common))).map((b) => b.label)
}

/** Шаги How to demo: действие (до «→») и результат (после). */
export function demoSteps(fastMd: string): { n: number; action: string; result: string }[] {
  const block = /### How to demo\s*\n([\s\S]*?)(?=\n### |\n## |$)/.exec(fastMd)?.[1] ?? ''
  return block.split('\n').map((l) => /^\s*(\d+)\.\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => {
    const s = m[2]!
    const cut = s.lastIndexOf('→')
    return { n: Number(m[1]), action: cut < 0 ? '' : s.slice(0, cut).trim(), result: (cut < 0 ? s : s.slice(cut + 1)).trim() }
  })
}

/**
 * Пробелы покрытия How to demo: статус в «…» и уведомление из результата шага
 * должны быть в описании ФТ (или в UI-колонке ИТ), а не в комментарии ПТ.
 */
export function demoGaps(parsed: ParsedCanon, fastMd: string): { result: string; missing: string[]; step: number; action: string }[] {
  const sections = canonSections(parsed)
  const ft = ftRows(parsed).map((r) => `${r.name} ${r.desc}`)
  const it = (sectionLike(sections, /^Требования к интерфейсам/)?.tables ?? []).flatMap((t) => {
    const c = columnOf(t, 'Требование к')
    return t.rows.filter((r) => /^ИТ-\d+$/.test(r.cells[0] ?? '')).map((r) => (c >= 0 ? r.cells[c] ?? '' : ''))
  })
  const pool = [...ft, ...it].join('\n').toLowerCase()
  return demoSteps(fastMd).map(({ n, action, result }) => {
    const missing = [...result.matchAll(/«([^»]+)»/g)].map((m) => m[1]!).filter((s) => !pool.includes(s.toLowerCase()))
    if (/уведомл/i.test(result) && !pool.includes('уведомл')) missing.push('уведомление')
    return { result, missing: [...new Set(missing)], step: n, action }
  }).filter((g) => g.missing.length)
}

/** ID в ячейке «Результат» строк «что если» с «Нет»: ссылки, которыми модель «закрыла» гипотезу. */
function whatIfNoRefs(parsed: ParsedCanon): Set<string> {
  const plan = sectionLike(canonSections(parsed), /^План демонстрации/)
  const out = new Set<string>()
  for (const t of plan?.tables ?? []) {
    if (!/what-if|что если/i.test(t.header[0] ?? '')) continue
    const res = columnOf(t, 'Результат') >= 0 ? columnOf(t, 'Результат') : 2
    for (const r of t.rows) {
      if (!/^нет/i.test(unmark(r.cells[1] ?? ''))) continue
      for (const id of idsIn(r.cells[res] ?? '')) out.add(id)
    }
  }
  return out
}

/**
 * Откуда ФТ: ID скелета, ссылка на находку, результат шага How to demo
 * (половина его основ есть в ФТ) или альтернативная ветка сценария. Иначе —
 * без происхождения (гипотеза модели).
 */
function ftOrigin(ft: FtRow, ctx: Pick<CheckContext, 'skeleton' | 'fastMd'>, common: ReadonlySet<string>, branches: readonly AltBranch[]): string | undefined {
  if (ctx.skeleton.some((s) => s.id === ft.id)) return 'скелет'
  if (HTTP_LINK.test(ft.row.cells.join(' '))) return 'находка'
  const text = contentStems(`${ft.name} ${ft.desc}`)
  for (const s of demoSteps(ctx.fastMd)) {
    const r = minus(contentStems(s.result), common)
    if (r.size && shareIn(r, text) >= 0.5) return `шаг ${s.n}`
  }
  if (branches.some((b) => covers(ft, b, common))) return 'ветка alt'
  return undefined
}

/** ФТ без происхождения (метрика ft_without_origin и WARN FT003). */
export function ftWithoutOrigin(parsed: ParsedCanon, ctx: Pick<CheckContext, 'skeleton' | 'fastMd'>): string[] {
  const common = commonStems(parsed, ctx.fastMd)
  const branches = alternativeBranches(parsed, ctx.fastMd)
  return ftRows(parsed).filter((f) => !ftOrigin(f, ctx, common, branches)).map((f) => f.id)
}

/** ФТ, заведённые под строку «что если» с «Нет»: на них ссылается гипотеза, а происхождения нет. */
export function speculativeFts(parsed: ParsedCanon, ctx: Pick<CheckContext, 'skeleton' | 'fastMd'>): string[] {
  const refs = whatIfNoRefs(parsed)
  const without = new Set(ftWithoutOrigin(parsed, ctx))
  return ftRows(parsed).filter((f) => refs.has(f.id) && without.has(f.id)).map((f) => f.id)
}

/** Убрать ссылки на ID из текста: «(см. ФТ-2)» целиком, ID в перечислении — с запятой. */
export function scrubIds(text: string, ids: ReadonlySet<string>): string {
  if (!ids.size) return text
  let out = text.replace(new RegExp(ID_RE.source, 'g'), (m, offset: number, whole: string) => (ids.has(m) && !/\d/.test(whole[offset + m.length] ?? '') ? '\u0000' : m))
  if (!out.includes('\u0000')) return text
  out = out.replace(/\s*[,;]\s*\u0000|\u0000\s*[,;]\s*/g, '').replace(/\s*\u0000/g, '')
  return out.replace(/\s*\(\s*(?:см\.?)?\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;])/g, '$1')
}

/**
 * ФТ-гипотеза (раунд 3): строка «что если» с «Нет» — открытый вопрос, а не
 * требование. ФТ, на который ссылается только такая строка (нет ни ID
 * скелета, ни находки, ни шага How to demo, ни ветки alt), удаляется; ссылки
 * на него в документе — тоже. Вопрос остаётся маркером в «Результате».
 */
export const speculativeFtFix: Fix = {
  name: 'speculative-ft',
  apply(parsed, ctx, log) {
    if (!portal(ctx)) return
    const drop = new Set(speculativeFts(parsed, ctx))
    if (!drop.size) return
    for (const f of ftRows(parsed).filter((x) => drop.has(x.id))) {
      f.table.rows = f.table.rows.filter((r) => r !== f.row)
      log.push(`Функциональные требования: ${f.id} «${unmark(f.name).slice(0, 60)}» удалён — гипотеза «что если» без источника (ни скелета, ни шага демо, ни ветки, ни находки)`)
    }
    scrubCanon(parsed, drop)
  },
}

/** Ссылки на удалённые ID — из ячеек и прозы канона. */
function scrubCanon(parsed: ParsedCanon, ids: ReadonlySet<string>): void {
  const sections = canonSections(parsed)
  const tableLines = new Set<number>()
  for (const s of sections) for (const t of s.tables) {
    for (let i = t.start; i < t.end; i++) tableLines.add(i)
    for (const r of t.rows) r.cells = r.cells.map((c) => scrubIds(c, ids))
  }
  for (const s of sections) for (let i = s.start; i < s.end; i++) {
    if (!tableLines.has(i)) parsed.lines[i] = scrubIds(parsed.lines[i]!, ids)
  }
}

/** Пункт покрытия сценария, который не закрыт ни одним ФТ/ИТ: результат шага How to demo или ветка-отклонение. */
export interface CoverageGap { kind: 'status' | 'notification' | 'branch'; what: string; step?: number; result?: string }

/**
 * Покрытие сценария — детекция, не синтез (раунд 4): код только находит, что
 * не закрыто, а требования пишет модель — в первом промте по чек-листу из How
 * to demo (coverageChecklist), на повторе — по строкам CV001/CV005.
 *  - статус в «…» или уведомление из результата шага How to demo, которых нет
 *    в описании ФТ (или в UI-колонке ИТ);
 *  - альтернативная ветка alt/else (не happy path), которую не закрывает ни один ФТ.
 */
export function coverageGaps(parsed: ParsedCanon, fastMd: string): CoverageGap[] {
  const out: CoverageGap[] = []
  for (const gap of demoGaps(parsed, fastMd)) {
    for (const m of gap.missing) out.push({ kind: m === 'уведомление' ? 'notification' : 'status', what: m, step: gap.step, result: gap.result })
  }
  for (const label of uncoveredElse(parsed, fastMd)) out.push({ kind: 'branch', what: label })
  return out
}

/**
 * Чек-лист покрытия для первого промта — только из How to demo шапки fast:
 * по пункту на результат шага, отдельно — статусы в «…» и уведомления.
 * Текст требований здесь не пишется: пункт говорит, ЧТО покрыть, формулирует модель.
 */
export function coverageChecklist(fastMd: string): string[] {
  const out: string[] = []
  for (const { n, result } of demoSteps(fastMd)) {
    if (!result) continue
    out.push(`Шаг ${n} How to demo: «${result}» — наблюдаемый результат описан в ФТ (поведение системы) или ИТ (что видно на экране); «Связанные» — ПТ актора шага и БТ.`)
    for (const m of [...new Set([...result.matchAll(/«([^»]+)»/g)].map((x) => x[1]!))]) out.push(`Шаг ${n}: статус «${m}» назван дословно в описании ФТ (кто его видит и где) или в UI-колонке ИТ.`)
    if (/уведомл/i.test(result)) out.push(`Шаг ${n}: уведомление — ФТ: кто получает, по какому событию; канал и текст без источника — [УТОЧНИТЬ у {адресат}: …?] в «Параметрах».`)
  }
  // Ветки-отклонения — всегда (раунд 6, CV005 — ERROR): сценарий с alt пишет модель, даже если How to demo пуст.
  out.push('Каждая ветка-отклонение в alt/else сценария приёмки (не happy path) закрыта своим ФТ: наименование ФТ называет то же отклонение, что подпись ветки, описание — тот же отказ или ошибку: что видит актор и что происходит с данными; «Связанные» — ПТ/БТ. Ветка без такого ФТ — ошибка проверки.')
  const systems = teamsOf(fastMd).map(systemName).filter((t) => t.length >= 3)
  if (systems.length) out.push(`Системы из «Команд» шапки (${systems.join(', ')}): та, на которую действует ФТ, — участник plantuml целиком (названием продукта) со своим шагом, результат которого видит актор; команды, роли и внутренние сервисы участниками не бывают.`)
  return out
}

/** ASIS озвучен заказчиком (want.asis, asis требований, intake.asis). */
export function asisKnown(primary: PrimaryLike | undefined, intake: Intake | undefined): boolean {
  const a = primary?.args
  return !!(intake?.asis?.trim() || a?.want?.asis?.trim() || (a?.requirements ?? []).some((r) => r?.asis?.trim()) || presentState(a?.want?.quote))
}

const PRESENT_STATE = /(?<![\p{L}])(?:сейчас|нет|не\s+готов\p{L}*|не\s+мо(?:жет|гут)|отсутству\p{L}*|вручную)(?![\p{L}])/iu

/** Клаузы «ПРОБЛЕМЫ» о текущем состоянии, которых заказчик не говорил (ASIS не озвучен). */
export function problemClaims(parsed: ParsedCanon, ctx: Pick<CheckContext, 'primary' | 'intake'>): { cell: string; claims: string[] } | undefined {
  if (!ctx.primary || asisKnown(ctx.primary, ctx.intake)) return undefined
  const section = sectionLike(canonSections(parsed), /^Проблема которую решаем/)
  const row = section?.tables.flatMap((t) => t.rows).find((r) => /ПРОБЛЕМА/i.test(r.cells[0] ?? ''))
  if (!row) return undefined
  const said = customerStrings(ctx).map((s) => s.toLowerCase())
  const cell = row.cells[1] ?? ''
  const claims = clausesOf(cell).filter((c) => {
    if (/\[УТОЧНИТЬ|\[ASIS/.test(c)) return false
    const m = PRESENT_STATE.exec(c)
    if (!m) return false
    const word = m[0].toLowerCase().replace(/\s+/g, ' ')
    return !said.some((s) => s.replace(/\s+/g, ' ').includes(word) && similarity(c, s) >= 0.5)
  })
  return { cell, claims }
}

/** ПРОБЛЕМА без ASIS заказчика: утверждение о текущем состоянии → `[ASIS не озвучен]` (раунд 2). */
export const problemAsisFix: Fix = {
  name: 'problem-asis',
  apply(parsed, ctx, log) {
    const found = problemClaims(parsed, ctx)
    if (!found?.claims.length) return
    const row = sectionLike(canonSections(parsed), /^Проблема которую решаем/)!.tables.flatMap((t) => t.rows).find((r) => /ПРОБЛЕМА/i.test(r.cells[0] ?? ''))!
    let placed = false
    const next = clausesOf(found.cell).flatMap((c) => {
      if (!found.claims.includes(c)) return [c]
      if (placed) return []
      placed = true
      return [`\`[ASIS не озвучен]\`${/[;.]$/.test(c.trim()) ? c.trim().slice(-1) : ''}`]
    }).join(' ')
    row.cells[1] = next
    log.push(`Проблема: «${found.claims.join(' ').slice(0, 80)}» — текущее состояние заказчиком не названо → [ASIS не озвучен]`)
  },
}

const THRESHOLD = /не\s+(?:долж\p{L}+\s+)?(?:превыша\p{L}*|более|менее|дольше|больше)|в\s+пределах/iu

/**
 * НФТ: порог, взятый из слов заказчика о текущем состоянии («уходит до недели»),
 * — не цель. Клауза с таким порогом убирается; осталась пустая ячейка —
 * [УТОЧНИТЬ у заказчика: целевое значение?] (раунд 2, документ портала).
 */
export const nftThresholdFix: Fix = {
  name: 'nft-threshold',
  apply(parsed, ctx, log) {
    if (!portal(ctx)) return
    const a = ctx.primary?.args
    const nowText = [a?.want?.asis, ctx.intake?.asis, a?.metric?.now, ...(a?.requirements ?? []).map((r) => r?.asis),
      ...[a?.want?.why, a?.want?.quote].flatMap((t) => (t ?? '').split(/(?<=[.!?;])\s+/).filter((s) => /сейчас|сегодня|занима|уход/i.test(s)))].filter(Boolean).join(' ')
    if (!nowText.trim()) return
    const now = contentStems(nowText)
    // Цель — только названный заказчиком порог: «хотим» эффекта, срок, требование с порогом.
    const target = contentStems([a?.metric?.target, a?.deadline?.when, ...(a?.requirements ?? []).map((r) => r?.text).filter((t) => !!t && THRESHOLD.test(t))].filter(Boolean).join(' '))
    for (const table of sectionLike(canonSections(parsed), /^Нефункциональные требования/)?.tables ?? []) {
      const col = columnOf(table, 'Описание')
      if (col < 0) continue
      for (const row of table.rows) {
        const cell = row.cells[col] ?? ''
        const clauses = clausesOf(cell)
        const kept = clauses.filter((c) => {
          const m = THRESHOLD.exec(c)
          if (!m || HTTP_LINK.test(c)) return true
          const value = contentStems(c.slice(m.index + m[0].length).replace(/`?\[УТОЧНИТЬ[^\]]*\]`?/g, ''))
          return !(value.size && [...value].every((v) => now.has(v) && !target.has(v)))
        })
        if (kept.length === clauses.length) continue
        const next = kept.some((c) => /\[УТОЧНИТЬ/.test(c)) ? kept.join(' ') : [...kept, 'Целевое значение — [УТОЧНИТЬ у заказчика: какой порог считать достигнутым?]'].join(' ')
        row.cells[col] = next.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase())
        log.push(`Нефункциональные требования: ${row.cells[0]} — порог из слов о текущем состоянии убран`)
      }
    }
  },
}

/**
 * Проза документа портала (раунд 2): приём заявки — переписка, встречи не было
 * («на встрече не обсуждалось» → «заказчиком не названо»); отдельные строки
 * прозы под таблицей НФТ — пересказ правил, не требования — удаляются.
 */
export const portalProseFix: Fix = {
  name: 'portal-prose',
  rewrite(text, ctx, log) {
    if (!portal(ctx)) return text
    let n = 0
    let out = text.replace(/на\s+встрече\s+не\s+(?:обсуждал|звучал)\p{L}*|не\s+(?:обсуждал|звучал)\p{L}*\s+на\s+встрече/giu, () => { n++; return 'заказчиком не названо' })
    if (n) log.push(`«на встрече …» → «заказчиком не названо»: ${n} (приём заявки — переписка)`)
    const parsed = parseCanon(out)
    const nft = sectionLike(parsed.sections, /^Нефункциональные требования/)
    if (nft?.tables.length) {
      const inTable = new Set<number>()
      for (const t of nft.tables) for (let i = t.start; i < t.end; i++) inTable.add(i)
      const drop = new Set<number>()
      let fence = false
      for (let i = nft.start + 1; i < nft.end; i++) {
        const l = parsed.lines[i]!
        if (/^\s*```/.test(l)) fence = !fence
        if (fence || inTable.has(i) || !l.trim() || /^#{3,}\s/.test(l) || /^\s*```/.test(l)) continue
        drop.add(i)
        log.push(`Нефункциональные требования: строка прозы «${l.trim().slice(0, 70)}» удалена`)
      }
      if (drop.size) out = parsed.lines.filter((_, i) => !drop.has(i)).join('\n').replace(/\n{3,}/g, '\n\n')
    }
    return out
  },
}

const GOLDEN_N = 8
const GOLDEN_KEEP = /^\s*(?:\*\*|Атрибутивный состав сообщений)/
const wordsOf = (s: string) => s.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? []

/** Строки прозы канона (не таблицы, не заголовки, не код) с номерами. */
function proseLines(lines: readonly string[]): { i: number; text: string }[] {
  const out: { i: number; text: string }[] = []
  let fence = false
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) { fence = !fence; return }
    if (fence || !l.trim() || /^\s*\|/.test(l) || /^#{1,6}\s/.test(l) || GOLDEN_KEEP.test(l)) return
    out.push({ i, text: l })
  })
  return out
}

/** 8-граммы слов прозы эталона. */
export function goldenGrams(golden: string): Set<string> {
  const grams = new Set<string>()
  for (const { text } of proseLines(golden.split('\n'))) {
    const w = wordsOf(text)
    for (let i = 0; i + GOLDEN_N <= w.length; i++) grams.add(w.slice(i, i + GOLDEN_N).join(' '))
  }
  return grams
}

const sentencesOf = (line: string) => line.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«"`[])/)
const leaks = (sentence: string, grams: ReadonlySet<string>) => {
  const w = wordsOf(sentence)
  for (let i = 0; i + GOLDEN_N <= w.length; i++) if (grams.has(w.slice(i, i + GOLDEN_N).join(' '))) return true
  return false
}

/** Предложения прозы документа, перенесённые из эталона дословно (8 слов подряд). */
export function goldenLeaks(canon: string, golden: string): string[] {
  const grams = goldenGrams(golden)
  return proseLines(canon.split('\n')).flatMap(({ text }) => sentencesOf(text).filter((s) => leaks(s, grams)))
}

/** Дословная проза эталона в документе — выдуманный факт другого проекта: предложение удаляется. */
export const goldenLeakFix: Fix = {
  name: 'golden-leak',
  rewrite(text, ctx, log) {
    if (!ctx.golden) return text
    const grams = goldenGrams(ctx.golden)
    if (!grams.size) return text
    const lines = text.split('\n')
    const drop = new Set<number>()
    for (const { i, text: line } of proseLines(lines)) {
      const sentences = sentencesOf(line)
      const kept = sentences.filter((s) => !leaks(s, grams))
      if (kept.length === sentences.length) continue
      for (const s of sentences.filter((x) => !kept.includes(x))) log.push(`проза из эталона удалена: «${s.slice(0, 80)}»`)
      if (kept.length) lines[i] = kept.join(' ')
      else drop.add(i)
    }
    return drop.size || log.length ? lines.filter((_, i) => !drop.has(i)).join('\n').replace(/\n{3,}/g, '\n\n') : text
  },
}

/** Ячейки ФТ/НФТ/ИТ с [УТОЧНИТЬ], на которые отвечает факт существующего решения с числом/ограничением. */
export function answerableCells(parsed: ParsedCanon, findings: readonly SourceFinding[], fastMd = ''): { id: string; finding: SourceFinding; fact: { fact: string; quote: string } }[] {
  // Слова названия заявки (и их формы) есть почти в каждой строке — ответ узнаётся по остальным основам.
  const subject = subjectStems(fastMd)
  const strip = (set: Set<string>) => new Set([...set].filter((st) => !inSubject(st, subject)))
  const facts = existingSolutions(findings).flatMap((f) => f.facts.filter((x) => /\d/.test(`${x.fact} ${x.quote}`)).map((fact) => ({ finding: f, fact, stems: strip(contentStems(`${fact.fact} ${fact.quote}`)) }))).filter((x) => x.stems.size)
  if (!facts.length) return []
  const out: { id: string; finding: SourceFinding; fact: { fact: string; quote: string } }[] = []
  for (const row of typedRows(canonSections(parsed)).filter((r) => /^(?:ФТ|НФТ|ИТ)-/.test(r.id))) {
    const open = row.cells.filter((c) => /\[УТОЧНИТЬ/.test(c) && !HTTP_LINK.test(c))
    if (!open.length) continue
    const rowStems = strip(contentStems(row.cells.join(' ')))
    // Сама открытая ячейка — о том же, что факт (общая основа), и строка в целом близка к факту.
    const openStems = strip(contentStems(open.join(' ')))
    const hit = facts.find((x) => {
      const shared = [...x.stems].filter((s) => rowStems.has(s)).length
      return shared >= 2 && shared / x.stems.size >= 0.3 && [...x.stems].some((s) => openStems.has(s))
    })
    if (hit) out.push({ id: row.id, finding: hit.finding, fact: hit.fact })
  }
  return out
}

/** Человеческие акторы plantuml без ПТ: все основы имени актора — в одной строке ПТ. */
export function actorsWithoutPt(parsed: ParsedCanon): { actors: string[]; without: string[] } {
  const sections = canonSections(parsed)
  const plan = sectionLike(sections, /^План демонстрации/)
  const uml = textOf(parsed, plan).match(/```plantuml\s*\n[\s\S]*?\n\s*```/g)?.join('\n') ?? ''
  const actors = [...uml.matchAll(/^\s*actor\s+(?:"([^"]+)"|(\S+))/gm)].map((m) => (m[1] ?? m[2])!.trim())
  const pts = typedRows(sections).filter((r) => r.id.startsWith('ПТ-')).map((r) => stemSet(r.cells.join(' ')))
  const without = actors.filter((a) => { const s = stemSet(a); return s.size > 0 && !pts.some((p) => [...s].every((x) => p.has(x))) })
  return { actors, without }
}

// ── Раунд 3: ID, ссылки на находки, существующее решение ───────────────────

const LOOSE_ID = /^(БТ|ПТ|ИТ|ФТ|НФТ)-(\d+)$/

/**
 * ID строк требований — грамматика линтера (номер с 1, без ведущих нулей,
 * без повторов). «ИТ-0», «ФТ-01» получают свободный номер своего типа (ведущие
 * нули — тот же номер, если он свободен), и каждая ссылка в каноне
 * переписывается тем же отображением; повтор ID — следующий свободный номер
 * только у строки-повтора (ссылки ведут на первую). Иначе линтер не видит
 * строку, ссылки на неё — TR001 на каждой попытке.
 */
export const normalizeIdsFix: Fix = {
  name: 'normalize-ids',
  rewrite(text, _ctx, log) {
    const parsed = parseCanon(text)
    const rows = canonSections(parsed).flatMap((s) => s.tables.flatMap((t) => t.rows))
    const max = new Map<string, number>()
    for (const r of rows) {
      const m = LOOSE_ID.exec((r.cells[0] ?? '').trim())
      if (m && CANON_ID.test(m[0])) max.set(m[1]!, Math.max(max.get(m[1]!) ?? 0, Number(m[2])))
    }
    const used = new Set(rows.map((r) => (r.cells[0] ?? '').trim()).filter((id) => CANON_ID.test(id)))
    const next = (type: string) => { const n = (max.get(type) ?? 0) + 1; max.set(type, n); used.add(`${type}-${n}`); return `${type}-${n}` }
    const map = new Map<string, string>()
    const dupLines = new Map<number, string>()
    const seen = new Set<string>()
    for (const r of rows) {
      const id = (r.cells[0] ?? '').trim()
      const m = LOOSE_ID.exec(id)
      if (!m) continue
      if (CANON_ID.test(id)) {
        if (seen.has(id)) dupLines.set(r.line, next(m[1]!))
        seen.add(id)
        continue
      }
      if (map.has(id)) continue
      const plain = `${m[1]}-${Number(m[2])}`
      map.set(id, Number(m[2]) > 0 && !used.has(plain) ? (used.add(plain), plain) : next(m[1]!))
    }
    if (!map.size && !dupLines.size) return text
    const lines = parsed.lines.map((line, i) => {
      let out = map.size ? line.replace(new RegExp(ID_RE.source, 'g'), (id: string, offset: number, whole: string) => (map.has(id) && !/\d/.test(whole[offset + id.length] ?? '') ? map.get(id)! : id)) : line
      const dup = dupLines.get(i)
      if (dup) out = out.replace(/^(\s*\|\s*)([^|]+?)(\s*\|)/, (_m, a: string, _id: string, b: string) => `${a}${dup}${b}`)
      return out
    })
    for (const [from, to] of map) log.push(`ID ${from} → ${to}: номер не по грамматике линтера (с 1, без ведущих нулей), ссылки переписаны`)
    for (const [line, to] of dupLines) log.push(`ID-повтор в строке ${line + 1} → ${to}`)
    return lines.join('\n')
  },
}

/**
 * Основы названия заявки, включая короткие слова: «Акт сверки» даёт и «акт»,
 * и все его формы («акта», «актом»), иначе падежная форма предмета заявки
 * совпадает с любой строкой канона.
 */
function subjectStems(fastMd: string): Set<string> {
  const words = (requestTitle(fastMd).toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 3)
  const out = contentStems(requestTitle(fastMd))
  return new Set([...out, ...words.filter((w) => w.length < 4)].flatMap((w) => [w]))
}
const inSubject = (stem: string, subject: ReadonlySet<string>) => subject.has(stem) || [...subject].some((w) => w.length === 3 && stem.startsWith(w) && stem.length <= 5)

/** Подпись ссылки без markdown: ключ Jira — `код`, страница — её название. */
const plainOf = (f: SourceFinding, label: string) => (f.kind === 'jira' && f.id ? `\`${f.id}\`` : `«${label.replace(/^Confluence:\s*/, '').trim()}»`)

/** Открытая задача про предмет заявки (общая основа с названием) — параллельная работа для «Зависимостей». */
function parallelWork(f: SourceFinding, fastMd: string): boolean {
  if (!isOpenWork(f) || f.via || (f.relevance !== undefined && !isSame(f))) return false
  const subject = contentStems(requestTitle(fastMd))
  return [...contentStems(f.title)].some((s) => subject.has(s))
}

/**
 * Ссылки на находки, которые не про ту же систему/функцию (смежные, без
 * вердикта, найденные вторым шагом), — не основание утверждений БФТ: во всём
 * каноне (кроме «Якорей», их чистит anchors) ссылка становится текстом —
 * ключ `код`, страница — «название». Исключение — «Зависимости»: открытая
 * задача Jira про предмет заявки остаётся ссылкой (параллельная работа).
 * Карта без триажа не судится.
 */
export const stripNonSameLinksFix: Fix = {
  name: 'strip-non-same-links',
  apply(parsed, ctx, log) {
    if (!ctx.findings.some((f) => f.relevance)) return
    const sections = canonSections(parsed).filter((s) => s.title.replace(/\*+$/, '').trim() !== ANCHORS_TITLE)
    const strip = (text: string, deps: boolean, where: string) => text.replace(MD_LINK, (raw, label: string, url: string) => {
      const f = findingOf(url, ctx.findings)
      if (!f || (isSame(f) && !f.via) || (deps && parallelWork(f, ctx.fastMd))) return raw
      log.push(`${where}: ссылка на ${f.id || label} снята — находка ${f.via ? 'вторым шагом' : f.relevance === 'adjacent' ? 'смежная' : f.relevance ? 'не относится' : 'без вердикта'}, не основание утверждения`)
      return plainOf(f, label)
    })
    for (const s of sections) {
      const deps = /^Зависимости/.test(s.title)
      const tableLines = new Set<number>()
      for (const t of s.tables) {
        for (let i = t.start; i < t.end; i++) tableLines.add(i)
        for (const r of t.rows) r.cells = r.cells.map((c) => (c.includes('](http') ? strip(c, deps, s.title) : c))
      }
      for (let i = s.start + 1; i < s.end; i++) if (!tableLines.has(i) && parsed.lines[i]!.includes('](http')) parsed.lines[i] = strip(parsed.lines[i]!, deps, s.title)
    }
  },
}

/** Предложения/клаузы ячейки (по «. », «; »). */
const cellClauses = (cell: string) => cell.split(/(?<=[.;])\s+(?=\S)/)

/**
 * ASIS заказчика (R3) не переписывается находкой (раунд 4): если заказчик
 * озвучил текущее состояние, из ячейки ASIS «Проблемы» и «Было» UJM уходят
 * предложения со ссылкой на корпоративную находку и пометки «уже работает»
 * по ней; слова заказчика остаются. Ячейка только из утверждения находки не
 * трогается (это не слова заказчика).
 */
export const customerAsisFix: Fix = {
  name: 'customer-asis',
  apply(parsed, ctx, log) {
    if (!portal(ctx) || !asisKnown(ctx.primary, ctx.intake)) return
    const sections = canonSections(parsed)
    const cells: { row: CanonRow; col: number; where: string }[] = []
    for (const t of sectionLike(sections, /^Проблема которую решаем/)?.tables ?? []) for (const r of t.rows) if (/ASIS/.test(r.cells[0] ?? '')) cells.push({ row: r, col: 1, where: 'Проблема: ASIS' })
    for (const t of sectionLike(sections, /^Изменение в UJM/)?.tables ?? []) {
      const c = columnOf(t, 'Было')
      if (c >= 0) for (const r of t.rows) cells.push({ row: r, col: c, where: `UJM: «${unmark(r.cells[0] ?? '').slice(0, 40)}»` })
    }
    for (const { row, col, where } of cells) {
      const cell = row.cells[col] ?? ''
      if (!CORP_URL.test(cell) && !/уже\s+работает/i.test(cell)) continue
      const parts = cellClauses(cell)
      // Сверка с находкой «По {ссылка}: …» (пишет модель) — после слов заказчика, а не вместо них: остаётся.
      const kept = parts.filter((p) => /ASIS актуален/.test(p) || (/^По \[[^\]]+\]\([^)]+\):/.test(p.trim()) && !/уже\s+работает|уже\s+внедрен/i.test(p)) || (!(HTTP_LINK.test(p) && CORP_URL.test(p)) && !/уже\s+работает|уже\s+внедрен/i.test(p)))
      const next = kept.join(' ').trim()
      if (!next || next === cell.trim() || ASIS_PLACEHOLDER.test(next)) continue
      row.cells[col] = next
      log.push(`${where} — слова заказчика без утверждения находки (R2 не переписывает R3)`)
    }
  },
}

/** Зрелость, которую источник не называет: «существующий», «действующий», «работающий», «внедрённый». */
const MATURITY_WORD = /(?<![\p{L}])(существующ|действующ|работающ)(\p{L}*)/giu
const MATURITY_PAREN = /\s*\((?:уже\s+)?(?:существующ|действующ|работающ|внедр[её]нн)\p{L}*\)/giu
/** Окончание причастия → окончание «описанн-»: «-ее» → «-ое», «-ий» → «-ый», «-им» → «-ым»… */
const describedForm = (ending: string, first: string) => {
  const e = ending.toLowerCase().replace(/^е/, 'о').replace(/^и/, 'ы')
  return `${/^\p{Lu}/u.test(first) ? 'О' : 'о'}писанн${e}`
}

/**
 * Зрелость решения — только как в источнике (раунд 4): строка канона, которая
 * ссылается на находку, где решение не работает (страница требований,
 * открытая задача), не называет его «существующим/действующим/работающим»:
 * пометка в скобках снимается, причастие становится «описанн-». «Уже
 * работает» без источника ловит WARN MT001 — переписывает модель.
 */
export const maturityFix: Fix = {
  name: 'maturity',
  apply(parsed, ctx, log) {
    const described = ctx.findings.filter((f) => isSame(f) && !maturityOf(f).operating)
    if (!described.length) return
    const sections = canonSections(parsed).filter((s) => !/^(?:Якоря истины|Риски)/.test(s.title.replace(/\*+$/, '').trim()))
    for (const s of sections) for (const t of s.tables) for (const r of t.rows) {
      const text = r.cells.join(' | ')
      const f = described.find((x) => cites(text, x) || (x.title.length >= 12 && text.includes(x.title)))
      if (!f || ctx.findings.some((x) => isSame(x) && maturityOf(x).operating && cites(text, x))) continue
      r.cells = r.cells.map((c) => {
        const next = c.replace(MATURITY_PAREN, '').replace(MATURITY_WORD, (_m, stem: string, ending: string) => describedForm(ending, stem))
        if (next !== c) log.push(`${s.title}: «${unmark(r.cells[0] ?? '').slice(0, 40)}» — зрелость не из источника: ${f.id || f.title.slice(0, 40)} описывает решение, статус в источнике: ${maturityOf(f).status}`)
        return next
      })
    }
  },
}

/** Подпись находки без ссылки: Jira — `ключ`, страница — «название». */
const plainCitation = (f: SourceFinding | undefined, label: string, url: string) => {
  const key = f?.kind === 'jira' ? f.id : JIRA_KEY_OF(url)
  return key ? `\`${key}\`` : `«${(f?.title ?? label.replace(/^Confluence:\s*/, '')).trim()}»`
}

/**
 * Одна находка — одна ссылка (раунд 4): ссылка на тот же адрес остаётся при
 * первом упоминании в порядке чтения канона, в «Рисках» (у каждого риска —
 * своя ссылка-основание) и в «Якорях»; дальше — подпись без ссылки (Jira —
 * `ключ`, страница — «название»).
 */
export const citationOnceFix: Fix = {
  name: 'citation-once',
  apply(parsed, ctx, log) {
    const keep = (title: string) => /^(?:Якоря истины|Риски)/.test(title.replace(/\*+$/, '').trim())
    for (const s of canonSections(parsed)) {
      const seen = new Set<string>()
      const replace = (text: string, where: string) => text.replace(MD_LINK, (raw, label: string, url: string) => {
        if (!CORP_URL.test(url)) return raw
        const key = linkId(url) ?? url
        if (!seen.has(key)) { seen.add(key); return raw }
        if (keep(s.title)) return raw
        const f = findingOf(url, ctx.findings)
        log.push(`${s.title}: повтор ссылки на ${f?.id || label} в «${where.slice(0, 40)}» — подпись без ссылки (одна находка — одна ссылка)`)
        return plainCitation(f, label, url)
      })
      // Порядок чтения: строки таблиц и проза раздела — по номеру строки.
      const rowAt = new Map<number, CanonRow>()
      const tableLines = new Set<number>()
      for (const t of s.tables) {
        for (let i = t.start; i < t.end; i++) tableLines.add(i)
        for (const r of t.rows) rowAt.set(r.line, r)
      }
      for (let i = s.start + 1; i < s.end; i++) {
        const r = rowAt.get(i)
        if (r) r.cells = r.cells.map((c) => (c.includes('](http') ? replace(c, unmark(r.cells[0] ?? '')) : c))
        else if (!tableLines.has(i) && parsed.lines[i]!.includes('](http')) parsed.lines[i] = replace(parsed.lines[i]!, parsed.lines[i]!.trim())
      }
    }
  },
}

// ── Раунд 4: валидность plantuml ────────────────────────────────────────────

const UML_KEYWORD = /^\s*(?:@startuml|@enduml|actor|participant|boundary|control|entity|database|collections|queue|autonumber|activate|deactivate|destroy|create|autoactivate|return|alt|else|opt|loop|par|break|critical|group|end(?:\s+(?:box|note|legend|ref|title|header|footer))?|box|note|hnote|rnote|ref\s+over|title|header|footer|legend|endlegend|skinparam|hide|show|newpage|caption|scale|left\s+to\s+right|top\s+to\s+bottom|mainframe|![a-z]+)\b/i
/** Сообщение: «A -> B: текст», «A <-- B», «[-> A», «A ->x B», «A -[#red]> B». */
const UML_MESSAGE = /^\s*(?:\[|\?)?\s*(?:"[^"]*"|[\p{L}\p{N}_.]+)?\s*(?:[ox]?<{1,2}|\/|\\)?-{1,2}(?:\[[^\]]*\])?-{0,2}(?:>{1,2}|\\{1,2}|\/{1,2})?[ox]?\s*(?:\]|\?)?\s*(?:"[^"]*"|[\p{L}\p{N}_.]+)?\s*(?::.*)?$/u
const UML_SEPARATOR = /^\s*(?:={2,}.*={2,}|\.{3}.*|\|{2,}\d*\|{0,2}|'.*|\/'.*|.*'\/\s*)$/

/** Строка plantuml — оператор диаграммы последовательности (не свободный текст). */
export function umlStatement(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  if (UML_KEYWORD.test(t) || UML_SEPARATOR.test(t)) return true
  // Сообщение — со стрелкой; голый текст без стрелки сообщением не считается.
  return /-{1,2}(?:\[[^\]]*\])?-{0,2}(?:>|\\|\/)|<-|-x\b/.test(t) && UML_MESSAGE.test(t)
}

/** Строки блоков plantuml: номер строки, текст и (для мульти-строчных note/legend/title) — свободный текст ли это. */
function umlLines(lines: readonly string[]): { i: number; text: string; free: boolean }[] {
  const out: { i: number; text: string; free: boolean }[] = []
  let inside = false
  let multi: RegExp | undefined
  lines.forEach((line, i) => {
    if (/^\s*```plantuml\s*$/.test(line)) { inside = true; return }
    if (inside && /^\s*```\s*$/.test(line)) { inside = false; multi = undefined; return }
    if (!inside) return
    if (multi) { out.push({ i, text: line, free: !multi.test(line) }); if (multi.test(line)) multi = undefined; return }
    out.push({ i, text: line, free: false })
    // Многострочные: «note over A» без «:», «legend», «title» без текста, «ref over A» без «:».
    if (/^\s*(?:[hr]?note\b(?!.*:)|ref\s+over\b(?!.*:))/i.test(line)) multi = /^\s*end\s*(?:note|ref)\b|^\s*end[hr]?note\b/i
    else if (/^\s*legend\b/i.test(line)) multi = /^\s*end\s*legend\b/i
    else if (/^\s*title\s*$/i.test(line)) multi = /^\s*end\s*title\b/i
  })
  return out
}

/** Свободный текст внутри plantuml (не оператор) — то, на чём plantuml падает. */
export function umlUnknown(text: string): { i: number; text: string }[] {
  return umlLines(text.split('\n')).filter((l) => !l.free && !umlStatement(l.text)).map(({ i, text: t }) => ({ i, text: t }))
}

/**
 * plantuml (раунд 4): голая строка без оператора внутри блока
 * («[УТОЧНИТЬ …]» внутри alt/else, пояснение) — plantuml её не принимает.
 * Становится заметкой «note over {первый участник}: …» (участников нет — комментарием).
 */
export const plantumlFix: Fix = {
  name: 'plantuml',
  rewrite(text, _ctx, log) {
    const lines = text.split('\n')
    const bad = umlUnknown(text)
    if (!bad.length) return text
    for (const { i, text: line } of bad) {
      // Первый участник блока, где стоит строка.
      let start = i
      while (start > 0 && !/^\s*```plantuml\s*$/.test(lines[start]!)) start--
      const decl = lines.slice(start, i).map((l) => /^\s*(?:actor|participant|boundary|control|entity|database|collections|queue)\s+(?:"[^"]+"|\S+)(?:\s+as\s+(\S+))?/.exec(l)).find(Boolean)
      const alias = decl ? decl[1] ?? /^\s*\S+\s+("[^"]+"|\S+)/.exec(decl[0])![1]! : undefined
      const indent = /^\s*/.exec(line)![0]
      const body = line.trim().replace(/^[-*•]\s+/, '')
      lines[i] = alias ? `${indent}note over ${alias}: ${body}` : `${indent}' ${body}`
      log.push(`Сценарий приёмки: строка «${body.slice(0, 60)}» без оператора plantuml → ${alias ? 'note over' : 'комментарий'}`)
    }
    return lines.join('\n')
  },
}

// ── Раунд 5: находки сверяются с ASIS, UJM, «что если», ветками и зависимостями ──

/**
 * Находка про объект заявки — главное существительное названия (то, что
 * заявка меняет, а не платформа, на которой она работает) есть в её названии
 * или фактах. Объекта нет — любая находка подходит.
 */
export function coversObject(f: SourceFinding, fastMd: string): boolean {
  const noun = subjectNoun(requestTitle(fastMd))
  const terms = noun ? contentTerms([noun]) : []
  if (!terms.length) return true
  const text = words([f.title, ...f.facts.map((x) => `${x.fact} ${x.quote}`)].join(' '))
  if (terms.some((t) => hasTerm(text, t))) return true
  // Без объекта, но с именем продукта из заявки — страница платформы, на которую заявка опирается.
  return !productNames(fastMd).some((t) => hasTerm(text, t))
}

/** Имена продуктов и систем заявки (название и «Команды»): латиница, аббревиатуры от трёх знаков. */
function productNames(fastMd: string) {
  const tokens = [requestTitle(fastMd), ...teamsOf(fastMd).map(systemName)].flatMap((t) => t.split(/[\s,;()]+/)).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
  return contentTerms(tokens.filter((w) => w.length >= 3 && PROPER.test(w)))
}

/** Давность находки в полных годах (по дате обновления в карте); даты нет — undefined. */
export function ageYears(f: SourceFinding, now = new Date()): number | undefined {
  const t = f.updated ? Date.parse(f.updated) : NaN
  if (Number.isNaN(t)) return undefined
  return Math.floor((now.getTime() - t) / (365.25 * 24 * 3600 * 1000))
}
/** С этой давности актуальность решения по находке — вопрос владельцу. */
export const STALE_YEARS = 3

/** «Есть источник?» ссылается на сам документ — ветку alt/else или «сценарий» этого БФТ. */
const SELF_SOURCE = /(?<![\p{L}])(?:alt|else)(?![\p{L}])|ветк\p{L}*|сценари\p{L}*\s+(?:выше|этого|данного|БФТ)/iu

/**
 * «Что если» (раунды 5–6): «Есть источник?», который называет сам документ
 * (ветку alt/else сценария), — не источник: «Нет», результат без маркера —
 * [УТОЧНИТЬ]. Ответ находкой («Частично — {ссылка}») и адрес пробела
 * «(см. …)» пишет модель; код их не подбирает по словам.
 */
export const whatIfSourceFix: Fix = {
  name: 'what-if-source',
  apply(parsed, _ctx, log) {
    const plan = sectionLike(canonSections(parsed), /^План демонстрации/)
    const table = plan?.tables.find((t) => /what-if|что если/i.test(t.header[0] ?? ''))
    if (!table || table.header.length < 3) return
    for (const r of table.rows) {
      const verdict = r.cells[1] ?? ''
      if (!SELF_SOURCE.test(verdict) || HTTP_LINK.test(verdict)) continue
      r.cells[1] = 'Нет'
      // Результат, взятый из своей же ветки, — тоже без источника.
      const refs = (r.cells[2] ?? '').match(/\(см\.[^)]*\)/g) ?? []
      if (!/\[УТОЧНИТЬ/.test(r.cells[2] ?? '')) r.cells[2] = `[УТОЧНИТЬ у PO: что происходит в этом случае?]${refs.length ? ` ${refs.join(' ')}` : ''}`
      log.push(`Что если: «${unmark(r.cells[0] ?? '').slice(0, 50)}» — источник «сам сценарий» не источник → «Нет»`)
    }
  },
}

/** Факт находки, который отвечает на строку «что если»: две различающие основы и 75% основ строки. */
function answeringFact(name: string, pool: readonly SourceFinding[], subject: ReadonlySet<string>): { f: SourceFinding; fact: string; n: number } | undefined {
  const own = distinctStems(name, subject)
  if (own.size < 2) return undefined
  let best: { f: SourceFinding; fact: string; n: number } | undefined
  for (const f of pool) for (const x of f.facts) {
    const fs = distinctStems(`${x.fact} ${x.quote}`, subject)
    const n = [...own].filter((st) => fs.has(st)).length
    if (n >= 2 && n / own.size >= 0.75 && (!best || n > best.n)) best = { f, fact: x.fact, n }
  }
  return best
}

/** Строки «что если» с «Нет», на которые отвечает факт находки той же системы/функции (метрика whatif_false_negative). */
export function whatIfFalseNegatives(parsed: ParsedCanon, findings: readonly SourceFinding[], fastMd: string): { row: string; finding: SourceFinding }[] {
  const table = sectionLike(canonSections(parsed), /^План демонстрации/)?.tables.find((t) => /what-if|что если/i.test(t.header[0] ?? ''))
  const pool = findings.filter((f) => isSame(f) && !f.via && f.facts.length > 0)
  const subject = subjectStems(fastMd)
  return (table?.rows ?? []).filter((r) => /^`?Нет/i.test((r.cells[1] ?? '').trim())).flatMap((r) => {
    const hit = answeringFact(unmark(r.cells[0] ?? ''), pool, subject)
    return hit ? [{ row: unmark(r.cells[0] ?? ''), finding: hit.f }] : []
  })
}

/** Работающее решение про объект заявки, которого нет в ячейке ASIS со словами заказчика (метрика asis_unreconciled). */
export function asisUnreconciled(parsed: ParsedCanon, ctx: Pick<CheckContext, 'findings' | 'fastMd' | 'primary' | 'intake'>): SourceFinding | undefined {
  if (!asisKnown(ctx.primary, ctx.intake)) return undefined
  const operating = existingSolutions(ctx.findings).find((f) => coversObject(f, ctx.fastMd) && maturityOf(f).operating && f.facts.length > 0)
  if (!operating) return undefined
  const cell = (sectionLike(canonSections(parsed), /^Проблема которую решаем/)?.tables ?? []).flatMap((t) => t.rows).find((r) => /ASIS/.test(r.cells[0] ?? ''))?.cells[1] ?? ''
  return mentions(cell, operating) || /ASIS актуален/.test(cell) ? undefined : operating
}

/** ID скелета, которые в каноне означают другое (SK002, метрика anchor_quote_mismatch). */
export function skeletonDrift(parsed: ParsedCanon, ctx: Pick<CheckContext, 'skeleton' | 'fastMd'>): { id: string; tobe: string; section: string }[] {
  const subject = subjectStems(ctx.fastMd)
  const rows = new Map(typedRows(canonSections(parsed)).map((r) => [r.id, r]))
  return ctx.skeleton.flatMap((sk) => {
    const row = rows.get(sk.id)
    if (!row || sk.id.startsWith('БТ-')) return []
    const want = distinctStems(`${sk.tobe} ${quoteText(sk.quote)}`, subject)
    if (!want.size) return []
    const own = distinctStems(row.cells.filter((_, i) => i !== 0 && i !== row.related).join(' '), subject)
    // Смысл ID держится, если строка канона повторяет хотя бы одну различающую основу TOBE/цитаты скелета,
    // а у длинной формулировки скелета — не меньше четверти основ (раунд 6: дрейф ID в deep).
    const shared = [...want].filter((x) => own.has(x)).length
    return shared > 0 && (want.size < 4 || shared / want.size >= 0.25) ? [] : [{ id: sk.id, tobe: sk.tobe, section: row.section }]
  })
}

/**
 * Ветка alt/else сценария (не happy path, раунд 5): что видит актор — только
 * из слов заказчика, How to demo или факта находки (сходство 0,6). Иначе
 * текст стрелки к актору — [УТОЧНИТЬ у PO: что видит {актор}?]: поведение
 * при ошибке модель не придумывает.
 */
export const altSourceFix: Fix = {
  name: 'alt-source',
  apply(parsed, ctx, log) {
    if (!portal(ctx)) return
    const plan = sectionLike(canonSections(parsed), /^План демонстрации/)
    if (!plan) return
    const alternative = new Set(alternativeBranches(parsed, ctx.fastMd).map((b) => `${b.group}:${b.index}`))
    if (!alternative.size) return
    const { names, actors } = umlParticipants(planUml(parsed))
    const sources = [
      ...customerStrings(ctx),
      ...demoSteps(ctx.fastMd).map((st) => `${st.action} ${st.result}`),
      ...ctx.findings.filter((f) => !f.via && f.relevance !== 'unrelated').flatMap((f) => f.facts.map((x) => `${x.fact} ${x.quote}`)),
    ]
    const stack: { kind: string; group?: number; index?: number }[] = []
    let group = 0
    let inUml = false
    for (let i = plan.start; i < plan.end; i++) {
      const line = parsed.lines[i]!
      if (/^\s*```plantuml/.test(line)) { inUml = true; continue }
      if (inUml && /^\s*```/.test(line)) { inUml = false; continue }
      if (!inUml) continue
      const open = /^\s*(alt|opt|loop|par|group|critical|break)\b/.exec(line)
      if (open) { stack.push(open[1] === 'alt' ? { kind: 'alt', group: ++group, index: 0 } : { kind: open[1]! }); continue }
      const top = stack.at(-1)
      if (/^\s*else\b/.test(line) && top?.kind === 'alt') { top.index = (top.index ?? 0) + 1; continue }
      if (/^\s*end\s*$/.test(line)) { stack.pop(); continue }
      const alt = [...stack].reverse().find((x) => x.kind === 'alt')
      if (!alt || !alternative.has(`${alt.group}:${alt.index}`)) continue
      const m = MESSAGE.exec(line)
      if (!m) continue
      const alias = m[2]!.replace(/"/g, '')
      const to = names.get(alias) ?? alias
      if (!actors.has(to)) continue
      const bare = m[3]!.replace(MARKER, ' ').replace(/\s+/g, ' ').trim()
      // Покрыт источником — 60% основ стрелки есть в одной строке источника (короткая строка заказчика целиком в стрелке — не источник).
      const own = contentStems(bare)
      if (own.size < 2 || sources.some((x) => shareIn(own, contentStems(x)) >= 0.6)) continue
      parsed.lines[i] = `${line.slice(0, line.indexOf(':') + 1)} [УТОЧНИТЬ у PO: что видит ${to}?]`
      log.push(`Сценарий приёмки: ветка — «${bare.slice(0, 60)}» без источника (ни слов заказчика, ни How to demo, ни находки) → [УТОЧНИТЬ]`)
    }
  },
}

/** Ключ Jira в бэктиках, повторённый подряд: «`K-1` `K-1`». */
const REPEATED_KEY = /(`[A-Z][A-Z0-9_]+-\d+`)(?:\s*[,;]?\s*\1)+/g
/** Строка о смежной задаче без ссылки и ключа: не основание зависимости. */
const ADJACENT_WORDS = /смежн\p{L}*\s+(?:задач|эпик|страниц|работ|истори|доработ)/iu

/**
 * «Зависимости» (раунды 5–6, документ портала) — только чистка:
 *  - повтор ключа подряд («`K-1` `K-1`») — один;
 *  - строка о «смежной задаче» без ссылки и ключа — удаляется.
 * Строки «Параллельная работа» и «Опирается на» код не сочиняет: их пишет
 * модель по вердиктам карты находок (строка «→» у находки).
 */
export const dependencyRowsFix: Fix = {
  name: 'dependency-rows',
  apply(parsed, ctx, log) {
    if (!portal(ctx)) return
    const table = sectionOf(parsed, 'Зависимости')?.tables[0]
    if (!table) return
    for (const r of table.rows) {
      r.cells = r.cells.map((c) => {
        const next = c.replace(REPEATED_KEY, '$1')
        if (next !== c) log.push(`Зависимости: «${unmark(r.cells[0] ?? '').slice(0, 40)}» — повтор ключа убран`)
        return next
      })
    }
    table.rows = table.rows.filter((r) => {
      const all = r.cells.join(' ')
      if (!ADJACENT_WORDS.test(all) || HTTP_LINK.test(all) || /`[A-Z][A-Z0-9_]+-\d+`/.test(all)) return true
      log.push(`Зависимости: «${unmark(r.cells[0] ?? '').slice(0, 50)}» удалена — смежная задача без ссылки и ключа`)
      return false
    })
  },
}

/**
 * Адресат маркера в одной форме (раунд 5): «у Иванова Ивана» и «у Иванова
 * Иван» — один человек; форма, которая встречается чаще (при равенстве —
 * длиннее), заменяет остальные.
 */
export const addresseeFormFix: Fix = {
  name: 'addressee-form',
  rewrite(text, _ctx, log) {
    const ADDR = /\[УТОЧНИТЬ у ([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){1,2})(?=[:\]\s])/g
    const counts = new Map<string, number>()
    for (const m of text.matchAll(ADDR)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1)
    const key = (name: string) => name.split(/\s+/).map((w) => w.toLowerCase().slice(0, 4)).join(' ')
    const best = new Map<string, string>()
    for (const [name, n] of counts) {
      const k = key(name)
      const cur = best.get(k)
      if (!cur || n > counts.get(cur)! || (n === counts.get(cur)! && name.length > cur.length)) best.set(k, name)
    }
    return text.replace(ADDR, (raw, name: string) => {
      const pick = best.get(key(name))
      if (!pick || pick === name) return raw
      log.push(`Маркер: «у ${name}» → «у ${pick}» (одна форма имени)`)
      return raw.replace(name, pick)
    })
  },
}

const REQUESTER_ROLE = /заказчик|инициатор|автор\s+заявки|requester/i
const REQUESTER_HEAD = /^(?:\*\*)?заказчик\p{L}*(?![\p{L}])/iu

/**
 * «ДЛЯ КОГО» (раунд 6): тот, кто подал заявку, — не персона. Пункт ячейки,
 * который называет заказчика (словом «Заказчик» в начале или именем человека
 * с ролью заказчика из primary.json), удаляется, если он не конечный
 * пользователь (не актор заявки и не actor сценария приёмки). Пустая ячейка —
 * [УТОЧНИТЬ]. Код только убирает; кто пользователь, пишет модель.
 */
export const forWhomFix: Fix = {
  name: 'for-whom',
  apply(parsed, ctx, log) {
    if (!portal(ctx)) return
    const section = sectionLike(canonSections(parsed), /^Проблема которую решаем/)
    const row = section?.tables.flatMap((t) => t.rows).find((r) => /ДЛЯ\s+КОГО/i.test(unmark(r.cells[0] ?? '')))
    if (!row || (row.cells[1] ?? '').trim() === '') return
    const a = ctx.primary?.args as (PrimaryLike['args'] & { actors?: { role?: string }[] }) | undefined
    const names = (a?.people ?? []).filter((p) => REQUESTER_ROLE.test(p?.role ?? '')).map((p) => (p?.name ?? '').trim().toLowerCase()).filter((n) => n.length >= 3)
    const users = [...(a?.actors ?? []).map((x) => x?.role ?? ''), ...umlParticipants(planUml(parsed)).actors].map((x) => x.trim().toLowerCase()).filter(Boolean)
    const cell = row.cells[1]!
    const sep = cell.includes(';') ? ';' : ','
    // Пункты — по разделителю вне скобок: «Заказчик (Иван Иванов, отдел продаж)» — один пункт.
    const items: string[] = []
    let depth = 0
    let cur = ''
    for (const ch of cell) {
      if (ch === '(') depth++
      if (ch === ')') depth = Math.max(0, depth - 1)
      if (ch === sep && depth === 0) { items.push(cur); cur = ''; continue }
      cur += ch
    }
    items.push(cur)
    const requester = (item: string) => {
      const t = item.trim().toLowerCase()
      return REQUESTER_HEAD.test(item.trim()) || names.some((n) => t.includes(n))
    }
    const user = (item: string) => { const t = item.trim().toLowerCase(); return users.some((u) => t.includes(u) || u.includes(t.replace(/\s*\([^)]*\)\s*/g, ' ').trim())) }
    const kept = items.filter((i) => i.trim() && !(requester(i) && !user(i)))
    if (kept.length === items.filter((i) => i.trim()).length) return
    const next = kept.map((i) => i.trim()).join(`${sep} `)
    row.cells[1] = next ? next.replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : '[УТОЧНИТЬ у PO: кто пользуется результатом?]'
    log.push(`Проблема: «ДЛЯ КОГО» — заказчик заявки убран (не конечный пользователь): «${cell.slice(0, 80)}» → «${row.cells[1]!.slice(0, 80)}»`)
  },
}

/**
 * SK002 (ERROR, раунд 5): ID скелета в каноне означает другое — у строки
 * канона нет ни одной различающей основы (без слов названия заявки) из TOBE
 * и цитаты скелета. Смысл ID сохраняется; новое требование — новым ID.
 */
const skeletonMeaningRule: Rule = {
  code: 'SK002', level: 'ERROR',
  run(doc, ctx) {
    return skeletonDrift(doc, ctx).map((d) => {
      const type = d.id.split('-')[0]!
      const used = typedRows(canonSections(doc)).filter((r) => r.id.startsWith(`${type}-`)).map((r) => Number(r.id.split('-')[1]))
      const free = `${type}-${Math.max(0, ...used) + 1}`
      return { message: `${d.id} в скелете — «${d.tobe.slice(0, 80)}», а в каноне под ${d.id} другое требование: оставь ID ${d.id} за требованием скелета (тот же смысл, формулировка — наблюдаемый результат), а новое требование поставь под следующий свободный номер (${free}) и поправь ссылки на него`, section: d.section }
    })
  },
}

/**
 * «(см. «что если»)» (раунд 5, TR004): таблица «что если» — часть раздела
 * «План демонстрации», раздела с таким заголовком нет; ссылка ведёт в раздел.
 */
export const seeWhatIfFix: Fix = {
  name: 'see-what-if',
  rewrite(text, _ctx, log) {
    let n = 0
    const out = text.replace(/(\(см\.[^)]*?)«(?:что если|what-if)»/giu, (_m, head: string) => { n++; return `${head}«План демонстрации»` })
    if (n) log.push(`Ссылки «(см. «что если»)» → «План демонстрации» — ${n}`)
    return out
  },
}

/**
 * Цепочка автоправок; порядок важен. Раунд 6: код только чистит и проверяет —
 * формат (plantuml, ID, разделители, граф «Связанных»), удаление того, что не
 * имеет источника, плейсхолдеры и смягчение зрелости. Содержание (находки в
 * ASIS и требованиях, строки «Рисков», «Зависимостей», R2 «Якорей», ответы
 * «что если») пишет модель; пропуски ей возвращают проверки RULES.
 */
export const FIXES: Fix[] = [
  plantumlFix, normalizeIdsFix, cortexIdsFix, portalProseFix, goldenLeakFix, asisPlaceholderFix, problemAsisFix, citationDedupFix, nftThresholdFix,
  stripNonSameLinksFix, customerAsisFix, whatIfSourceFix, altSourceFix, maturityFix, speculativeFtFix, risksFix, dependenciesFix, dependencyRowsFix, forWhomFix, anchorsFix,
  citationOnceFix, linkGraphFix, riskRatingFix, dependencyAddresseeFix, addresseeFormFix, seeWhatIfFix, priorityFix,
]

/**
 * Автоправки канона (без шапки и блока «Продолжить»). Без правок текст
 * возвращается тем же (разбор → сборка без изменений).
 */
export function autoFix(canon: string, ctx: CheckContext, fixes: readonly Fix[] = FIXES): { canon: string; log: string[] } {
  const log: string[] = []
  let text = canon
  for (const fix of fixes) {
    try {
      if (fix.rewrite) text = fix.rewrite(text, ctx, log)
      if (fix.apply) {
        const parsed = parseCanon(text)
        const before = log.length
        fix.apply(parsed, ctx, log)
        if (log.length > before) text = renderCanon(parsed)
      }
    } catch (e) {
      log.push(`${fix.name}: пропущена — ${(e as Error).message}`)
    }
  }
  return { canon: text, log }
}

/** Проверка документа целиком (шапка + канон + хвост). */
export interface Rule {
  code: string
  level: Level
  run(doc: ParsedCanon, ctx: CheckContext): Omit<CheckFinding, 'code' | 'level'>[]
}

/** WARN только для отчёта о качестве (deep.json): в промт повтора не идут. */
export const REPORT_ONLY: ReadonlySet<string> = new Set(['DUP001'])

const at = (line: number, section: string) => ({ line: line + 1, section })

/** C2 SK001: ID скелета bft-fast пропал из канона. */
const skeletonRule: Rule = {
  code: 'SK001', level: 'ERROR',
  run(doc, ctx) {
    const defined = new Set(typedRows(canonSections(doc)).map((r) => r.id))
    return ctx.skeleton.filter((s) => !defined.has(s.id)).map((s) => ({ message: `${s.id} из «Критичных требований» bft-fast нет в каноне — ID скелета сохраняются (смысл тот же, формулировка — наблюдаемый результат)` }))
  },
}

/**
 * C2 CV001 (ERROR, раунд 4): статус в «…» или уведомление из результата шага
 * How to demo не названы ни в одном ФТ (или в UI-колонке ИТ). Код требований
 * не дописывает — пишет модель на повторе по этой строке.
 */
const demoCoverageRule: Rule = {
  code: 'CV001', level: 'ERROR',
  run(doc, ctx) {
    return demoGaps(doc, ctx.fastMd).map(({ step, result, missing }) => ({ message: `шаг ${step} How to demo «${result.slice(0, 80)}»: ${missing.map((m) => `«${m}»`).join(', ')} нет ни в описании ФТ, ни в UI-колонке ИТ — добавь ФТ (наблюдаемое поведение: кто видит, где) или допиши в существующий ФТ; «Связанные» — ПТ/БТ` }))
  },
}

/**
 * CV005 (ERROR с раунда 6, мягкая на последней попытке): альтернативная ветка
 * alt/else сценария приёмки не закрыта ни одним ФТ. Код ФТ не пишет — модель
 * на повторе по этой строке.
 */
const branchCoverageRule: Rule = {
  code: 'CV005', level: 'ERROR',
  run(doc, ctx) {
    const plan = sectionLike(canonSections(doc), /^План демонстрации/)
    return uncoveredElse(doc, ctx.fastMd).map((label) => ({ message: `ветка «${label.slice(0, 80)}» сценария приёмки не закрыта ни одним ФТ — добавь ФТ «Поведение при {этом отказе}»; описание — только то, что о нём сказали заказчик, How to demo или находка, иначе описание целиком: [УТОЧНИТЬ у {адресат}: что видит {актор} и что происходит с данными?]. Поведение не придумывай`, ...(plan ? { section: plan.title } : {}) }))
  },
}

/** C2 CV002: у человеческого актора сценария (plantuml `actor`) нет ПТ. */
const actorCoverageRule: Rule = {
  code: 'CV002', level: 'WARN',
  run(doc) {
    const plan = sectionLike(canonSections(doc), /^План демонстрации/)
    return actorsWithoutPt(doc).without
      .map((a) => ({ message: `у актора «${a}» нет пользовательского требования (ПТ) — ни одна строка ПТ не называет его целиком`, ...(plan ? { section: plan.title } : {}) }))
  },
}

/** Строки таблиц канона с текстом строки. */
function canonRows(doc: ParsedCanon): { section: CanonSection; table: CanonTable; row: CanonRow; text: string }[] {
  return canonSections(doc).flatMap((section) => section.tables.flatMap((table) => table.rows.map((row) => ({ section, table, row, text: row.cells.join(' | ') }))))
}

/** C5 CT001: «дефект»/«баг» рядом со ссылкой на задачу, у которой тип в карте находок — не ошибка. */
const jiraTypeRule: Rule = {
  code: 'CT001', level: 'ERROR',
  run(doc, ctx) {
    const typeById = new Map(ctx.findings.filter((f) => f.kind === 'jira' && f.type).map((f) => [f.id, f.type!]))
    return canonRows(doc).flatMap(({ section, row, text }) => {
      if (!/дефект|(?<!\p{L})баг(?:и|ов|ам|а|у|ом)?(?!\p{L})/iu.test(text)) return []
      const wrong = [...new Set([...text.matchAll(MD_LINK)].map((m) => JIRA_KEY_OF(m[2]!)))].filter((k): k is string => !!k && typeById.has(k) && !BUG_TYPE.test(typeById.get(k)!))
      return wrong.map((k) => ({ message: `${k} — «${typeById.get(k)}», не ошибка: слово «дефект» только для задач типа «Ошибка»; эпик/история по тому же объекту — строка «Зависимостей» («параллельная работа: сверить объём»)`, ...at(row.line, section.title) }))
    })
  },
}

/** C5 CT002: ссылка на Jira/Confluence, которой нет среди «Ссылок для БФТ» карты находок (и в шапке fast). */
const sourceLinkRule: Rule = {
  code: 'CT002', level: 'ERROR',
  run(doc, ctx) {
    const urls = new Set(ctx.findings.map((f) => f.url))
    const ids = new Set(ctx.findings.map((f) => f.id).filter(Boolean))
    const allowed = `${ctx.fastMd}\n${(ctx.intake?.links ?? []).join('\n')}`
    const out: Omit<CheckFinding, 'code' | 'level'>[] = []
    for (const section of canonSections(doc)) {
      for (let i = section.start; i < section.end; i++) {
        for (const m of (doc.lines[i] ?? '').matchAll(MD_LINK)) {
          const url = m[2]!
          if (!CORP_URL.test(url) || urls.has(url) || ids.has(linkId(url) ?? '\0') || allowed.includes(url)) continue
          out.push({ message: `ссылка ${url} не из карты находок — ставь только «Ссылку для БФТ» находки дословно`, ...at(i, section.title) })
        }
      }
    }
    return out
  },
}

const sameFunction = (f: SourceFinding) => f.relevance === 'same_function'

/**
 * C5 CT003 (ERROR с раунда 6, мягкая на последней попытке): открытая «Ошибка»
 * той же функции (вердикт триажа) не попала в «Риски». Строку пишет модель.
 */
const bugRiskRule: Rule = {
  code: 'CT003', level: 'ERROR',
  run(doc, ctx) {
    const risks = textOf(doc, sectionLike(canonSections(doc), /^Риски/))
    return ctx.findings.filter((f) => f.kind === 'jira' && !f.via && sameFunction(f) && BUG_TYPE.test(f.type ?? '') && !CLOSED.test(f.status ?? '') && f.id && !risks.includes(f.id))
      .map((f) => ({ message: `открытая ошибка ${f.id} «${f.title.slice(0, 60)}» той же функции не в «Рисках» — добавь строку: «Открытая ошибка ${f.citation}: {что ломается для актора}», Вероятность/Влияние — [УТОЧНИТЬ у PO], митигация — [УТОЧНИТЬ у PO: исправляется до запуска?]` }))
  },
}

/** C5 CT004: существующее решение той же функции/системы не отражено ни в «Рисках», ни в «Зависимостях». */
const existingSolutionRule: Rule = {
  code: 'CT004', level: 'WARN',
  run(doc, ctx) {
    const sections = canonSections(doc)
    const text = `${textOf(doc, sectionLike(sections, /^Риски/))}\n${textOf(doc, sectionLike(sections, /^Зависимости/))}`
    return existingSolutions(ctx.findings).filter((f) => !cites(text, f))
      .map((f) => ({ message: `решение того же действия ${f.citation} не названо ни в «Рисках», ни в «Зависимостях» — если оно про тот же объект и ту же систему, что заявка: строка «Рисков» «Пересечение с решением ${f.citation}: расширяем, заменяем или строим отдельно» (оценки — [УТОЧНИТЬ у PO]) и сверка с ASIS в «Было» шага UJM; если заявка на него только опирается — строка «Зависимостей» «Опирается на ${f.citation}: {факт}»` }))
  },
}

/** CT005: в «Рисках» — ссылка на находку не той же системы/функции (смежная, вторым шагом, закрытая ошибка). */
const riskLinkRule: Rule = {
  code: 'CT005', level: 'ERROR',
  run(doc, ctx) {
    const risks = sectionLike(canonSections(doc), /^Риски/)
    return (risks?.tables ?? []).flatMap((t) => t.rows.flatMap((r) => [...r.cells.join(' ').matchAll(MD_LINK)]
      .map((m) => findingOf(m[2]!, ctx.findings)).filter((f): f is SourceFinding => !!f && !riskWorthy(f, ctx.findings))
      .map((f) => ({ message: `${f.id || f.title.slice(0, 40)} — не основание риска (${riskWhy(f)}): только «Зависимости» («сверить») или «Якоря» R2`, ...at(r.line, risks!.title) }))))
  },
}

/** CT006: утверждение о существующем решении ссылается на находку без вердикта «та же функция/система». */
const existingClaimRule: Rule = {
  code: 'CT006', level: 'WARN',
  run(doc, ctx) {
    return canonRows(doc).flatMap(({ section, row, text }) => {
      if (!/пересечени|существующ/i.test(text) || !ctx.findings.some((f) => f.relevance)) return []
      return [...text.matchAll(MD_LINK)].map((m) => findingOf(m[2]!, ctx.findings)).filter((f): f is SourceFinding => !!f && !isSame(f))
        .map((f) => ({ message: `«существующее решение» со ссылкой на ${f.id || f.title.slice(0, 40)}, а триаж отнёс её к «${f.relevance ?? 'без вердикта'}»`, ...at(row.line, section.title) }))
    })
  },
}

/** RK003 (документ портала): строка «Рисков» без ссылки на находку и без слов заказчика или повтор пункта согласования. */
const riskSourceRule: Rule = {
  code: 'RK003', level: 'ERROR',
  run(doc, ctx) {
    if (!portal(ctx)) return []
    const risks = sectionLike(canonSections(doc), /^Риски/)
    const items = workItems(ctx)
    const said = [...customerStrings(ctx), ...(ctx.po ?? [])]
    return (risks?.tables ?? []).flatMap((t) => t.rows.filter((r) => {
      const good = [...r.cells.join(' ').matchAll(MD_LINK)].some((m) => { const f = findingOf(m[2]!, ctx.findings); return !!f && riskWorthy(f, ctx.findings) })
      const name = unmark(r.cells[0] ?? '')
      return !good && (!!workItemOf(name, items) || !saidRisk(name, said))
    }).map((r) => ({ message: `риск «${unmark(r.cells[0] ?? '').slice(0, 60)}» — ни ссылки на находку, ни слов заказчика (согласование/проработка — строка «Зависимостей»)`, ...at(r.line, risks!.title) })))
  },
}

/** PV001 (документ портала): статус «в работе»/«подтверждено»/«согласовано» в «Зависимостях» без источника. */
const provenanceRule: Rule = {
  code: 'PV001', level: 'ERROR',
  run(doc, ctx) {
    if (!portal(ctx)) return []
    const deps = sectionLike(canonSections(doc), /^Зависимости/)
    const said = [...customerStrings(ctx), ...(ctx.po ?? [])]
    return (deps?.tables ?? []).flatMap((t) => t.rows.filter((r) => r.cells.slice(1).some((c) => clausesOf(c).some((x) => unsourcedClaim(x, said))))
      .map((r) => ({ message: `«${unmark(r.cells[0] ?? '').slice(0, 40)}»: статус без источника — «в работе», «подтверждено», «согласовано» пишется только со ссылкой или словами заказчика, иначе [УТОЧНИТЬ у {команда}: статус?]`, ...at(r.line, deps!.title) })))
  },
}

/** CV003: система из «Команд» шапки, на которую действует ФТ, не участник сценария приёмки. */
const participantRule: Rule = {
  code: 'CV003', level: 'WARN',
  run(doc, ctx) {
    const sections = canonSections(doc)
    const plan = sectionLike(sections, /^План демонстрации/)
    const uml = (textOf(doc, plan).match(/```plantuml\s*\n[\s\S]*?\n\s*```/g)?.join('\n') ?? '').toLowerCase()
    if (!uml) return []
    const ft = ftRows(doc).map((r) => `${r.name} ${r.desc}`).join('\n').toLowerCase()
    return teamsOf(ctx.fastMd).map(systemName).filter((t) => t.length >= 3)
      .filter((t) => ft.includes(t.toLowerCase()) && !uml.includes(t.toLowerCase()))
      .map((t) => ({ message: `«${t}» — система из «Команд», на неё действует ФТ, но в сценарии приёмки её нет: участник plantuml (внешняя система как целое) с шагом, который видит актор`, ...(plan ? { section: plan.title } : {}) }))
  },
}

/** FC001: на ячейку с [УТОЧНИТЬ] отвечает факт существующего решения (число/ограничение) — сошлись или объясни расхождение. */
const answerableRule: Rule = {
  code: 'FC001', level: 'WARN',
  run(doc, ctx) {
    return answerableCells(doc, ctx.findings, ctx.fastMd).map((a) => ({ message: `${a.id}: [УТОЧНИТЬ], а в ${a.finding.citation} сказано «${a.fact.quote.slice(0, 100)}» — сошлись на находку или объясни расхождение` }))
  },
}

/** Колонки с содержательными ячейками для UT001: раздел → какие колонки. */
function contentColumns(section: CanonSection, table: CanonTable): number[] {
  const all = table.header.map((_, i) => i)
  const not = (...cols: number[]) => all.filter((i) => !cols.includes(i))
  const t = section.title
  if (/^Функциональные требования/.test(t)) return [columnOf(table, 'Параметры')].filter((c) => c >= 0)
  if (/^Нефункциональные требования/.test(t)) return [columnOf(table, 'Описание')].filter((c) => c >= 0)
  if (/^Требования к интерфейсам/.test(t)) return not(0, 1, columnOf(table, 'Связанные'))
  if (/^Зависимости/.test(t)) return not(0)
  if (/^Риски/.test(t)) return not(columnOf(table, 'Вероятность'), columnOf(table, 'Влияние'))
  if (/^План демонстрации/.test(t) && /what-if|что если/i.test(table.header[0] ?? '')) return [columnOf(table, 'Результат')].filter((c) => c >= 0)
  return []
}

/** C9 UT001: голый маркер или маркер без вопроса и без текста в содержательной ячейке. */
const markerRule: Rule = {
  code: 'UT001', level: 'WARN',
  run(doc) {
    const out: Omit<CheckFinding, 'code' | 'level'>[] = []
    for (const section of canonSections(doc)) {
      for (const table of section.tables) {
        for (const c of contentColumns(section, table)) {
          for (const row of table.rows) {
            const cell = row.cells[c] ?? ''
            const markers = (cell.match(/\[УТОЧНИТЬ[^\]]*\]/g) ?? []).filter((m) => !/не опубликовано/.test(m))
            if (!markers.length) continue
            const rest = cell.replace(/`?\[УТОЧНИТЬ[^\]]*\]`?/g, '').replace(/[\s.,;:!?—–()-]+/g, '')
            const bare = markers.some((m) => m === '[УТОЧНИТЬ]')
            const empty = !rest && markers.every((m) => !m.includes(':'))
            if (bare || empty) out.push({ message: `${row.cells[0]?.slice(0, 40) ?? ''}: маркер без адресата или без вопроса — [УТОЧНИТЬ у {кого}: {что нужно}?]`, ...at(row.line, section.title) })
          }
        }
      }
    }
    return out
  },
}

/** C10 FT002: ФТ — короткая фраза без условия приёмки (в «Параметрах» только маркер). */
const ftVerifiableRule: Rule = {
  code: 'FT002', level: 'WARN',
  run(doc) {
    const section = sectionLike(canonSections(doc), /^Функциональные требования/)
    return (section?.tables ?? []).flatMap((table) => {
      const [desc, params] = [columnOf(table, 'Функциональные'), columnOf(table, 'Параметры')]
      if (desc < 0 || params < 0) return []
      return table.rows.filter((r) => TYPED_ID.test(r.cells[0] ?? '')).filter((r) => {
        const words = (r.cells[desc] ?? '').match(/[\p{L}\p{N}]+/gu) ?? []
        const rest = (r.cells[params] ?? '').replace(/`?\[УТОЧНИТЬ[^\]]*\]`?/g, '').replace(/[\s.,;:!?—–()-]+/g, '')
        return words.length < 8 && !rest
      }).map((r) => ({ message: `${r.cells[0]}: описание короче 8 слов, в «Параметрах» нет условия приёмки — как проверить на демо?`, ...at(r.line, section!.title) }))
    })
  },
}

/** Фразы из 6+ слов в 4+ разделах канона (без plantuml и «Якорей»). */
export function dupPhrases(parsed: ParsedCanon): string[] {
  const seen = new Map<string, Set<string>>()
  for (const s of parsed.sections) {
    if (!s.title || /Якоря истины|Продолжить/.test(s.title)) continue
    const text = parsed.lines.slice(s.start + 1, s.end).join('\n').replace(/```[\s\S]*?```/g, ' ')
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    const local = new Set<string>()
    for (let i = 0; i + 6 <= words.length; i++) local.add(words.slice(i, i + 6).join(' '))
    for (const k of local) {
      if (!seen.has(k)) seen.set(k, new Set())
      seen.get(k)!.add(s.title)
    }
  }
  return [...seen.entries()].filter(([, v]) => v.size >= 4).map(([k]) => k)
}

/** C10 DUP001 (только отчёт): одна и та же фраза в 4+ разделах. */
const dupRule: Rule = {
  code: 'DUP001', level: 'WARN',
  run(doc) {
    const sections = canonSections(doc)
    const phrases = dupPhrases({ lines: doc.lines, sections })
    return phrases.length ? [{ message: `повторы между разделами (${phrases.length}): «${phrases.slice(0, 3).join('», «')}»` }] : []
  },
}

/**
 * Утечки внутренней кухни в документ портала (план C8): loopback-адрес, пути
 * навыка (`.claude/`, `/opt/bft-skills`), «ушёл ответом в чат» (в портале
 * такого чата нет). По всему документу, включая fenced-блоки.
 */
export const LEAKS: readonly { re: RegExp; what: string }[] = [
  { re: /https?:\/\/(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?![\w.-])/i, what: 'адрес на этой же машине (loopback) — у читателя не откроется' },
  { re: /(?:^|[\s(`'"])\.claude\//, what: 'путь навыка Claude Code (.claude/)' },
  { re: /\/opt\/bft-skills/, what: 'каталог навыков в образе портала (/opt/bft-skills)' },
  { re: /уш(?:[её]л|ли)\s+ответом\s+в\s+чат/i, what: '«ушёл ответом в чат» — в портале вопросы в чат не уходят' },
]

/** C8 LK001: утечка внутренней кухни (по всему документу, не в bft-lint: правило сломало бы эталон навыка). */
const leakRule: Rule = {
  code: 'LK001', level: 'ERROR',
  run(doc) {
    const out: Omit<CheckFinding, 'code' | 'level'>[] = []
    doc.lines.forEach((line, i) => {
      for (const leak of LEAKS) {
        const m = leak.re.exec(line)
        if (m) out.push({ message: `${leak.what}: «${m[0].trim().slice(0, 60)}» — убрать из документа`, line: i + 1 })
      }
    })
    return out
  },
}

/** CT007: находка упомянута словами («корпоративная находка», её название) без markdown-ссылки. */
const unlinkedFindingRule: Rule = {
  code: 'CT007', level: 'WARN',
  run(doc, ctx) {
    // Находка, у которой в каноне уже есть ссылка, дальше называется подписью (одна находка — одна ссылка).
    const linked = new Set([...doc.lines.join('\n').matchAll(MD_LINK)].map((m) => findingOf(m[2]!, ctx.findings)).filter(Boolean))
    const known = ctx.findings.filter((f) => f.relevance !== 'unrelated')
    if (!known.length) return []
    const pool = known.filter((f) => !linked.has(f))
    return canonRows(doc).filter(({ section }) => section.title.replace(/\*+$/, '').trim() !== ANCHORS_TITLE).flatMap(({ section, row }) => {
      const plain = row.cells.join(' | ').replace(MD_LINK, ' ')
      const mention = /орпоративн\p{L}*\s+(?:находк|источник)/u.test(plain)
      const titled = pool.find((f) => f.title.length >= 20 && plain.toLowerCase().includes(f.title.toLowerCase().slice(0, 40)))
      if (!mention && !titled) return []
      return [{ message: `${unmark(row.cells[0] ?? '').slice(0, 40)}: находка ${titled ? `«${titled.title.slice(0, 50)}» ` : ''}упомянута словами без ссылки — ставь её «Ссылку для БФТ»`, ...at(row.line, section.title) }]
    })
  },
}

/** CV004: happy path сценария — на основной линии или в ветке, и не после ветки-отказа. */
const happyPathRule: Rule = {
  code: 'CV004', level: 'WARN',
  run(doc, ctx) {
    const uml = parseUml(doc)
    const branches = uml.branches
    if (!branches.length) return []
    const happySet = happyBranches(uml, ctx.fastMd)
    const out: Omit<CheckFinding, 'code' | 'level'>[] = []
    for (const group of new Set(branches.map((b) => b.group))) {
      const own = branches.filter((b) => b.group === group)
      const happy = own.filter((b) => happySet.has(b))
      const firstAlt = own.findIndex((b) => !happySet.has(b))
      if (happy.length && firstAlt >= 0 && own.indexOf(happy[0]!) > firstAlt) {
        out.push({ message: `ветка «${happy[0]!.label}» — happy path после ветки-отказа «${own[firstAlt]!.label}»: успех — на основной линии или первой веткой alt, отклонения — в else` })
      }
    }
    return out
  },
}

/** FT003: ФТ без происхождения — ни ID скелета, ни находки, ни шага How to demo, ни альтернативной ветки. */
const ftOriginRule: Rule = {
  code: 'FT003', level: 'WARN',
  run(doc, ctx) {
    if (!portal(ctx)) return []
    return ftWithoutOrigin(doc, ctx).map((id) => ({ message: `${id}: требование не следует ни из скелета, ни из шага How to demo, ни из ветки сценария, ни из находки — гипотезу оставь маркером в строке «что если»` }))
  },
}

/** MT001 (WARN, раунд 4): «уже работает/внедрено» рядом с находкой, где решение только описано. */
const maturityRule: Rule = {
  code: 'MT001', level: 'WARN',
  run(doc, ctx) {
    const described = ctx.findings.filter((f) => isSame(f) && !maturityOf(f).operating)
    if (!described.length) return []
    return canonRows(doc).filter(({ section }) => !/^(?:Якоря истины|Риски)/.test(section.title)).flatMap(({ section, row, text }) => {
      const f = described.find((x) => cites(text, x) || (x.title.length >= 12 && text.includes(x.title)))
      if (!f || !/уже\s+(?:работает|внедрен\p{L}*|есть)|(?<![\p{L}])внедр[её]н\p{L}*/iu.test(text.replace(/Уже есть:/g, ''))) return []
      return [{ message: `${unmark(row.cells[0] ?? '').slice(0, 40)}: зрелость не из источника — ${f.id || f.title.slice(0, 40)} описывает решение (статус в источнике: ${maturityOf(f).status}); пиши «описано в {ссылка} (статус в источнике: …)»`, ...at(row.line, section.title) }]
    })
  },
}

/** UML001 (ERROR, раунд 4): строка без оператора plantuml внутри блока сценария — диаграмма не соберётся. */
const plantumlRule: Rule = {
  code: 'UML001', level: 'ERROR',
  run(doc) {
    return umlUnknown(doc.lines.join('\n')).map(({ i, text }) => ({ message: `plantuml: «${text.trim().slice(0, 60)}» — не оператор диаграммы (сообщение «A -> B: текст», note over, alt/else/end): диаграмма не соберётся`, line: i + 1 }))
  },
}

/** Базовое значение эффекта, которое назвал заказчик (metric.now или число в словах о текущем состоянии), а канон его не называет. */
export function missingBaseline(canon: string, primary: PrimaryLike | undefined): string | undefined {
  const a = primary?.args
  const base = a?.metric?.now?.trim() || baselineOf(presentState(a?.want?.quote))
  if (!base) return undefined
  const norm = (t: string) => t.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
  return norm(canon).includes(norm(base)) ? undefined : base
}

/** EF001 (WARN, раунд 4): заказчик назвал базовое значение эффекта, а показатель эффекта БТ/«Проблемы» его не называет. */
const baselineRule: Rule = {
  code: 'EF001', level: 'WARN',
  run(doc, ctx) {
    if (!portal(ctx)) return []
    const base = missingBaseline(doc.lines.join('\n').replace(/^[\s\S]*?(?=^## Проблема которую решаем)/m, ''), ctx.primary)
    return base ? [{ message: `заказчик назвал базовое значение «${base}» — показатель эффекта (ПРОБЛЕМА, ценность БТ): «сейчас — ${base}», целевое — [УТОЧНИТЬ у {заказчик}: …?]` }] : []
  },
}

/**
 * AN101 (WARN, раунд 6): находка той же системы/функции с фактом процитирована
 * ссылкой в тексте БФТ, а строки R2 в «Якорях» нет. Строку пишет модель.
 */
const r2AnchorRule: Rule = {
  code: 'AN101', level: 'WARN',
  run(doc, ctx) {
    const section = sectionLike(canonSections(doc), new RegExp(`^${ANCHORS_TITLE}`))
    const existing = (section?.tables ?? []).flatMap((t) => t.rows.map((r) => r.cells.join(' ')))
    return r2Rows(doc, ctx, existing).map((g) => ({ message: `${g.source.slice(0, 120)} процитирована в тексте, а в «Якорях» нет строки R2 — добавь: «${g.fact.slice(0, 60)}» | ссылка и дословная цитата факта | R2 | ${g.type}`, ...(section ? { section: section.title } : {}) }))
  },
}

/** DP001 (WARN, раунд 6): пункт «Согласования» из приёма заявки не назван в «Зависимостях». */
const approvalDependencyRule: Rule = {
  code: 'DP001', level: 'WARN',
  run(doc, ctx) {
    if (!portal(ctx)) return []
    const deps = textOf(doc, sectionLike(canonSections(doc), /^Зависимости/))
    const rows = deps.split('\n').filter((l) => l.trim().startsWith('|'))
    return (ctx.primary?.args?.achievable?.approvals ?? []).filter((x): x is string => typeof x === 'string' && !!x.trim())
      .filter((x) => !rows.some((r) => similarity(x, r) >= 0.5))
      .map((x) => ({ message: `согласование «${x.slice(0, 80)}» из заявки нет в «Зависимостях» — строка: кто согласует, что, статус [УТОЧНИТЬ у {адресат}: статус?]` }))
  },
}

/** Правила портала. ERROR — только детерминированные (повтор модели); эвристики — WARN. */
export const RULES: Rule[] = [
  skeletonRule, skeletonMeaningRule, jiraTypeRule, sourceLinkRule, riskLinkRule, riskSourceRule, provenanceRule, demoCoverageRule, branchCoverageRule, actorCoverageRule, participantRule,
  bugRiskRule, existingSolutionRule, existingClaimRule, answerableRule, markerRule, ftVerifiableRule, dupRule, leakRule,
  unlinkedFindingRule, happyPathRule, ftOriginRule, maturityRule, plantumlRule, baselineRule, r2AnchorRule, approvalDependencyRule,
]

export function check(fullDoc: string, ctx: CheckContext, rules: readonly Rule[] = RULES): { errors: CheckFinding[]; warnings: CheckFinding[] } {
  const parsed = parseCanon(fullDoc)
  const errors: CheckFinding[] = []
  const warnings: CheckFinding[] = []
  for (const rule of rules) {
    let found: Omit<CheckFinding, 'code' | 'level'>[]
    try {
      found = rule.run(parsed, ctx)
    } catch (e) {
      found = [{ message: `правило упало: ${(e as Error).message}` }]
    }
    for (const f of found) (rule.level === 'ERROR' ? errors : warnings).push({ code: rule.code, level: rule.level, ...f })
  }
  return { errors, warnings }
}

/** Замечание одной строкой — как у bft-lint.py: «строка: УРОВЕНЬ КОД сообщение». */
export function formatFinding(f: { line?: number; level: string; code: string; message: string }): string {
  return `${f.line ? `${f.line}: ` : ''}${f.level} ${f.code} ${f.message}`
}
