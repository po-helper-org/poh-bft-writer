/**
 * Метрики качества полного БФТ (план качества, раздел «Метрики по раундам»).
 *
 * Чистая функция по файлам одной заявки: deep-документ, bft-fast, карта
 * находок (sources.md), primary.json, intake.json, отчёт сборки (deep.json).
 * Раунды сравниваются diff'ом metrics.json. Метрики, которым нужен триаж или
 * ручная разметка (irrelevant_share, precision@5, citation_precision), — null,
 * пока их не даст код (план C4).
 *
 * Эвристики (покрытие демо, alt, акторы) сравнивают основы слов — их задача
 * показать движение между раундами, а не дать абсолютную оценку.
 */
import { columnOf, ID_RE, parseCanon, sectionOf, type CanonTable, type ParsedCanon } from './canon-table.js'
import {
  actorsWithoutPt, answerableCells, asisKnown as asisKnownOf, cites, demoGaps, demoResults, droppedSources, dupPhrases, elseLabels, goldenLeaks,
  ftWithoutOrigin, missingBaseline, parseSkeleton, parseSources, problemClaims, uncoveredElse, unsurfacedExisting, type Intake, type PrimaryLike,
  asisUnreconciled, skeletonDrift, whatIfFalseNegatives,
} from './canon-check.js'
import { baselineOf, presentState } from './present.js'

export { demoResults }

export interface QualityInput {
  /** Полный документ deep (шапка + канон + «Продолжить»). */
  doc: string
  fastMd: string
  sourcesMd?: string
  contextMd?: string
  /** primary.json (PrimaryDoc) — как есть, без строгой схемы. */
  primary?: unknown
  intake?: Intake
  quality?: {
    attempts?: number
    lintErrorsByAttempt?: number[]
    checkErrorsByAttempt?: number[]
    warnings?: { code: string }[]
    questions?: unknown[]
  }
  stage?: string
  reconMs?: number
  /** Канон эталона навыка — для golden_ngram_leaks; нет — метрика null. */
  golden?: string
}

export type MetricValue = number | boolean | null
export interface QualityReport {
  metrics: Record<string, MetricValue>
  details: Record<string, unknown>
}

const CANON_HEAD = '## Проблема которую решаем'
const CONTINUE_HEAD = '## Продолжить / уточнить БФТ'

/** Канон: от «Проблемы» до блока «Продолжить». */
export function canonOf(doc: string): string {
  const start = doc.indexOf(CANON_HEAD)
  if (start < 0) return ''
  const end = doc.indexOf(CONTINUE_HEAD, start)
  return doc.slice(start, end < 0 ? undefined : end)
}

const STOP = new Set(['котор', 'чтобы', 'когда', 'после', 'перед', 'через', 'также', 'может', 'нужно', 'будет', 'этого', 'этому', 'всех', 'есть', 'нет', 'или', 'для', 'при', 'без'])

/** Основы слов: нижний регистр, от 4 букв, кириллица — первые 5 букв. */
export function stemsOf(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length < 4) continue
    const s = /^[a-z0-9]+$/.test(w) ? w : w.slice(0, 5)
    if (!STOP.has(s)) out.add(s)
  }
  return out
}

/** Доля основ `text`, найденных в `pool`; пустой текст — покрыт. */
function overlap(text: string, pool: Set<string>): number {
  const s = [...stemsOf(text)]
  return s.length ? s.filter((x) => pool.has(x)).length / s.length : 1
}

const tablesIn = (parsed: ParsedCanon, title: string): CanonTable[] => sectionOf(parsed, title)?.tables ?? []
const idRows = (parsed: ParsedCanon, title: string, prefix: string) =>
  tablesIn(parsed, title).flatMap((t) => t.rows.filter((r) => new RegExp(`^${prefix}-\\d+$`).test(r.cells[0] ?? '')).map((r) => ({ table: t, cells: r.cells })))

const fenced = (text: string, lang: string): string[] => [...text.matchAll(new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```', 'g'))].map((m) => m[1]!)

const TECH = /(?<![\p{L}])(?:(?:стрим|топик|kafka|очеред|эндпоинт|бэкенд)\p{L}*|(?:API|REST|BE|БД)(?![\p{L}]))/giu
const TECH_ONE = new RegExp(TECH.source, 'iu')
const PLACEHOLDER = /^`?\[ASIS не озвучен[^\]]*\]`?/
const LINK = /\[[^\]\n]+\]\((https?:[^)\s]+)\)/g
const RATING = /^(?:высок|средн|низк)/i

function count<T>(items: T[], pred: (x: T) => boolean): number {
  return items.filter(pred).length
}

const share = (n: number, d: number): number | null => (d ? Math.round((n / d) * 1000) / 1000 : null)

export function qualityMetrics(input: QualityInput): QualityReport {
  const canon = canonOf(input.doc)
  const parsed = parseCanon(canon)
  const fast = parseCanon(input.fastMd)
  const sourcesMd = input.sourcesMd ?? ''
  const findings = parseSources(sourcesMd)
  const skeleton = parseSkeleton(input.fastMd)
  const primary = (input.primary ?? {}) as { args?: Record<string, unknown>; checklist?: string[] }
  const args = (primary.args ?? {}) as { want?: { asis?: string }; requirements?: { asis?: string }[]; deadline?: unknown }
  const details: Record<string, unknown> = {}

  // ── Стабильность
  const q = input.quality ?? {}
  const lintFirst = q.lintErrorsByAttempt?.[0]
  const checkFirst = q.checkErrorsByAttempt?.[0] ?? 0
  const warningsByCode: Record<string, number> = {}
  for (const w of q.warnings ?? []) warningsByCode[w.code] = (warningsByCode[w.code] ?? 0) + 1
  details.warnings_by_code = warningsByCode

  // ── Определённые ID и ссылки на них
  const defined = new Set<string>()
  for (const s of parsed.sections) for (const t of s.tables) for (const r of t.rows) if (/^(?:БТ|ПТ|ИТ|ФТ|НФТ)-\d+$/.test(r.cells[0] ?? '')) defined.add(r.cells[0]!)
  const referenced = new Set(canon.match(ID_RE) ?? [])
  const dangling = [...referenced].filter((id) => !defined.has(id))
  details.dangling_ids = dangling
  const skeletonMissing = skeleton.map((s) => s.id).filter((id) => !defined.has(id))
  details.skeleton_ids_missing = skeletonMissing

  // ── Покрытие сценария
  const reqText = ['Пользовательские требования', 'Требования к интерфейсам', 'Функциональные требования']
    .flatMap((t) => tablesIn(parsed, t)).flatMap((t) => t.rows.map((r) => r.cells.join(' ')))
  const reqPool = stemsOf(reqText.join(' '))
  const results = demoResults(input.fastMd)
  // Результат шага покрыт: половина его основ есть в ПТ/ИТ/ФТ, и каждый статус в «…» и уведомление названы там же.
  // Статусы в «…» и уведомление — только в описании ФТ или UI-колонке ИТ (не в комментарии ПТ): та же функция, что у CV001.
  const gaps = new Set(demoGaps(parsed, input.fastMd).map((g) => g.result))
  const uncovered = results.filter((r) => overlap(r, reqPool) < 0.5 || gaps.has(r))
  details.demo_uncovered = uncovered
  const plantuml = fenced(canon, 'plantuml').join('\n')
  // Альтернативные ветки alt/else (не happy path) — закрыты ФТ (наименование + описание одной строки, та же полярность);
  // строки «что если» не в счёт. Та же функция, что у автоправки.
  const alts = elseLabels(parsed, input.fastMd)
  const altUncovered = uncoveredElse(parsed, input.fastMd)
  // ФТ без происхождения: ни ID скелета, ни ссылки на находку, ни шага How to demo, ни альтернативной ветки.
  const noOrigin = ftWithoutOrigin(parsed, { skeleton, fastMd: input.fastMd })
  details.ft_without_origin = noOrigin
  details.alt_uncovered = altUncovered
  const whatIf = tablesIn(parsed, 'План демонстрации').filter((t) => /what-if|что если/i.test(t.header[0] ?? ''))
  const whatIfRows = whatIf.flatMap((t) => t.rows.map((r) => r.cells))
  // Актор покрыт, если все основы его имени есть в одной строке ПТ (та же функция, что у CV002).
  const actorCheck = actorsWithoutPt(parsed)
  const humans = actorCheck.actors
  const actorsNoPt = actorCheck.without
  details.actors_without_PT = actorsNoPt
  const related = (cells: string[], table: CanonTable) => {
    const col = columnOf(table, 'Связанные')
    return col >= 0 ? cells[col] ?? '' : cells[cells.length - 1] ?? ''
  }
  const itRows = idRows(parsed, 'Требования к интерфейсам', 'ИТ')
  const nftRows = idRows(parsed, 'Нефункциональные требования', 'НФТ')
  // Строка «что если» с «Нет» и адресным маркером — открытый вопрос (в списке вопросов), а не пробел без адреса.
  const whatIfUnref = whatIfRows.filter((c) => /^(?:нет|частично)/i.test((c[1] ?? '').replace(/`/g, '').trim()) && !/\[УТОЧНИТЬ у [^\]]+\]/.test(c[2] ?? '')
    && !/(?<![А-ЯЁ])(?:БТ|ПТ|ИТ|ФТ|НФТ)-\d+|\(см\.\s*«/.test(c[2] ?? ''))

  // ── Опора на источники: ASIS
  const asisKnown = asisKnownOf(primary as PrimaryLike, input.intake)
  const ujm = tablesIn(parsed, 'Изменение в UJM')
  const asisCells = [
    ...ujm.flatMap((t) => { const c = columnOf(t, 'Было'); return c >= 0 ? t.rows.map((r) => r.cells[c] ?? '') : [] }),
    ...tablesIn(parsed, 'Проблема которую решаем').flatMap((t) => t.rows.filter((r) => /ASIS/.test(r.cells[0] ?? '')).map((r) => r.cells[1] ?? '')),
  ]
  const placeholders = asisCells.filter((c) => PLACEHOLDER.test(c.trim()))
  const invented = placeholders.filter((c) => {
    const rest = c.trim().replace(PLACEHOLDER, '').replace(/^[\s—–\-:;,.]+/, '')
    return rest.length > 0 && !/\]\(https?:/.test(rest)
  })
  // ASIS не озвучен, а «ПРОБЛЕМА» утверждает текущее состояние («сейчас нет», «не готов») — тоже выдуманный ASIS.
  const problemInvented = input.primary ? problemClaims(parsed, { primary: primary as PrimaryLike, ...(input.intake ? { intake: input.intake } : {}) })?.claims ?? [] : []
  details.problem_invented_asis = problemInvented

  const baselineKnown = !!((primary as PrimaryLike).args?.metric?.now?.trim() || baselineOf(presentState((primary as PrimaryLike).args?.want?.quote)))

  // ── Числа и латиница без источника
  const sourcePool = `${input.fastMd}\n${sourcesMd}\n${input.contextMd ?? ''}`.toLowerCase()
  // Даты (DD.MM.YYYY, YYYY-MM-DD, DD.MM) — из якорей и находок, не «число без источника»; As-Is/To-Be — заголовки канона.
  const canonPlain = canon.replace(/\]\([^)]*\)/g, ']').replace(/```[\s\S]*?```/g, ' ').replace(ID_RE, ' ')
    .replace(/(?<![\p{N}])(?:\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?|\d{1,2}\.\d{2}(?=[–-]\d))(?![\p{N}])/gu, ' ')
  const tokens = new Set([...(canonPlain.match(/(?<![\p{L}\p{N}])(?:\d+(?:[.,]\d+)?|[A-Za-z][A-Za-z0-9_.-]{2,})(?![\p{L}\p{N}])/gu) ?? [])])
  const ignored = /^(?:ASIS|TOBE|As-Is|To-Be|UJM|SMART|What-if|alt|else|happy|path|plantuml|Jira|Confluence|Story|R[23]|UI|http|https|PDF)$/i
  const unsourced = [...tokens].filter((t) => !ignored.test(t) && !/^\d{1,2}$/.test(t) && !sourcePool.includes(t.toLowerCase()))
  details.unsourced_tokens = unsourced.slice(0, 30)

  // ── ФТ: приоритет, жаргон
  const ftRows = idRows(parsed, 'Функциональные требования', 'ФТ')
  const barePriority = ftRows.filter(({ table, cells }) => {
    const c = columnOf(table, 'Приоритет')
    return c >= 0 && /^(?:высокий|средний|низкий)$/i.test((cells[c] ?? '').trim())
  })
  const ftDesc = ftRows.map(({ table, cells }) => { const c = columnOf(table, 'Функциональные'); return c >= 0 ? cells[c] ?? '' : cells.join(' ') })
  const techInFt = ftDesc.reduce((n, d) => n + (d.match(TECH)?.length ?? 0), 0)
  const dp006 = plantuml.split('\n').filter((l) => /^\s*(?:actor|participant|database|queue|entity|collections|boundary|control)\b|->|-->/.test(l) && TECH_ONE.test(l)).length

  // ── Риски
  const riskRows = tablesIn(parsed, 'Риски').flatMap((t) => {
    const [p, i] = [columnOf(t, 'Вероятность'), columnOf(t, 'Влияние')]
    return t.rows.map((r) => ({ cells: r.cells, rated: (p >= 0 && RATING.test(r.cells[p] ?? '')) || (i >= 0 && RATING.test(r.cells[i] ?? '')) }))
  })
  const riskUnconfirmed = riskRows.filter((r) => r.rated && !/(?<!не )подтвержд/i.test(r.cells.join(' ')) && !/\]\(https?:/.test(r.cells.join(' ')))

  // ── Ссылки на находки
  const citeUrls = new Set(findings.map((f) => f.url))
  const citeIds = new Set(findings.map((f) => f.id).filter(Boolean))
  const links = [...canon.matchAll(LINK)].map((m) => ({ label: m[0], url: m[1]! }))
  const corpLinks = links.filter((l) => /\/browse\/[A-Z]|pageId=|\/display\/|\/pages\//.test(l.url))
  const linkId = (url: string) => /\/browse\/([A-Z][A-Z0-9_]+-\d+)/.exec(url)?.[1] ?? /pageId=(\d+)/.exec(url)?.[1]
  const notInSources = corpLinks.filter((l) => !citeUrls.has(l.url) && !citeIds.has(linkId(l.url) ?? '\0'))
  details.R2_link_not_in_sources = notInSources.map((l) => l.url)
  const typeById = new Map(findings.filter((f) => f.kind === 'jira').map((f) => [f.id, f.type ?? '']))
  const canonRows = parsed.sections.flatMap((s) => s.tables.flatMap((t) => t.rows.map((r) => r.cells.join(' | '))))
  const typeMismatch = canonRows.filter((row) => /дефект|баг/i.test(row) && [...row.matchAll(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/g)]
    .some((m) => { const t = typeById.get(m[1]!); return t !== undefined && t !== '' && !/ошибк|bug|баг|дефект/i.test(t) }))

  // Триаж (C4): отсеянные, ссылки на находки «та же система/функция», открытые ошибки той же функции вне «Рисков».
  const dropped = droppedSources(sourcesMd)
  const triagedTotal = findings.filter((f) => f.relevance).length + dropped
  const sameIds = new Set(findings.filter((f) => f.relevance === 'same_system' || f.relevance === 'same_function').map((f) => f.id).filter(Boolean))
  const sameCited = corpLinks.filter((l) => sameIds.has(linkId(l.url) ?? '\0'))
  const risksSection = parsed.sections.find((section) => /Риски/.test(section.title))
  const risksText = risksSection ? canon.split('\n').slice(risksSection.start, risksSection.end).join('\n') : ''
  const canonBody = canon.slice(0, canon.indexOf('## Якоря истины') < 0 ? undefined : canon.indexOf('## Якоря истины'))
  const unsurfaced = unsurfacedExisting(canon, findings)
  details.existing_solution_unsurfaced = unsurfaced.map((f) => f.id || f.title)
  const answerable = answerableCells(parsed, findings, input.fastMd)
  details.answerable_utochnit = answerable.map((a) => `${a.id}: ${a.finding.id || a.finding.title}`)
  // Раунд 5: «что если» с «Нет» при ответе в находке; ASIS без работающего решения рядом; ID скелета с другим смыслом.
  const whatIfMissed = whatIfFalseNegatives(parsed, findings, input.fastMd)
  details.whatif_false_negative = whatIfMissed.map((w) => `${w.row}: ${w.finding.id || w.finding.title}`)
  const asisGap = asisUnreconciled(parsed, { findings, fastMd: input.fastMd, primary: input.primary as PrimaryLike | undefined, intake: input.intake })
  if (asisGap) details.asis_unreconciled = [asisGap.id || asisGap.title]
  const drift = skeletonDrift(parsed, { skeleton: parseSkeleton(input.fastMd), fastMd: input.fastMd })
  details.anchor_quote_mismatch = drift.map((d) => `${d.id}: ${d.tobe}`)
  const bugsMissing = findings.filter((f) => f.kind === 'jira' && f.relevance === 'same_function' && /ошибк|bug|дефект/i.test(f.type ?? '') && !/закрыт/i.test(f.status ?? '') && !risksText.includes(f.id))
  details.same_function_bug_missing_in_risks = bugsMissing.map((f) => f.id)

  // ── Якоря
  const anchors = tablesIn(parsed, 'Якоря истины').flatMap((t) => {
    const [src, rank, type] = [columnOf(t, 'Источник'), columnOf(t, 'Ранг'), columnOf(t, 'Тип')]
    return t.rows.map((r) => ({ cells: r.cells, src: r.cells[src] ?? '', rank: (r.cells[rank] ?? '').trim(), type: r.cells[type] ?? '' }))
  })
  const r3 = anchors.filter((a) => a.rank === 'R3')
  // Кто и когда — настоящие: дата DD.MM.YYYY и имя без маркера; доля [УТОЧНИТЬ] — отдельно.
  // Плейсхолдер на месте кого или когда («[УТОЧНИТЬ …]», «[ФИО]», «ДД.ММ.ГГГГ») — не кто и когда.
  const r3WhoDate = r3.filter((a) => /\d{2}\.\d{2}\.\d{4}/.test(a.src) && !/\[УТОЧНИТЬ|\[ФИО|ДД\.ММ|\[дата/i.test(a.src) && /\p{Lu}\p{Ll}+/u.test(a.src.replace(/^(?:Заказчик|Решение заказчика)\s*/i, '')))
  const r3Utochnit = r3.filter((a) => /\[УТОЧНИТЬ/.test(a.src))
  // Каждая корпоративная ссылка тела канона заякорена строкой R2.
  const r2Text = anchors.filter((a) => a.rank === 'R2').map((a) => a.cells.join(' ')).join('\n')
  const bodyCorp = [...new Set([...canonBody.matchAll(LINK)].map((m) => m[1]!).filter((u) => /\/browse\/[A-Z]|pageId=|\/display\/|\/pages\//.test(u)))]
  const withoutAnchor = bodyCorp.filter((u) => { const f = findings.find((x) => x.url === u); return f ? !cites(r2Text, f) : !r2Text.includes(u) })
  details.corp_links_without_anchor = withoutAnchor
  const goldenLeaked = input.golden ? goldenLeaks(canon, input.golden) : undefined
  if (goldenLeaked) details.golden_ngram_leaks = goldenLeaked
  // Нерелевантная строка «Якорей»: «не релевантно», ранг «—» без [УТОЧНИТЬ] или R2 на находку без вердикта «та же система/функция/смежное» или вторым шагом.
  // Смежная (раунд 6) — её единственное законное место в БФТ: строка R2.
  const triagedMap = findings.some((f) => f.relevance)
  const offTopic = (text: string) => triagedMap && [...text.matchAll(LINK)].some((m) => {
    const id = linkId(m[1]!)
    const f = findings.find((x) => x.url === m[1] || (!!id && x.id === id))
    return !!f && (!(f.relevance === 'same_system' || f.relevance === 'same_function' || f.relevance === 'adjacent') || !!f.via)
  })
  // R2 на находку, которую тело канона не называет, — якорь факта, которого в документе нет.
  const notInBody = (text: string) => [...text.matchAll(LINK)].some((m) => {
    const id = linkId(m[1]!)
    const f = findings.find((x) => x.url === m[1] || (!!id && x.id === id))
    return f ? f.relevance !== 'adjacent' && !cites(canonBody, f) && !canonBody.includes(`«${f.title}»`) : !canonBody.includes(m[1]!)
  })
  const irrelevantAnchors = anchors.filter((a) => /не релевант/i.test(a.cells.join(' ')) || (/^[—–-]$/.test(a.rank) && !/\[УТОЧНИТЬ/.test(a.type))
    || (a.rank === 'R2' && (offTopic(a.cells.join(' ')) || notInBody(a.src))))
  const cortexR2 = anchors.filter((a) => a.rank === 'R2' && (/кортекс|карт[аеыу] контекста|`?(?:sys|person|init|team|segment)-[a-z0-9-]+`?/i.test(a.src) || !/https?:/.test(a.src)))
  const mentions = {
    critical: (canon.match(/Критичные требования/g) ?? []).length,
    cortex: (canon.match(/Кортекс/gi) ?? []).length,
    summary: (canon.match(/\bSummary\b/g) ?? []).length,
    context_map: (canon.match(/карт[аеыу] контекста/gi) ?? []).length,
  }
  details.forbidden_mentions = mentions

  // ── Для читателя
  const markers = canon.match(/\[УТОЧНИТЬ[^\]]*\]/g) ?? []
  const bare = markers.filter((m) => m === '[УТОЧНИТЬ]')
  const markerSections = new Map<string, Set<string>>()
  for (const s of parsed.sections) {
    const text = parsed.lines.slice(s.start, s.end).join('\n')
    for (const m of text.match(/\[УТОЧНИТЬ[^\]]*:[^\]]+\]/g) ?? []) {
      const key = m.toLowerCase().replace(/\s+/g, ' ')
      if (!markerSections.has(key)) markerSections.set(key, new Set())
      markerSections.get(key)!.add(s.title)
    }
  }
  const dupQuestions = [...markerSections.entries()].filter(([, s]) => s.size >= 3).map(([k]) => k)
  details.duplicate_questions = dupQuestions
  const leaks = input.doc.match(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])[^\s)]*|\.claude\/|\/opt\/bft-skills|в чат/gi) ?? []
  details.leaks = [...new Set(leaks)]
  const dup = dupPhrases(parsed)
  details.dup_phrases = dup.slice(0, 20)

  // ── Приём (шапка fast)
  const smart = fast.sections.flatMap((s) => s.tables).find((t) => t.header[0] === 'SMART')
  const mCell = smart?.rows.find((r) => /^M\b/.test(r.cells[0] ?? ''))?.cells[1] ?? ''
  const tCell = smart?.rows.find((r) => /^T\b/.test(r.cells[0] ?? ''))?.cells[1] ?? ''
  const checklist = (primary.checklist ?? []).filter(Boolean)
  const mIsChecklist = checklist.length > 0 && count(checklist, (c) => mCell.includes(c.replace(/\s+/g, ' ').trim())) >= Math.min(2, checklist.length)
  const bounds = (/### Ограничения и договоренности\s*\n([\s\S]*?)(?=\n### |\n## |$)/.exec(input.fastMd)?.[1] ?? '').split('\n').filter((l) => /^\s*\*\s/.test(l))
  const outUnknown = bounds.filter((b) => /не входит/i.test(b) && /уточня|не согласован|не указан|неизвестн|не определ|\[УТОЧНИТЬ/i.test(b))
  const personas = fast.sections.flatMap((s) => s.tables).find((t) => t.header[0] === 'ФИО')
  const contacts = (personas?.rows ?? []).filter((r) => /@|\+?\d[\d\s()-]{6,}/.test(r.cells[2] ?? ''))

  const metrics: Record<string, MetricValue> = {
    // Стабильность
    deep_failed: input.stage === 'failed',
    attempts: q.attempts ?? null,
    lint_first_pass: lintFirst === undefined ? null : lintFirst === 0 && checkFirst === 0,
    warnings_count: (q.warnings ?? []).length,
    // Опора на источники
    asis_known: asisKnown,
    asis_placeholder_cells: placeholders.length,
    asis_false_gap: asisKnown ? placeholders.length : 0,
    invented_asis: invented.length + problemInvented.length,
    // Базовое значение эффекта, которое назвал заказчик, а канон его не называет (раунд 4); заказчик не называл — null.
    effect_baseline_missing: baselineKnown ? (missingBaseline(canon, primary as PrimaryLike) ? 1 : 0) : null,
    unsourced_tokens: unsourced.length,
    bare_priority_unsourced: barePriority.length,
    risk_ratings_unconfirmed: riskUnconfirmed.length,
    // Трассировка
    coverage_demo: share(results.length - uncovered.length, results.length),
    alt_covered: share(alts.length - altUncovered.length, alts.length),
    ft_without_origin: noOrigin.length,
    actors_with_PT: share(humans.length - actorsNoPt.length, humans.length),
    dangling_ids: dangling.length,
    IT_without_PT: count(itRows, ({ table, cells }) => !/(?<![А-ЯЁ])ПТ-\d+/.test(related(cells, table))),
    NFT_without_FT: count(nftRows, ({ table, cells }) => !/(?<![А-ЯЁН])(?:ФТ|ПТ)-\d+/.test(related(cells, table))),
    skeleton_ids_missing: skeletonMissing.length,
    whatif_unreferenced: whatIfUnref.length,
    // Источники
    sources_findings: findings.length,
    sources_jira: count(findings, (f) => f.kind === 'jira'),
    sources_confluence: count(findings, (f) => f.kind === 'confluence'),
    body_chars_useful: findings.reduce((n, f) => n + f.body.replace(/^\s*(?:true|false)\s*$/gm, '').replace(/\s+/g, ' ').trim().length, 0),
    recon_ms: input.reconMs ?? null,
    // Вердикт триажа (C4): доля отсеянных среди всех, что прошли триаж; без триажа — null (ручная разметка).
    irrelevant_share: triagedTotal ? share(dropped, triagedTotal) : null,
    'precision@5': null,
    citation_precision: triagedTotal ? share(sameCited.length, corpLinks.length) : null,
    sources_with_type_line: share(Math.min(findings.length, (sourcesMd.match(/^Тип: /gm) ?? []).length), findings.length),
    sources_via_second_step: count(findings, (f) => !!f.via),
    corp_links_in_canon: corpLinks.length,
    R2_link_not_in_sources: notInSources.length,
    cortex_as_R2: cortexR2.length,
    jira_type_mismatch: typeMismatch.length,
    same_function_bug_missing_in_risks: triagedTotal ? bugsMissing.length : null,
    existing_solution_unsurfaced: triagedTotal ? unsurfaced.length : null,
    answerable_utochnit: answerable.length,
    whatif_false_negative: triagedTotal ? whatIfMissed.length : null,
    asis_unreconciled: triagedTotal ? (asisGap ? 1 : 0) : null,
    anchor_quote_mismatch: drift.length,
    // Якоря
    R3_rows: r3.length,
    R3_with_who_date: share(r3WhoDate.length, r3.length),
    R3_utochnit_share: share(r3Utochnit.length, r3.length),
    R2_rows: anchors.filter((a) => a.rank === 'R2').length,
    corp_links_without_anchor: withoutAnchor.length,
    golden_ngram_leaks: goldenLeaked ? goldenLeaked.length : null,
    anchor_rows_irrelevant: irrelevantAnchors.length,
    forbidden_mentions: mentions.critical + mentions.cortex + mentions.summary + mentions.context_map,
    // Для читателя
    utochnit_total: markers.length,
    bare_utochnit_share: share(bare.length, markers.length),
    duplicate_questions: dupQuestions.length,
    questions_list_size: q.questions ? q.questions.length : null,
    leak_count: leaks.length,
    DP006: dp006,
    tech_tokens_in_FT: techInFt,
    dup_phrases: dup.length,
    // Приём
    M_is_checklist: mIsChecklist,
    T_filled_when_said: args.deadline ? !/^\[УТОЧНИТЬ/.test(tCell.trim()) : null,
    outOfScope_unknowns: outUnknown.length,
    contacts_in_influence: contacts.length,
    // Объём
    FT_count: ftRows.length,
    PT_count: idRows(parsed, 'Пользовательские требования', 'ПТ').length,
    IT_count: itRows.length,
    NFT_count: nftRows.length,
  }
  return { metrics, details }
}
