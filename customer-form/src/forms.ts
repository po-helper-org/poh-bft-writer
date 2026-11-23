/**
 * Форма вопросов по БФТ (ADR-0018): из открытых вопросов полного БФТ
 * («[УТОЧНИТЬ у X: вопрос?]») — форма по ссылке-ключу, которую PO отправляет
 * заказчику и командам вне портала. Ответы ложатся в заявку и уходят в
 * следующую сборку полного БФТ, а та закрывает отвеченные маркеры.
 *
 * Здесь — данные и правила, без HTTP и без страниц:
 *  - форма — /data/bft-forms/<id>.json; id — случайный UUID, он же ключ доступа;
 *    у заявки — ссылка на форму (<папка заявки>/form.json);
 *  - вопросы — все адресные маркеры канона, без потолка списка «Что нужно для
 *    согласования»; десять главных (тот же отбор, что у списка) — «главные»,
 *    остальные — «ещё»; сторона — «заказчику» (адресат — заказчик или человек
 *    из заявки) или «командам»;
 *  - у вопроса стабильный qid: в новой сборке БФТ тот же вопрос (близкий дубль
 *    у того же адресата) сохраняет qid, и данный ранее ответ не теряется;
 *  - форма версионируется: новая версия — когда пересобран БФТ или PO поправил
 *    вопросы и список от этого изменился.
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { collectQuestions, nearDuplicate, parseMarker, questionKey, UNASSIGNED, type QuestionRef } from './questions.js'

export const FORMS_ROOT = () => join(process.env.DSH_HOME ?? '/data', 'bft-forms')

export type FormSide = 'customer' | 'team'
export type FormPriority = 'main' | 'more'

export interface FormQuestion {
  qid: string
  text: string
  addressee: string
  refs: QuestionRef[]
  side: FormSide
  priority: FormPriority
  /** Добавил PO руками (нет маркера в документе). */
  manual?: boolean
}

export interface FormVersion {
  v: number
  at: string
  /** finishedAt сборки полного БФТ, по которой собраны вопросы. */
  deepAt: string
  /** Номер правок PO, учтённых в версии. */
  editsRev: number
  questions: FormQuestion[]
}

export type AnswerStatus = 'answer' | 'unknown'

export interface FormAnswer {
  qid: string
  /** Вопрос, на который отвечали (текст на момент ответа). */
  question: string
  addressee: string
  text: string
  /** «unknown» — «не знаю / не ко мне»: маркер в БФТ остаётся. */
  status: AnswerStatus
  author?: string
  at: string
  /** Версия формы, в которой дан ответ. */
  v: number
}

export interface FormEdits {
  rev: number
  added: FormQuestion[]
  removed: string[]
  edited: Record<string, { text?: string; addressee?: string }>
}

export interface BftForm {
  id: string
  slug: string
  sessionId: string
  title: string
  createdAt: string
  /** Ссылку выдали («Сформировать форму»); до этого форма — только правки PO. */
  publishedAt?: string
  revokedAt?: string
  /** Отозванная форма указывает на новую (тот же список и ответы под новым ключом). */
  movedTo?: string
  versions: FormVersion[]
  answers: Record<string, FormAnswer>
  /** Прежние ответы на тот же вопрос — ответ можно поменять, прошлый не теряется. */
  history: FormAnswer[]
  edits: FormEdits
  lastSubmitAt?: string
}

/** Человек заявки (primary.json → args.people). */
export interface FormPerson { name?: string; role?: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export const isFormId = (id: string) => UUID.test(id)

export const LIMITS = { answer: 4000, items: 100, author: 120, question: 500, addressee: 120, added: 50 } as const

const CANON_HEAD = '## Проблема которую решаем'
const CONTINUE_HEAD = '## Продолжить / уточнить БФТ'

/** Канон полного БФТ: без шапки fast и хвоста «Продолжить» — вопросы только из него. */
export function canonOf(md: string): string {
  const start = md.indexOf(CANON_HEAD)
  if (start < 0) return ''
  const end = md.indexOf(CONTINUE_HEAD, start)
  return md.slice(start, end < 0 ? undefined : end)
}

export const qidOf = (addressee: string, text: string) =>
  createHash('sha1').update(`${addressee.toLowerCase()}|${questionKey(text)}`).digest('hex').slice(0, 10)

const stems = (s: string) => (s.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}]{3,}/gu) ?? []).map((w) => w.slice(0, 5))

/**
 * Сторона вопроса: «заказчику» — адресат «заказчик» (в любом падеже) или
 * человек заявки (фамилия или имя совпадают основой: «у Петрова» — Петров);
 * остальные (команды, PO, юристы, адресат не назначен) — «командам».
 */
export function sideOf(addressee: string, people: readonly FormPerson[] = []): FormSide {
  if (/заказчик/i.test(addressee)) return 'customer'
  const who = new Set(stems(addressee))
  return people.some((p) => stems(p.name ?? '').some((s) => s.length >= 4 && who.has(s))) ? 'customer' : 'team'
}

const sameAddressee = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Вопросы формы по канону: все адресные маркеры (без потолка), главные — те же
 * десять, что в списке «Что нужно для согласования». qid берётся у прежнего
 * вопроса того же адресата с близким текстом — так ответ переживает пересборку.
 */
export function deriveQuestions(canon: string, people: readonly FormPerson[], known: readonly FormQuestion[] = []): FormQuestion[] {
  const main = new Set(collectQuestions({ canon }).map((q) => `${q.addressee.toLowerCase()}|${questionKey(q.text)}`))
  const used = new Set<string>()
  return collectQuestions({ canon }, Infinity).map((q) => {
    const prev = known.find((k) => !k.manual && !used.has(k.qid) && sameAddressee(k.addressee, q.addressee) && nearDuplicate(k.text, q.text))
    let qid = prev?.qid ?? qidOf(q.addressee, q.text)
    while (used.has(qid)) qid = qidOf(q.addressee, `${q.text}#${qid}`)
    used.add(qid)
    return {
      qid, text: q.text, addressee: q.addressee, refs: q.refs,
      side: sideOf(q.addressee, people),
      priority: main.has(`${q.addressee.toLowerCase()}|${questionKey(q.text)}`) ? 'main' as const : 'more' as const,
    }
  })
}

/** Правки PO поверх вопросов документа: убрать, переформулировать, сменить адресата, добавить свои. */
export function applyEdits(questions: readonly FormQuestion[], edits: FormEdits, people: readonly FormPerson[] = []): FormQuestion[] {
  const removed = new Set(edits.removed)
  const out = questions.filter((q) => !removed.has(q.qid)).map((q) => {
    const e = edits.edited[q.qid]
    if (!e) return q
    const addressee = e.addressee ?? q.addressee
    return { ...q, text: e.text ?? q.text, addressee, side: sideOf(addressee, people) }
  })
  for (const a of edits.added) {
    if (removed.has(a.qid)) continue
    const e = edits.edited[a.qid]
    const addressee = e?.addressee ?? a.addressee
    out.push({ ...a, text: e?.text ?? a.text, addressee, side: sideOf(addressee, people) })
  }
  return out
}

/** Все вопросы, которые форма когда-либо показывала (для стабильных qid). */
const knownQuestions = (form: BftForm) => form.versions.flatMap((v) => v.questions)

export const latestVersion = (form: BftForm): FormVersion | undefined => form.versions[form.versions.length - 1]

const fingerprint = (qs: readonly FormQuestion[]) =>
  JSON.stringify(qs.map((q) => [q.qid, q.text, q.addressee, q.side, q.priority]))

export function newForm(input: { slug: string; sessionId: string; title: string }, now = new Date()): BftForm {
  return {
    id: randomUUID(), slug: input.slug, sessionId: input.sessionId, title: input.title, createdAt: now.toISOString(),
    versions: [], answers: {}, history: [], edits: { rev: 0, added: [], removed: [], edited: {} },
  }
}

/**
 * Свести форму с текущим БФТ: пересобран документ (другой deepAt) или есть
 * новые правки PO — пересчитать вопросы; изменился список — новая версия,
 * иначе версия только помечается новым deepAt. true — форма изменилась.
 */
export function refreshForm(form: BftForm, doc: { md: string; deepAt: string; people?: readonly FormPerson[] }, now = new Date()): boolean {
  const last = latestVersion(form)
  if (last && last.deepAt === doc.deepAt && last.editsRev === form.edits.rev) return false
  const people = doc.people ?? []
  const questions = applyEdits(deriveQuestions(canonOf(doc.md), people, knownQuestions(form)), form.edits, people)
  if (last && fingerprint(last.questions) === fingerprint(questions)) {
    last.deepAt = doc.deepAt
    last.editsRev = form.edits.rev
    return true
  }
  form.versions.push({ v: (last?.v ?? 0) + 1, at: now.toISOString(), deepAt: doc.deepAt, editsRev: form.edits.rev, questions })
  return true
}

export type EditOp =
  | { op: 'add'; text: string; addressee: string }
  | { op: 'edit'; qid: string; text?: string; addressee?: string }
  | { op: 'remove'; qid: string }
  | { op: 'restore'; qid: string }

const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** Правка вопросов PO (шаг 2 HowToDemo). Ошибка — строка для ответа 400. */
export function editQuestions(form: BftForm, edit: EditOp, people: readonly FormPerson[] = []): string | undefined {
  const e = form.edits
  if (edit.op === 'add') {
    const text = clean(edit.text, LIMITS.question)
    const addressee = clean(edit.addressee, LIMITS.addressee) || UNASSIGNED
    if (text.split(/\s+/).length < 2) return 'вопрос — хотя бы два слова'
    if (e.added.length >= LIMITS.added) return `не больше ${LIMITS.added} своих вопросов`
    const asked = /\?$/.test(text) ? text : `${text}?`
    e.added.push({ qid: `m${qidOf(addressee, `${asked}#${e.rev}`).slice(0, 9)}`, text: asked, addressee, refs: [], side: sideOf(addressee, people), priority: 'main', manual: true })
  } else {
    const exists = knownQuestions(form).some((q) => q.qid === edit.qid) || e.added.some((q) => q.qid === edit.qid)
    if (!exists) return 'вопрос не найден'
    if (edit.op === 'remove') { if (!e.removed.includes(edit.qid)) e.removed.push(edit.qid) }
    else if (edit.op === 'restore') e.removed = e.removed.filter((q) => q !== edit.qid)
    else {
      const text = edit.text === undefined ? undefined : clean(edit.text, LIMITS.question)
      const addressee = edit.addressee === undefined ? undefined : clean(edit.addressee, LIMITS.addressee)
      if (text !== undefined && text.split(/\s+/).length < 2) return 'вопрос — хотя бы два слова'
      e.edited[edit.qid] = { ...e.edited[edit.qid], ...(text ? { text } : {}), ...(addressee ? { addressee } : {}) }
    }
  }
  e.rev++
  return undefined
}

export interface SubmitItem { qid: string; text?: string; status?: AnswerStatus }

/**
 * Ответы из формы. Принимаются только вопросы текущей версии и вопросы с
 * прежним ответом; пустой ответ без «не знаю» — пропуск (не стирает данный).
 * Возвращает число сохранённых ответов или ошибку.
 */
export function submitAnswers(form: BftForm, items: readonly SubmitItem[], author: string | undefined, now = new Date()): { saved: number } | { error: string } {
  if (!Array.isArray(items) || items.length > LIMITS.items) return { error: `не больше ${LIMITS.items} ответов за раз` }
  const current = latestVersion(form)
  if (!current) return { error: 'форма ещё не собрана' }
  const byQid = new Map(current.questions.map((q) => [q.qid, q]))
  const who = clean(author, LIMITS.author)
  let saved = 0
  for (const item of items) {
    if (!item || typeof item.qid !== 'string') continue
    const q = byQid.get(item.qid)
    const prev = form.answers[item.qid]
    if (!q && !prev) continue
    const status: AnswerStatus = item.status === 'unknown' ? 'unknown' : 'answer'
    const text = typeof item.text === 'string' ? item.text.trim().slice(0, LIMITS.answer) : ''
    if (status === 'answer' && !text) continue
    if (prev && prev.status === status && prev.text === text) continue
    if (prev) form.history.push(prev)
    form.answers[item.qid] = {
      qid: item.qid, question: q?.text ?? prev!.question, addressee: q?.addressee ?? prev!.addressee,
      text, status, ...(who ? { author: who } : {}), at: now.toISOString(), v: current.v,
    }
    saved++
  }
  if (saved) form.lastSubmitAt = now.toISOString()
  return { saved }
}

const day = (iso: string) => iso.slice(0, 10)

/**
 * Ответы для модели (контекст сборки полного БФТ): по вопросу — ответ, кто и
 * когда. «Не знаю» — отдельно: маркер остаётся. Пусто — ''.
 */
export function answersContext(form: BftForm | undefined): string {
  const all = form ? Object.values(form.answers) : []
  if (!all.length) return ''
  const answered = all.filter((a) => a.status === 'answer')
  const unknown = all.filter((a) => a.status === 'unknown')
  const line = (a: FormAnswer) => `- [у ${a.addressee}] ${a.question} → ${a.text.replace(/\s+/g, ' ')} (${a.author ? `${a.author}, ` : ''}${day(a.at)})`
  return [
    'Ответы на вопросы согласования (форма вопросов по БФТ; это ответы людей, к которым обращён вопрос, — решение заказчика или команды, R3):',
    ...answered.map(line),
    ...(unknown.length ? ['Не смогли ответить (маркер [УТОЧНИТЬ] остаётся, адресат прежний):', ...unknown.map((a) => `- [у ${a.addressee}] ${a.question}`)] : []),
  ].join('\n')
}

/** Ответы файлом заявки (папка «Заявка N» в рабочей области, выгрузка в трекер). */
export function answersMarkdown(form: BftForm): string {
  const all = Object.values(form.answers).sort((a, b) => a.at.localeCompare(b.at))
  const lines = [`# Ответы на вопросы по БФТ — ${form.title}`, '', `Форма: версия ${latestVersion(form)?.v ?? 0}, ответов ${all.length}.`, '']
  for (const a of all) {
    lines.push(`## ${a.question}`, '', `Кому: ${a.addressee}`, `Ответ: ${a.status === 'unknown' ? 'не знаю / не ко мне' : a.text}`, `Кто и когда: ${a.author ?? 'без имени'}, ${a.at.replace('T', ' ').slice(0, 16)} (версия формы ${a.v})`, '')
  }
  return lines.join('\n')
}

/**
 * Вопрос формы для пометки «[УТОЧНИТЬ у X: …]» в документе (шаг 9): тот же
 * адресат и близкий текст; без адресата в пометке — только по тексту.
 */
export function questionForMarker(markerInner: string, questions: readonly FormQuestion[]): FormQuestion | undefined {
  const { addressee, question } = parseMarker(markerInner)
  if (!question) return undefined
  return questions.find((q) => (!addressee || sameAddressee(q.addressee, addressee)) && nearDuplicate(q.text, question))
}

// ---- хранение ----

export const formPath = (id: string) => join(FORMS_ROOT(), `${id}.json`)
const linkPath = (fastDir: string) => join(fastDir, 'form.json')
export const answersPath = (fastDir: string) => join(fastDir, 'form-answers.md')

export async function readForm(id: string): Promise<BftForm | undefined> {
  if (!isFormId(id)) return undefined
  return readFile(formPath(id), 'utf8').then((t) => JSON.parse(t) as BftForm, () => undefined)
}

export async function saveForm(form: BftForm): Promise<void> {
  await mkdir(FORMS_ROOT(), { recursive: true })
  const tmp = `${formPath(form.id)}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(form), 'utf8')
  await rename(tmp, formPath(form.id))
}

/** Форма заявки (по ссылке из её папки). */
/** Название заявки для людей: без служебного «[БФТ]» и номера-слага («zayavka-1: …»). */
export function formTitle(title: string): string {
  const clean = title.replace(/^\s*\[БФТ\]\s*/i, '').replace(/^zayavka-\d+\s*[:—–-]\s*/i, '').trim()
  return clean || title.trim()
}

export async function formOfRequest(fastDir: string): Promise<BftForm | undefined> {
  const link = await readFile(linkPath(fastDir), 'utf8').then((t) => JSON.parse(t) as { id?: string }, () => undefined)
  return link?.id ? readForm(link.id) : undefined
}

export async function linkForm(fastDir: string, id: string): Promise<void> {
  await writeFile(linkPath(fastDir), JSON.stringify({ id }), 'utf8')
}

/** Отозвать ключ и выдать новый: тот же список, правки и ответы под новым id; старый ключ — «ссылка отозвана». */
export function reissue(form: BftForm, now = new Date()): { old: BftForm; fresh: BftForm } {
  const fresh: BftForm = { ...structuredClone(form), id: randomUUID(), createdAt: now.toISOString() }
  delete fresh.revokedAt
  delete fresh.movedTo
  delete fresh.publishedAt
  const old: BftForm = { ...form, revokedAt: now.toISOString(), movedTo: fresh.id }
  return { old, fresh }
}

/** Не чаще N отправок за окно на одну форму: ссылка открыта всем, кто её знает. */
export class SubmitGate {
  private hits = new Map<string, number[]>()
  constructor(private max = 30, private windowMs = 10 * 60_000) {}
  allow(id: string, now = Date.now()): boolean {
    const recent = (this.hits.get(id) ?? []).filter((t) => now - t < this.windowMs)
    if (recent.length >= this.max) { this.hits.set(id, recent); return false }
    recent.push(now)
    this.hits.set(id, recent)
    return true
  }
}
