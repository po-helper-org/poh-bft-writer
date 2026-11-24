/**
 * Теневой режим жизненного цикла (ADR-0022, шаг 1): события заявки — из её файлов.
 *
 * Один путь и для истории старых заявок, и для живых изменений: портал периодически
 * снимает «снимок» заявки (трекер, сценарий, первичные, полный БФТ, форма, правки) и
 * переводит его в события с ПОСТОЯННЫМИ eventId — цикл повтор отбрасывает, так что
 * отправлять можно сколько угодно раз. Ловит всё, что меняет файлы: инструменты
 * чата, маршруты портала, MCP внешних агентов, правки ИИ-агента.
 *
 * Чего в файлах нет — нет и здесь: ходы чата и время, когда сценарий был предложен
 * (у согласованного сценария его заменяет согласование). Это события шагов 2–3.
 */
import type { LifecycleEvent } from './lifecycle.js'

export interface RequestSnapshot {
  taskId: number
  title: string
  /** ISO-время создания задачи в трекере. */
  created: string
  /** Колонка доски «Запросы». */
  status?: string
  /** Сценарий приёмки: ревизия, согласован ли. */
  demo?: { rev: number; approvedAt?: string }
  /** Первичные требования: хэш версии, когда записаны (mtime), согласование. */
  fast?: { rev: string; builtAt: string; approvedAt?: string }
  /** Полный БФТ: состояние последней сборки. */
  deep?: { stage: 'building' | 'ready' | 'failed'; startedAt: string; finishedAt?: string; error?: string }
  form?: {
    id: string
    createdAt: string
    publishedAt?: string
    revokedAt?: string
    total: number
    answers: Array<{ at: string; status: 'answer' | 'unknown' }>
  }
  revisions?: Array<{ id: string; kind: string; at: string; stage: string; finishedAt?: string; edits?: number; error?: string }>
  /** Время снимка — для событий без своего времени (перенос в трекере). */
  now: string
  /** Пауза после ответа формы до пересборки полного БФТ — её отсчитывает цикл (шаг 2). */
  rebuildAfterMs?: number
}

const system = { kind: 'system' as const }
const customer = { kind: 'customer' as const }
const po = { kind: 'po' as const }

/** Колонки трекера, перенос в которые не новость (заявка в них рождается). */
const INITIAL_STATUSES = ['Создан']

/** Время — в UTC ISO: трекер отдаёт со смещением (+03:00), файлы — в UTC; сравниваем строки. */
export function isoUtc(at: string | undefined): string {
  const t = at ? Date.parse(at) : NaN
  return Number.isNaN(t) ? '' : new Date(t).toISOString()
}

export function historyEvents(s: RequestSnapshot): LifecycleEvent[] {
  const out: LifecycleEvent[] = []
  const push = (e: LifecycleEvent) => { const at = isoUtc(e.at); if (at) out.push({ ...e, at }) }

  if (s.demo) {
    // Время предложения сценария в файлах не хранится: согласованный — только согласованием.
    if (s.demo.approvedAt) push({ eventId: 'scenario:approved', at: s.demo.approvedAt, actor: customer, kind: 'scenarioApproved' })
    else push({ eventId: `scenario:proposed:${s.demo.rev}`, at: s.now, actor: system, kind: 'scenarioProposed', summary: `Предложен сценарий приёмки (версия ${s.demo.rev})` })
  }
  if (s.fast) {
    push({ eventId: `brief:built:${s.fast.rev}`, at: s.fast.builtAt, actor: system, kind: 'briefBuilt', data: { artifact: { path: 'fast.md', rev: s.fast.rev } } })
    if (s.fast.approvedAt) push({ eventId: `brief:approved:${s.fast.rev}`, at: s.fast.approvedAt, actor: customer, kind: 'briefApproved' })
  }
  if (s.deep) {
    const run = s.deep.startedAt
    push({ eventId: `deep:started:${run}`, at: run, actor: system, kind: 'deepStarted' })
    // Правки ИИ-агента переписывают finishedAt: готов документ был не позже первой правки после сборки.
    const firstRevision = (s.revisions ?? []).map((r) => isoUtc(r.at)).filter((at) => at && at >= isoUtc(run)).sort()[0]
    const readyAt = [isoUtc(s.deep.finishedAt ?? run), firstRevision].filter(Boolean).sort()[0]!
    if (s.deep.stage === 'ready') push({ eventId: `deep:ready:${run}`, at: readyAt, actor: system, kind: 'deepReady', data: { artifact: { path: 'deep.md', rev: run } } })
    if (s.deep.stage === 'failed') push({ eventId: `deep:failed:${run}`, at: s.deep.finishedAt ?? run, actor: system, kind: 'deepFailed', ...(s.deep.error ? { summary: `Полный БФТ не собран: ${s.deep.error.slice(0, 160)}`, data: { error: s.deep.error.slice(0, 500) } } : {}) })
  }
  if (s.form?.publishedAt) {
    const f = s.form
    push({ eventId: `form:published:${f.id}`, at: f.publishedAt!, actor: po, kind: 'formPublished', data: { artifact: { path: `bft-forms/${f.id}.json` }, questions: { total: f.total, answered: 0 } } })
    // Одна отправка формы — одно событие: ответы с одним временем сохранены одной отправкой.
    const submits = [...new Set(f.answers.map((a) => a.at))].sort()
    for (const at of submits) {
      const upTo = f.answers.filter((a) => a.at <= at)
      const answered = upTo.filter((a) => a.status === 'answer').length
      const unknown = upTo.filter((a) => a.status === 'unknown').length
      const here = f.answers.filter((a) => a.at === at).length
      push({ eventId: `form:answers:${f.id}:${at}`, at, actor: { kind: 'customer' }, kind: 'formAnswered', summary: `Ответы формы: +${here}, всего отвечено ${answered} из ${f.total}`, data: { questions: { total: f.total, answered, unknown }, ...(s.rebuildAfterMs !== undefined ? { rebuildAfterMs: s.rebuildAfterMs } : {}) } })
    }
    if (f.revokedAt) push({ eventId: `form:revoked:${f.id}`, at: f.revokedAt, actor: po, kind: 'formRevoked' })
  }
  for (const r of s.revisions ?? []) {
    if (r.stage !== 'ready' && r.stage !== 'failed') continue
    const what = r.kind === 'undo' ? 'Откат правки' : r.kind === 'review' ? 'Полное ревью' : 'Правки ИИ-агента'
    push({
      eventId: `revise:${r.id}:${r.stage}`, at: r.finishedAt ?? r.at, actor: po,
      kind: r.stage === 'ready' ? 'reviseApplied' : 'note',
      summary: r.stage === 'ready' ? `${what}: внесено ${r.edits ?? 0}` : `${what} не внесены${r.error ? `: ${r.error.slice(0, 120)}` : ''}`,
    })
  }
  if (s.status && !INITIAL_STATUSES.includes(s.status)) {
    push({ eventId: `tracker:${s.status}`, at: s.now, actor: po, kind: 'trackerMoved', summary: `В трекере: «${s.status}»`, data: { to: s.status } })
  }
  // Цикл применяет события по порядку прихода — отправляем в порядке времени.
  return out.sort((a, b) => a.at.localeCompare(b.at))
}
