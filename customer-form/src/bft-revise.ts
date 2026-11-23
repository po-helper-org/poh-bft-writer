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
import { collectQuestions } from './questions.js'

export interface Remark { section: string; quote?: string; text: string }
export type RemarkStatus = 'applied' | 'already' | 'question' | 'skipped'
export interface RemarkResult { n: number; status: RemarkStatus; note: string }
export type RevisionStage = 'writing' | 'checking' | 'ready' | 'failed'

export interface Revision {
  id: string
  kind: 'revise' | 'undo'
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
}

export const REVISE_LIMITS = { remarks: 30, text: 2000, quote: 500, section: 200, author: 120, history: 50 }

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
    out.push({ section: section || 'Документ', ...(quote ? { quote } : {}), text })
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
- Риски — строками таблицы «Риски» (риск | вероятность | влияние | митигация). Вероятность и влияние — только с источником («подтверждено {кем} {дата}») или [УТОЧНИТЬ у PO: …?]; сам не оценивай.
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
  if (retry) {
    parts.push([
      'Прошлые правки уже применены там, где фрагмент нашёлся; документ выше — с ними. Дай ДОПОЛНИТЕЛЬНЫЕ правки к нему и полный отчёт по всем замечаниям.',
      retry.failed.length ? `Не применились (фрагмент не найден или встречается не один раз — возьми другой, точный и уникальный):\n${retry.failed.join('\n')}` : '',
      retry.errors.length ? `Проверка шаблона нашла новые ошибки — исправь их правками:\n${retry.errors.join('\n')}` : '',
    ].filter(Boolean).join('\n\n'))
  }
  return { system: REVISE_SYSTEM, user: parts.join('\n\n') }
}

export interface Edit { find: string; replace: string }

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

export function newRevision(remarks: Remark[], author?: string): Revision {
  return { id: randomUUID(), kind: 'revise', at: new Date().toISOString(), ...(author ? { author: author.slice(0, REVISE_LIMITS.author) } : {}), remarks, stage: 'writing', progress: { chars: 0, round: 1 } }
}

export interface ReviseInput {
  llm: LlmLike
  route: DeepRoute
  skillsPath: string
  fast: FastFiles
  slug: string
  revision: Revision
  /** Ход работы — в журнал (живая лента на странице). */
  onProgress(update: Partial<Revision>): Promise<void>
  rounds?: number
  timeoutMs?: number
}

/** Ход модели со счётчиком знаков — лента «пишет правки…». */
async function streamText(llm: LlmLike, route: DeepRoute, prompt: { system: string; user: string }, signal: AbortSignal, onChars: (n: number) => void): Promise<string> {
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
  return generate(counting, route, prompt, signal, 16_000)
}

/**
 * Правка документа по замечаниям: до `rounds` кругов (второй — добрать
 * ненайденные фрагменты и новые ошибки проверок). Успех — документ, страница и
 * deep.json обновлены, копия прежней версии — в revisions/. Неудача — документ
 * не тронут, причина — в журнале.
 */
export async function reviseDeep(input: ReviseInput): Promise<Revision> {
  const { fast, slug, revision } = input
  const files = deepFiles(fast, slug)
  const signal = AbortSignal.timeout(input.timeoutMs ?? 8 * 60_000)
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
  const ctx = checkContext({ fastMd, sourcesMd, anchor: await anchorOf(fast, slug), ...(golden ? { golden } : {}), ...(intake ? { intake } : {}), ...(primary ? { primary } : {}) })
  const verify = async (doc: string): Promise<QualityFinding[]> => {
    await writeFile(candidate, doc, 'utf8')
    const lint = await lintDoc(lintScript, candidate)
    const checked = check(doc, ctx)
    return [...lint.findings, ...checked.errors.map((f) => ({ code: f.code, level: f.level, message: f.message }))]
  }
  const baseline = await verify(original)
  const rounds: RemarkResult[][] = []
  let doc = original
  let edits = 0
  let retry: { failed: string[]; errors: string[] } | undefined
  const max = input.rounds ?? 2
  for (let round = 1; round <= max; round++) {
    await input.onProgress({ stage: 'writing', progress: { chars: 0, round } })
    let last = 0
    const text = await streamText(input.llm, input.route, revisePrompt(doc, revision.remarks, retry), signal, (n) => {
      if (n - last < 400) return
      last = n
      void input.onProgress({ progress: { chars: n, round } })
    })
    const parsed = parseEdits(text)
    rounds.push(parsed.results)
    const applied = applyEdits(doc, parsed.edits)
    doc = applied.doc
    edits += applied.applied
    await input.onProgress({ stage: 'checking', progress: { chars: last, round, note: `правок внесено: ${edits}` } })
    const fresh = newErrors(baseline, await verify(doc))
    if (!fresh.length && !applied.failed.length) break
    if (round === max) {
      if (fresh.length) throw new Error(`правки не прошли проверку шаблона:\n${fresh.slice(0, 8).map(formatFinding).join('\n')}`)
      break // ненайденные фрагменты на последнем круге — отчёт скажет, что не внесено
    }
    retry = { failed: applied.failed, errors: fresh.map(formatFinding) }
  }
  const results = mergeResults(revision.remarks.length, rounds)
  if (doc === original) return { ...revision, stage: 'ready', results, edits: 0, finishedAt: new Date().toISOString() }
  // Прежняя версия — в копию (откат), новая — на место, страница ревью — заново.
  const backup = join(backupDir(fast), `${revision.id}.md`)
  await copyFile(files.md, backup)
  await copyFile(files.html, join(backupDir(fast), `${revision.id}.html`)).catch(() => undefined)
  const dated = doc.replace(/^synced: .*$/m, `synced: ${new Date().toISOString().slice(0, 10)}`)
  await writeFile(files.md, dated, 'utf8')
  const html = await python(join(input.skillsPath, 'bft-writer/scripts/bft-html-export.py'), [files.md])
  if (html.code !== 0) {
    await copyFile(backup, files.md)
    throw new Error(`страница ревью не собрана: ${html.out.slice(0, 500)}`)
  }
  await touchDeep(fast, slug, dated)
  return { ...revision, stage: 'ready', results, edits, backup: basename(backup), finishedAt: new Date().toISOString() }
}

/** deep.json после правки: новые вопросы согласования и отметка времени (форма вопросов подтянет новую версию). */
async function touchDeep(fast: FastFiles, slug: string, doc: string): Promise<void> {
  const files = deepFiles(fast, slug)
  const state = await readDeepState(files)
  if (!state) return
  await saveDeepState(files, { ...state, finishedAt: new Date().toISOString(), questions: collectQuestions({ canon: canonOf(doc) }) })
}

/** Откат правки: копия прежней версии — на место, страница — заново. */
export async function undoRevision(skillsPath: string, fast: FastFiles, slug: string, target: Revision): Promise<void> {
  if (!target.backup) throw new Error('у этой правки нет копии прежней версии')
  const files = deepFiles(fast, slug)
  const backup = join(backupDir(fast), target.backup)
  const doc = await readFile(backup, 'utf8')
  await writeFile(files.md, doc, 'utf8')
  const html = await python(join(skillsPath, 'bft-writer/scripts/bft-html-export.py'), [files.md])
  if (html.code !== 0) throw new Error(`страница ревью не собрана: ${html.out.slice(0, 500)}`)
  await touchDeep(fast, slug, doc)
}
