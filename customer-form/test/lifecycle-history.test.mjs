// Теневой режим жизненного цикла (ADR-0022, шаг 1): события заявки из её файлов.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { historyEvents } from '../lib-test/lifecycle-history.js'

const base = { taskId: 7, title: 'Поток заказов', created: '2026-11-19T09:00:00Z', now: '2026-11-24T12:00:00Z' }

test('в диалоге — событий нет (registered шлёт портал отдельно)', () => {
  assert.deepEqual(historyEvents({ ...base, status: 'Создан' }), [])
})

test('полный путь по файлам: порядок по времени, постоянные eventId', () => {
  const s = {
    ...base,
    demo: { rev: 2, approvedAt: '2026-11-19T09:20:00Z' },
    fast: { rev: 'abc', builtAt: '2026-11-19T09:25:00Z', approvedAt: '2026-11-19T09:40:00Z' },
    deep: { stage: 'ready', startedAt: '2026-11-19T09:41:00Z', finishedAt: '2026-11-19T09:55:00Z' },
    form: {
      id: 'f1', createdAt: '2026-11-20T10:00:00Z', publishedAt: '2026-11-20T10:05:00Z', total: 12,
      answers: [{ at: '2026-11-21T08:00:00Z', status: 'answer' }, { at: '2026-11-21T08:00:00Z', status: 'unknown' }, { at: '2026-11-22T08:00:00Z', status: 'answer' }],
    },
    revisions: [
      { id: 'r1', kind: 'revise', at: '2026-11-23T10:00:00Z', stage: 'ready', finishedAt: '2026-11-23T10:02:00Z', edits: 3 },
      { id: 'r2', kind: 'revise', at: '2026-11-23T11:00:00Z', stage: 'writing' },
    ],
    status: 'Проработка БФТ',
  }
  const events = historyEvents(s)
  assert.deepEqual(events.map((e) => e.kind), ['scenarioApproved', 'briefBuilt', 'briefApproved', 'deepStarted', 'deepReady', 'formPublished', 'formAnswered', 'formAnswered', 'reviseApplied', 'trackerMoved'])
  assert.deepEqual(events.map((e) => e.eventId), [
    'scenario:approved', 'brief:built:abc', 'brief:approved:abc', 'deep:started:2026-11-19T09:41:00Z', 'deep:ready:2026-11-19T09:41:00Z',
    'form:published:f1', 'form:answers:f1:2026-11-21T08:00:00Z', 'form:answers:f1:2026-11-22T08:00:00Z', 'revise:r1:ready', 'tracker:Проработка БФТ',
  ])
  const [first, second] = events.filter((e) => e.kind === 'formAnswered')
  assert.deepEqual(first.data.questions, { total: 12, answered: 1, unknown: 1 })
  assert.deepEqual(second.data.questions, { total: 12, answered: 2, unknown: 1 })
  assert.equal(first.data.rebuildAfterMs, undefined, 'без паузы — цикл пересборку не ставит')
  const timed = historyEvents({ ...s, rebuildAfterMs: 120_000 }).filter((e) => e.kind === 'formAnswered')
  assert.deepEqual(timed.map((e) => e.data.rebuildAfterMs), [120_000, 120_000])
  assert.deepEqual(timed.map((e) => e.eventId), [first.eventId, second.eventId], 'пауза не меняет eventId')
  assert.match(events.find((e) => e.kind === 'reviseApplied').summary, /внесено 3/)
  // Повторный снимок — те же события: цикл их отбросит.
  assert.deepEqual(historyEvents(s).map((e) => e.eventId), events.map((e) => e.eventId))
})

test('пересборка полного БФТ — новые события (другой startedAt), сбой — с причиной', () => {
  const a = historyEvents({ ...base, deep: { stage: 'ready', startedAt: '2026-11-20T10:00:00Z', finishedAt: '2026-11-20T10:20:00Z' } }).map((e) => e.eventId)
  const b = historyEvents({ ...base, deep: { stage: 'building', startedAt: '2026-11-21T10:00:00Z' } }).map((e) => e.eventId)
  assert.equal(a.length, 2)
  assert.ok(!b.some((id) => a.includes(id)))
  const failed = historyEvents({ ...base, deep: { stage: 'failed', startedAt: '2026-11-22T10:00:00Z', finishedAt: '2026-11-22T10:05:00Z', error: 'модель недоступна' } })
  assert.equal(failed.at(-1).kind, 'deepFailed')
  assert.match(failed.at(-1).summary, /модель недоступна/)
})

test('сценарий без согласования — предложен (время снимка); форма не опубликована — молчит', () => {
  const events = historyEvents({ ...base, demo: { rev: 1 }, form: { id: 'f', createdAt: 'x', total: 3, answers: [] } })
  assert.deepEqual(events.map((e) => e.eventId), ['scenario:proposed:1'])
  assert.equal(events[0].at, '2026-11-24T12:00:00.000Z')
})

test('время — в UTC: смещение трекера (+03:00) и правки ИИ-агента не путают порядок', () => {
  const events = historyEvents({
    ...base,
    fast: { rev: 'r', builtAt: '2026-11-19T11:25:00+03:00', approvedAt: '2026-11-19T08:40:00Z' },
    // Правка ИИ-агента переписала finishedAt — готов документ был не позже первой правки.
    deep: { stage: 'ready', startedAt: '2026-11-19T08:41:00Z', finishedAt: '2026-11-24T12:30:00Z' },
    revisions: [{ id: 'r1', kind: 'revise', at: '2026-11-23T14:50:00Z', stage: 'ready', finishedAt: '2026-11-23T14:53:00Z', edits: 1 }],
  })
  assert.deepEqual(events.map((e) => e.kind), ['briefBuilt', 'briefApproved', 'deepStarted', 'deepReady', 'reviseApplied'])
  assert.equal(events[0].at, '2026-11-19T08:25:00.000Z')
  assert.equal(events.find((e) => e.kind === 'deepReady').at, '2026-11-23T14:50:00.000Z')
})
