/**
 * ИИ-агент правок полного БФТ (ADR-0021): замечания PO со страницы документа →
 * точечные правки «найти → заменить» → те же проверки, что у сборки
 * (bft-lint.py и проверки портала) → страница ревью. Документ не пересобирается
 * целиком: модель меняет только то, о чём замечание, остальное — слово в слово.
 *
 * Проверка — относительно исходного документа: правка не должна добавить
 * ошибку, которой не было; старые замечания проверок правку не валят.
 * Перед записью — копия прежней версии (откат одной кнопкой). Журнал правок —
 * revisions.json в папке заявки; он же уходит в контекст следующей полной
 * сборки, чтобы правки PO не потерялись при пересборке по ответам формы.
 */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { anchorOf, deepFiles, generate, goldenCanon, lintDoc, python, readDeepState, readIntake, RULES, saveDeepState, type DeepRoute, type LlmLike, type QualityFinding } from './bft-deep.js'
import type { FastFiles } from './bft-fast.js'
import { check, checkContext, formatFinding } from './canon-check.js'
import { canonOf } from './forms.js'
import { changedBlocks } from './doc-sections.js'
import { collectQuestions } from './questions.js'
import { balanceMessage, isBalanceError, type ProviderHealth } from './provider-health.js'

/** ref — метка замечания на странице (ts комментария): по ней страница закрывает внесённое. */
export interface Remark { section: string; quote?: string; text: string; ref?: string }
export type RemarkStatus = 'applied' | 'already' | 'question' | 'skipped'
export interface RemarkResult { n: number; status: RemarkStatus; note: string }
export type RevisionStage = 'queued' | 'writing' | 'checking' | 'ready' | 'failed'
/** revise — локальная правка по одному замечанию; review — полное ревью согласованности; undo — откат. */
export type RevisionKind = 'revise' | 'undo' | 'review'

export interface Revision {
  id: string
  kind: RevisionKind
  at: string
  author?: string
  remarks: Remark[]
  stage: RevisionStage
  /** Ход работы для живой ленты: сколько знаков написала модель, какой круг правок. */
  progress?: { chars: number; round: number; note?: string }
  results?: RemarkResult[]
  /** Сколько правок «найти → заменить» внесено. */
  edits?: number
  error?: string
  finishedAt?: string
  /** Копия документа до правки — revisions/<id>.md (откат). */
  backup?: string
  /** Откат: какую правку отменили. */
  undoOf?: string
  /** Внесённые замены (найдено → стало): откат правки, поверх которой легли другие. */
  changes?: Edit[]
  /** Изменённые разделы страницы (id h2) — для точечной перерисовки; нет — перезагрузить страницу. */
  sections?: string[]
  /** Какая модель правила (подпись в колонке). */
  model?: string
  /** Что видела модель: раздел(ы) или весь документ. */
  scope?: string
  /** Пометка для колонки: например, у основной модели закончился баланс и правила запасная. */
  notice?: string
}

export const REVISE_LIMITS = { remarks: 30, text: 2000, quote: 500, section: 200, author: 120, ref: 64, history: 200 }

/** Замечания из запроса: обрезка, лимиты; ошибка — строкой. */
export function normalizeRemarks(raw: unknown): Remark[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'нет замечаний'
  if (raw.length > REVISE_LIMITS.remarks) return `не больше ${REVISE_LIMITS.remarks} замечаний за раз`
  const out: Remark[] = []
  for (const item of raw) {
    const r = item as { section?: unknown; quote?: unknown; text?: unknown }
    const text = typeof r?.text === 'string' ? r.text.trim() : ''
    if (!text) continue
    if (text.length > REVISE_LIMITS.text) return `замечание длиннее ${REVISE_LIMITS.text} знаков`
    const section = typeof r.section === 'string' ? r.section.trim().slice(0, REVISE_LIMITS.section) : ''
    const quote = typeof r.quote === 'string' ? r.quote.trim().slice(0, REVISE_LIMITS.quote) : ''
    const ref = typeof (r as { ref?: unknown }).ref === 'string' || typeof (r as { ref?: unknown }).ref === 'number'
      ? String((r as { ref: string | number }).ref).slice(0, REVISE_LIMITS.ref) : ''
    out.push({ section: section || 'Документ', ...(quote ? { quote } : {}), text, ...(ref ? { ref } : {}) })
  }
  return out.length ? out : 'нет замечаний'
}

const REVISE_SYSTEM = `Ты — аналитик, который правит готовый полный БФТ по замечаниям PO. Документ уже прошёл проверку шаблона — сохрани его форму.

Как отвечать — ТОЛЬКО блоками правок и отчётом, без пересказа документа:

@@@ ПРАВКА
<<<
точный фрагмент документа, который меняешь (дословно, с теми же символами | и пробелами; целые строки)
===
новый текст этого фрагмента
>>>

…столько блоков, сколько нужно. Фрагмент должен встречаться в документе ровно один раз — бери строку таблицы или абзац целиком. Вставка новой строки — правкой соседней строки (старая строка + новая). Удаление — пустой новый текст.

@@@ ОТЧЁТ
[{"n": 1, "status": "applied", "note": "что сделано, коротко"}, …]

status: applied — внесено; already — в документе уже так; question — оформлено открытым вопросом; skipped — не внесено (объясни в note).

Правила правки:
- Меняй только то, о чём замечание. Остальной текст, таблицы, ID, заголовки и ссылки — не трогай.
- Замечание PO — источник факта наравне со словами заказчика: «подтверждаю» к [УТОЧНИТЬ] — убери маркер и оставь утверждение; ответ на вопрос — впиши его вместо маркера.
- «Открытый вопрос» в замечании — маркер [УТОЧНИТЬ у {адресат}: {вопрос}?] в той ячейке или строке, к которой он относится; адресат — из замечания, иначе тот, кто может ответить (заказчик, команда, PO).
- «Убрать» — удали фрагмент; если это ячейка таблицы, оставь ячейку с короткой формулировкой или «—», число колонок не меняй.
- Риски — строками таблицы «Риски» (риск | вероятность | влияние | митигация). Риск, названный PO, — законная строка: название риска — словами замечания PO (основа для проверки «слова PO»), без ссылки на находку. Вероятность и влияние — только с источником («подтверждено {кем} {дата}») или [УТОЧНИТЬ у PO: …?]; сам не оценивай. Не переноси риск PO в «Зависимости» и не сворачивай раздел.
- Не выдумывай фактов сверх замечания. В ячейках — одна короткая формулировка, без HTML и эмодзи.

Правила канона, по которым собран документ (для справки — форма разделов и маркеров):
${RULES}`

/** Документ без frontmatter — то, что видит модель. */
export function bodyOf(doc: string): string {
  const fm = /^---\n[\s\S]*?\n---\n/.exec(doc)
  return fm ? doc.slice(fm[0].length) : doc
}

export function revisePrompt(doc: string, remarks: readonly Remark[], retry?: { failed: string[]; errors: string[] }): { system: string; user: string } {
  const list = remarks.map((r, i) => `${i + 1}. [${r.section}]${r.quote ? ` (по фрагменту: «${r.quote}»)` : ''} ${r.text}`).join('\n')
  const parts = [`Замечания PO (номер — для отчёта):\n${list}`, `Документ (текущая версия):\n\n${bodyOf(doc)}`]
  if (retry) parts.push(retryText(retry))
  return { system: REVISE_SYSTEM, user: parts.join('\n\n') }
}

export interface Edit { find: string; replace: string }

/** Раздел `##` документа: заголовок и границы в тексте (с frontmatter); шапка — title ''. */
export interface MdSection { title: string; start: number; end: number }

/** Разделы `##` по порядку (заголовки внутри ``` не считаются). */
export function mdSections(doc: string): MdSection[] {
  const fm = /^---\n[\s\S]*?\n---\n/.exec(doc)
  const from = fm ? fm[0].length : 0
  const out: MdSection[] = [{ title: '', start: from, end: doc.length }]
  let fence = false
  let at = from
  for (const line of doc.slice(from).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const m = !fence && /^## (.+?)\s*$/.exec(line)
    if (m) {
      out[out.length - 1]!.end = at
      out.push({ title: m[1]!, start: at, end: doc.length })
    }
    at += line.length + 1
  }
  out[out.length - 1]!.end = doc.length
  return out
}

const plain = (s: string) => s.toLowerCase().replace(/[*_`#\[\]]/g, '').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Где править замечание: раздел из `[Раздел · ФТ-2]` со страницы; нет раздела
 * («Документ») или не нашёлся — разделы, где встречается цитата или ID строки;
 * не нашлось ничего — весь документ (пустой список).
 */
export function scopeFor(doc: string, remark: Remark): MdSection[] {
  const sections = mdSections(doc).filter((s) => s.title)
  const [head = '', row = ''] = remark.section.split(' · ').map((x) => x.trim())
  const want = plain(head)
  if (want && want !== 'документ') {
    const exact = sections.filter((s) => plain(s.title) === want)
    if (exact.length === 1) return exact
    const loose = sections.filter((s) => { const t = plain(s.title); return t && (t.includes(want) || want.includes(t)) })
    if (loose.length === 1) return loose
  }
  // Своё указание текстом («В разделе «Риски» добавь…») — раздел, названный в тексте.
  const said = ` ${plain(remark.text)} `
  const named = sections.filter((s) => { const t = plain(s.title); return t.length >= 4 && said.includes(` ${t} `) })
  if (named.length === 1) return named
  const needles = [remark.quote ? squash(remark.quote.replace(/…$/, '')).slice(0, 120) : '', row].filter((x) => x.length >= 3)
  for (const needle of needles) {
    const hits = sections.filter((s) => squash(doc.slice(s.start, s.end)).includes(needle))
    if (hits.length && hits.length <= 2) return hits
  }
  return []
}

const LOCAL_HINT = 'Тебе дан не весь документ, а только раздел(ы), к которым относится замечание. Правь только их: фрагмент «найти» бери из показанного текста, он должен встречаться в нём ровно один раз. Нужна правка в другом разделе — не делай её, а напиши об этом в note.'

/** Локальная правка: одно замечание, на входе — только его раздел(ы) и оглавление. */
export function localPrompt(doc: string, remark: Remark, scope: readonly MdSection[], retry?: { failed: string[]; errors: string[] }): { system: string; user: string } {
  if (!scope.length) return revisePrompt(doc, [remark], retry)
  const title = /^# (.+)$/m.exec(bodyOf(doc))?.[1] ?? ''
  const toc = mdSections(doc).filter((s) => s.title).map((s) => `- ${s.title}`).join('\n')
  const parts = [
    `Замечание PO (номер — для отчёта):\n1. [${remark.section}]${remark.quote ? ` (по фрагменту: «${remark.quote}»)` : ''} ${remark.text}`,
    `Документ: ${title}\nРазделы документа:\n${toc}`,
    ...scope.map((s) => `Раздел (текущая версия):\n\n${doc.slice(s.start, s.end).trimEnd()}`),
  ]
  if (retry) parts.push(retryText(retry))
  return { system: `${REVISE_SYSTEM}\n\n${LOCAL_HINT}`, user: parts.join('\n\n') }
}

function retryText(retry: { failed: string[]; errors: string[] }): string {
  return [
    'Прошлые правки уже применены там, где фрагмент нашёлся; текст выше — с ними. Дай ДОПОЛНИТЕЛЬНЫЕ правки к нему и полный отчёт по всем замечаниям.',
    retry.failed.length ? `Не применились (фрагмент не найден или встречается не один раз — возьми другой, точный и уникальный):\n${retry.failed.join('\n')}` : '',
    retry.errors.length ? `Проверка шаблона нашла новые ошибки — исправь их правками:\n${retry.errors.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

const REVIEW_SYSTEM = `${REVISE_SYSTEM}

Сейчас задача другая — полное ревью согласованности. Замечаний PO нет: после прошлого ревью в документ точечно вносились правки (список ниже), и каждая видела только свой раздел. Проверь весь документ сквозь разделы и согласуй то, что разошлось:
- ID и связи: бизнес-требования ↔ продуктовые ↔ функциональные — у каждой ссылки есть адресат, удалённое не упоминается, новое связано;
- план демонстрации ↔ требования: каждый шаг проверяет существующее требование, у важного требования есть шаг;
- риски ↔ зависимости ↔ открытые вопросы: одно и то же не записано по-разному, снятый вопрос не висит маркером;
- «Якоря истины» и цифры — одинаковы во всех разделах;
- маркеры [УТОЧНИТЬ] — там, где факта нет, и не там, где PO его подтвердил.
Правки — тем же форматом «найти → заменить». Не переписывай то, что согласовано; не выдумывай фактов. Решения PO из списка правок — источник, их не отменяй.

Отчёт — по каждой найденной и исправленной несогласованности: [{"n": 1, "status": "applied", "note": "что согласовал, где"}, …]; несогласованность без источника для исправления — status "question" с маркером [УТОЧНИТЬ] в документе; всё согласовано — [{"n": 1, "status": "already", "note": "документ согласован"}].`

/** Полное ревью: весь документ + локальные правки с прошлого ревью. */
export function reviewPrompt(doc: string, since: readonly Revision[], retry?: { failed: string[]; errors: string[] }): { system: string; user: string } {
  const lines = since.flatMap((r) => r.remarks.map((m) => {
    const res = r.results?.[0]
    return `- [${m.section}] ${m.text}${res ? ` → ${res.note || res.status}` : ''}`
  }))
  const parts = [
    `Локальные правки с прошлого ревью:\n${lines.length ? lines.join('\n') : '- (нет — проверь документ целиком)'}`,
    `Документ (текущая версия):\n\n${bodyOf(doc)}`,
  ]
  if (retry) parts.push(retryText(retry))
  return { system: REVIEW_SYSTEM, user: parts.join('\n\n') }
}

const STATUSES: ReadonlySet<string> = new Set(['applied', 'already', 'question', 'skipped'])

/** Ответ модели → правки и отчёт; кривой отчёт — пустой список (правки всё равно идут). */
export function parseEdits(text: string): { edits: Edit[]; results: RemarkResult[] } {
  const edits: Edit[] = []
  const re = /@@@ ПРАВКА\s*\n<<<\n([\s\S]*?)\n===\n([\s\S]*?)\n?>>>/g
  for (let m = re.exec(text); m; m = re.exec(text)) edits.push({ find: m[1]!, replace: m[2]! })
  let results: RemarkResult[] = []
  const report = text.lastIndexOf('@@@ ОТЧЁТ')
  if (report >= 0) {
    const raw = text.slice(report + '@@@ ОТЧЁТ'.length).replace(/```(?:json)?/g, '')
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{ n?: unknown; status?: unknown; note?: unknown }>
      results = parsed.flatMap((r) => typeof r?.n === 'number' && typeof r.status === 'string' && STATUSES.has(r.status)
        ? [{ n: r.n, status: r.status as RemarkStatus, note: typeof r.note === 'string' ? r.note.slice(0, 400) : '' }] : [])
    } catch { /* отчёт не разобрался — останется без него */ }
  }
  return { edits, results }
}

/** Применить правки по порядку; фрагмент должен встретиться ровно один раз. */
export function applyEdits(doc: string, edits: readonly Edit[]): { doc: string; applied: number; failed: string[] } {
  let out = doc
  let applied = 0
  const failed: string[] = []
  for (const edit of edits) {
    if (!edit.find.trim()) { failed.push('пустой фрагмент'); continue }
    const at = out.indexOf(edit.find)
    const short = edit.find.replace(/\s+/g, ' ').slice(0, 120)
    if (at < 0) { failed.push(`не найден: «${short}»`); continue }
    if (out.indexOf(edit.find, at + 1) >= 0) { failed.push(`встречается не один раз: «${short}»`); continue }
    out = out.slice(0, at) + edit.replace + out.slice(at + edit.find.length)
    applied++
  }
  return { doc: out, applied, failed }
}

/**
 * Правки в пределах разделов: фрагмент ищется и должен быть уникален только в
 * них (модель видела только их). Пустой scope — весь документ без frontmatter.
 * changes — что фактически заменено (для отката).
 */
export function applyScoped(doc: string, scope: readonly MdSection[], edits: readonly Edit[]): { doc: string; applied: number; failed: string[]; changes: Edit[] } {
  const fm = /^---\n[\s\S]*?\n---\n/.exec(doc)
  const spans = (scope.length ? [...scope].sort((a, b) => a.start - b.start) : [{ title: '', start: fm ? fm[0].length : 0, end: doc.length }])
    .map((s) => ({ start: s.start, end: s.end, text: doc.slice(s.start, s.end) }))
  let applied = 0
  const failed: string[] = []
  const changes: Edit[] = []
  for (const edit of edits) {
    const short = edit.find.replace(/\s+/g, ' ').slice(0, 120)
    if (!edit.find.trim()) { failed.push('пустой фрагмент'); continue }
    const hits = spans.flatMap((span, i) => {
      const at = span.text.indexOf(edit.find)
      if (at < 0) return []
      return span.text.indexOf(edit.find, at + 1) >= 0 ? [{ i, at }, { i, at: -1 }] : [{ i, at }]
    })
    if (!hits.length) { failed.push(`не найден: «${short}»`); continue }
    if (hits.length > 1) { failed.push(`встречается не один раз: «${short}»`); continue }
    const span = spans[hits[0]!.i]!
    span.text = span.text.slice(0, hits[0]!.at) + edit.replace + span.text.slice(hits[0]!.at + edit.find.length)
    changes.push({ find: edit.find, replace: edit.replace })
    applied++
  }
  let out = doc
  for (const span of [...spans].reverse()) out = out.slice(0, span.start) + span.text + out.slice(span.end)
  return { doc: out, applied, failed, changes }
}

/** Отчёт по замечаниям: последнее слово — за последним кругом, без отчёта — «не отчитался». */
export function mergeResults(count: number, rounds: RemarkResult[][]): RemarkResult[] {
  return Array.from({ length: count }, (_, i) => {
    for (let r = rounds.length - 1; r >= 0; r--) {
      const found = rounds[r]!.find((x) => x.n === i + 1)
      if (found) return found
    }
    return { n: i + 1, status: 'skipped' as const, note: 'агент не отчитался по этому замечанию' }
  })
}

/** Новые ошибки — те, которых не было в исходном документе (код + текст). */
export function newErrors(before: readonly QualityFinding[], after: readonly QualityFinding[]): QualityFinding[] {
  const key = (f: QualityFinding) => `${f.code}|${f.message}`
  const seen = new Set(before.filter((f) => f.level === 'ERROR').map(key))
  return after.filter((f) => f.level === 'ERROR' && !seen.has(key(f)))
}

/** Правки PO для полной пересборки: она не должна их потерять (ADR-0021). */
export function revisionsContext(list: readonly Revision[]): string {
  const done = list.filter((r) => r.kind === 'revise' && r.stage === 'ready')
  if (!done.length) return ''
  const lines = done.flatMap((r) => r.remarks.map((m, i) => {
    const res = r.results?.find((x) => x.n === i + 1)
    return `- [${m.section}]${m.quote ? ` (по фрагменту: «${m.quote.slice(0, 160)}»)` : ''} ${m.text}${res ? ` → ${res.note || res.status}` : ''}${r.author ? ` (${r.author})` : ''}`
  }))
  return `Правки PO к прошлой версии документа (ИИ-агент; источник наравне со словами заказчика — учти их в новой сборке):\n${lines.join('\n')}`
}

const revisionsPath = (fast: FastFiles) => join(fast.dir, 'revisions.json')
export const backupDir = (fast: FastFiles) => join(fast.dir, 'revisions')

export async function readRevisions(fast: FastFiles): Promise<Revision[]> {
  return readFile(revisionsPath(fast), 'utf8').then((t) => JSON.parse(t) as Revision[], () => [])
}

export async function saveRevisions(fast: FastFiles, list: readonly Revision[]): Promise<void> {
  const path = revisionsPath(fast)
  await writeFile(`${path}.tmp`, JSON.stringify(list.slice(-REVISE_LIMITS.history)), 'utf8')
  await rename(`${path}.tmp`, path)
}

export function newRevision(remarks: Remark[], author?: string, kind: RevisionKind = 'revise'): Revision {
  return { id: randomUUID(), kind, at: new Date().toISOString(), ...(author ? { author: author.slice(0, REVISE_LIMITS.author) } : {}), remarks, stage: 'queued' }
}

/** Задачи очереди: одно замечание — одна локальная правка, по порядку. */
export function queueRemarks(remarks: readonly Remark[], author?: string): Revision[] {
  return remarks.map((r) => newRevision([r], author))
}

/** Правки, меняющие документ: внесённые и не откаченные (по порядку). */
function effective(list: readonly Revision[]): Revision[] {
  const undone = new Set(list.filter((r) => r.kind === 'undo').map((r) => r.undoOf))
  return list.filter((r) => r.kind !== 'undo' && r.stage === 'ready' && (r.edits ?? 0) > 0 && !undone.has(r.id))
}

/** Последнее событие, поменявшее документ (правка, ревью или откат). */
function lastChange(list: readonly Revision[]): Revision | undefined {
  return [...list].reverse().find((r) => r.stage === 'ready' && (r.kind === 'undo' || (r.edits ?? 0) > 0))
}

/**
 * Можно ли откатить правку: последняя изменившая документ — по копии; поверх
 * легли другие — обратной заменой (каждая новая вставка должна быть непустой).
 */
export function canUndo(list: readonly Revision[], id: string): boolean {
  const target = effective(list).find((r) => r.id === id)
  if (!target) return false
  if (lastChange(list)?.id === id && target.backup) return true
  return !!target.changes?.length && target.changes.every((c) => c.replace.trim().length > 0)
}

/** Точка у «Комментариев»: после последнего ревью были локальные правки. */
export function reviewDue(list: readonly Revision[]): boolean {
  const lastReview = [...list].reverse().findIndex((r) => r.kind === 'review' && r.stage === 'ready')
  const after = lastReview < 0 ? list : list.slice(list.length - lastReview)
  return effective(after).some((r) => r.kind === 'revise')
}

/** Локальные правки с прошлого ревью — вход полного ревью. */
export function sinceReview(list: readonly Revision[]): Revision[] {
  const lastReview = [...list].reverse().findIndex((r) => r.kind === 'review' && r.stage === 'ready')
  const after = lastReview < 0 ? list : list.slice(list.length - lastReview)
  return effective(after).filter((r) => r.kind === 'revise')
}

/** Замечания PO как источник для проверок (риски, статусы): прошлые внесённые и текущие. */
export function poWords(list: readonly Revision[], current: readonly Remark[] = []): string[] {
  return [...list.filter((r) => r.kind === 'revise' && r.stage === 'ready').flatMap((r) => r.remarks), ...current].map((r) => r.text)
}

/** Модель для правки: dsh (провайдер портала) или внешний агент полного ревью. */
export interface TextModel {
  label: string
  /** Провайдер — для отметки «закончился баланс» (ProviderHealth). */
  provider?: string
  complete(prompt: { system: string; user: string }, signal: AbortSignal, onChars: (n: number) => void): Promise<string>
}

/** Модель dsh со счётчиком знаков — лента «пишет правки…». */
export function dshModel(llm: LlmLike, route: DeepRoute, maxTokens = 16_000): TextModel {
  return {
    label: `${route.provider} · ${route.model}`,
    provider: route.provider,
    complete: (prompt, signal, onChars) => {
      const counting: LlmLike = {
        prepareCall: async (config, s) => {
          const call = await llm.prepareCall(config, s)
          return {
            config: call.config,
            stream: (options: Record<string, unknown>) => (async function* () {
              let n = 0
              for await (const chunk of call.stream(options)) {
                if (chunk.type === 'text-delta' && chunk.text) { n += chunk.text.length; onChars(n) }
                yield chunk
              }
            })(),
          }
        },
      }
      return generate(counting, route, prompt, signal, maxTokens)
    },
  }
}

export interface ReviseInput {
  /** Модель правки; fallback — если она не ответила (нет ключа, провайдер лёг). */
  model: TextModel
  fallback?: TextModel
  /** Отметки «закончился баланс»: помеченного провайдера пропускаем сразу на запасную. */
  health?: ProviderHealth
  skillsPath: string
  fast: FastFiles
  slug: string
  revision: Revision
  /** review — полное ревью согласованности (весь документ + правки с прошлого ревью). */
  since?: readonly Revision[]
  /** Ход работы — в журнал (живая лента на странице). */
  onProgress(update: Partial<Revision>): Promise<void>
  rounds?: number
  timeoutMs?: number
}

/** Страница ревью заново + какие разделы на ней поменялись (null — перезагрузить целиком). */
async function exportPage(skillsPath: string, mdPath: string, htmlPath: string): Promise<string[] | undefined> {
  const before = await readFile(htmlPath, 'utf8').catch(() => '')
  const html = await python(join(skillsPath, 'bft-writer/scripts/bft-html-export.py'), [mdPath])
  if (html.code !== 0) throw new Error(`страница ревью не собрана: ${html.out.slice(0, 500)}`)
  const after = await readFile(htmlPath, 'utf8').catch(() => '')
  return (before && after ? changedBlocks(before, after) : null) ?? undefined
}

/**
 * Правка документа: локальная (одно замечание, на входе — его раздел) или полное
 * ревью (весь документ). До `rounds` кругов: второй добирает ненайденные
 * фрагменты и новые ошибки проверок. Успех — документ, страница и deep.json
 * обновлены, копия прежней версии — в revisions/. Неудача — документ не тронут.
 */
export async function reviseDeep(input: ReviseInput): Promise<Revision> {
  const { fast, slug, revision } = input
  const review = revision.kind === 'review'
  const files = deepFiles(fast, slug)
  const signal = AbortSignal.timeout(input.timeoutMs ?? (review ? 10 : 4) * 60_000)
  const lintScript = join(input.skillsPath, 'bft-writer/scripts/bft-lint.py')
  const work = join(backupDir(fast), 'work')
  await mkdir(work, { recursive: true })
  const candidate = join(work, basename(files.md))
  const original = await readFile(files.md, 'utf8')
  const fastMd = await readFile(fast.md, 'utf8')
  const golden = await readFile(join(input.skillsPath, 'bft-deep-swarm/examples/golden_deep_document.md'), 'utf8').then(goldenCanon, () => undefined)
  const sourcesMd = await readFile(join(fast.dir, 'sources.md'), 'utf8').catch(() => '')
  const intake = await readIntake(fast)
  const primary = await readFile(fast.primary, 'utf8').then((t) => JSON.parse(t) as unknown, () => undefined)
  const po = poWords(await readRevisions(fast), revision.remarks)
  const ctx = checkContext({ fastMd, sourcesMd, po, anchor: await anchorOf(fast, slug), ...(golden ? { golden } : {}), ...(intake ? { intake } : {}), ...(primary ? { primary } : {}) })
  const verify = async (doc: string): Promise<QualityFinding[]> => {
    await writeFile(candidate, doc, 'utf8')
    const lint = await lintDoc(lintScript, candidate)
    const checked = check(doc, ctx)
    return [...lint.findings, ...checked.errors.map((f) => ({ code: f.code, level: f.level, message: f.message }))]
  }
  const baseline = await verify(original)
  const remark = revision.remarks[0]
  const rounds: RemarkResult[][] = []
  const changes: Edit[] = []
  let doc = original
  let edits = 0
  const health = input.health
  let model = input.model
  let notice: string | undefined
  const switchToFallback = (why: string): boolean => {
    const fb = input.fallback
    if (!fb || model === fb || health?.isExhausted(fb.provider)) return false
    notice = `${why} — правила запасная модель ${fb.label}`
    model = fb
    return true
  }
  if (health?.isExhausted(model.provider)) switchToFallback(`У ${model.provider} закончился баланс`)
  if (health?.isExhausted(model.provider)) throw new Error(balanceMessage(model.provider!))
  let scopeLabel = 'весь документ'
  let retry: { failed: string[]; errors: string[] } | undefined
  const max = input.rounds ?? 2
  for (let round = 1; round <= max; round++) {
    const scope = review || !remark ? [] : scopeFor(doc, remark)
    if (round === 1) scopeLabel = scope.length ? scope.map((s) => s.title).join(', ') : 'весь документ'
    const prompt = review ? reviewPrompt(doc, input.since ?? [], retry) : remark ? localPrompt(doc, remark, scope, retry) : revisePrompt(doc, revision.remarks, retry)
    await input.onProgress({ stage: 'writing', model: model.label, scope: scopeLabel, progress: { chars: 0, round } })
    let last = 0
    const onChars = (n: number) => {
      if (n - last < 300) return
      last = n
      void input.onProgress({ progress: { chars: n, round } })
    }
    const ask = async (m: TextModel): Promise<string> => {
      try {
        const out = await m.complete(prompt, signal, onChars)
        if (m.provider) health?.clear(m.provider)
        return out
      } catch (e) {
        if (signal.aborted || !isBalanceError(e) || !m.provider) throw e
        health?.exhausted(m.provider)
        throw Object.assign(new Error(balanceMessage(m.provider)), { balance: m.provider, cause: e })
      }
    }
    let text: string
    try {
      text = await ask(model)
    } catch (e) {
      if (signal.aborted) throw e
      const failed = model
      const balance = (e as { balance?: string }).balance
      if (!switchToFallback(balance ? `У ${balance} закончился баланс` : `${failed.label} не ответила`)) throw e
      console.error(`[customer-form] ИИ-агент правок: ${failed.label} не ответила, беру ${model.label}:`, (e as Error).message)
      await input.onProgress({ model: model.label, notice: notice! })
      text = await ask(model)
    }
    const parsed = parseEdits(text)
    rounds.push(parsed.results)
    const applied = applyScoped(doc, scope, parsed.edits)
    doc = applied.doc
    edits += applied.applied
    changes.push(...applied.changes)
    await input.onProgress({ stage: 'checking', progress: { chars: last, round, note: `правок внесено: ${edits}` } })
    const fresh = newErrors(baseline, await verify(doc))
    if (!fresh.length && !applied.failed.length) break
    if (round === max) {
      if (fresh.length) throw new Error(`правки не прошли проверку шаблона:\n${fresh.slice(0, 8).map(formatFinding).join('\n')}`)
      break // ненайденные фрагменты на последнем круге — отчёт скажет, что не внесено
    }
    retry = { failed: applied.failed, errors: fresh.map(formatFinding) }
  }
  const results = review ? ([...rounds].reverse().find((r) => r.length) ?? []) : mergeResults(revision.remarks.length, rounds)
  const done = { ...revision, model: model.label, scope: scopeLabel, results, ...(notice ? { notice } : {}) }
  if (doc === original) return { ...done, stage: 'ready', edits: 0, finishedAt: new Date().toISOString() }
  // Прежняя версия — в копию (откат), новая — на место, страница ревью — заново.
  const backup = join(backupDir(fast), `${revision.id}.md`)
  await copyFile(files.md, backup)
  const dated = doc.replace(/^synced: .*$/m, `synced: ${new Date().toISOString().slice(0, 10)}`)
  await writeFile(files.md, dated, 'utf8')
  let sections: string[] | undefined
  try {
    sections = await exportPage(input.skillsPath, files.md, files.html)
  } catch (e) {
    await copyFile(backup, files.md)
    await python(join(input.skillsPath, 'bft-writer/scripts/bft-html-export.py'), [files.md]).catch(() => undefined)
    throw e
  }
  await touchDeep(fast, slug, dated)
  return { ...done, stage: 'ready', edits, changes, backup: basename(backup), ...(sections ? { sections } : {}), finishedAt: new Date().toISOString() }
}

/** deep.json после правки: новые вопросы согласования и отметка времени (форма вопросов подтянет новую версию). */
async function touchDeep(fast: FastFiles, slug: string, doc: string): Promise<void> {
  const files = deepFiles(fast, slug)
  const state = await readDeepState(files)
  if (!state) return
  await saveDeepState(files, { ...state, finishedAt: new Date().toISOString(), questions: collectQuestions({ canon: canonOf(doc) }) })
}

/**
 * Откат правки. Последняя изменившая документ — копия прежней версии на место.
 * Поверх легли другие — обратная замена её вставок, если они с тех пор не
 * менялись; иначе ошибка «поверх легла правка». Возвращает изменённые разделы.
 */
export async function undoRevision(skillsPath: string, fast: FastFiles, slug: string, list: readonly Revision[], id: string): Promise<{ sections?: string[] }> {
  if (!canUndo(list, id)) throw new Error('эту правку откатить нельзя')
  const target = list.find((r) => r.id === id)!
  const files = deepFiles(fast, slug)
  const current = await readFile(files.md, 'utf8')
  let doc: string
  if (lastChange(list)?.id === id && target.backup) {
    doc = await readFile(join(backupDir(fast), target.backup), 'utf8')
  } else {
    doc = current
    for (const change of [...(target.changes ?? [])].reverse()) {
      const at = doc.indexOf(change.replace)
      if (at < 0 || doc.indexOf(change.replace, at + 1) >= 0) throw new Error('поверх этой правки легли другие — откатить её отдельно нельзя')
      doc = doc.slice(0, at) + change.find + doc.slice(at + change.replace.length)
    }
  }
  const backup = join(backupDir(fast), `undo-${id}.md`)
  await writeFile(backup, current, 'utf8')
  await writeFile(files.md, doc, 'utf8')
  let sections: string[] | undefined
  try {
    sections = await exportPage(skillsPath, files.md, files.html)
  } catch (e) {
    await writeFile(files.md, current, 'utf8')
    throw e
  }
  await touchDeep(fast, slug, doc)
  return sections ? { sections } : {}
}
