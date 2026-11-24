// Стадии цикла БФТ из событий (ADR-0022): чистая reduce без Temporal.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialState, reduce, statusOf } from '../lib/reduce.js'

const input = { taskId: 7, slug: 'zayavka-7', sessionId: 's-7', title: 'Поток заказов', createdAt: '2026-11-19T10:00:00Z' }
let n = 0
const ev = (kind, extra = {}) => ({ eventId: `e${++n}`, at: `2026-11-19T10:${String(n).padStart(2, '0')}:00Z`, actor: { kind: 'system' }, kind, ...extra })
const run = (...events) => events.reduce(reduce, initialState(input))

test('сквозной путь: диалог → сценарий → бриф → полный БФТ → согласование', () => {
  const s = run(ev('registered'), ev('scenarioProposed'), ev('scenarioApproved'), ev('briefBuilt', { data: { artifact: { path: 'zayavka-7-fast.md' } } }),
    ev('briefApproved'), ev('deepStarted'), ev('deepReady', { data: { artifact: { path: 'zayavka-7.md', sha256: 'abc' } } }))
  assert.equal(s.stage, 'agreement')
  assert.deepEqual(s.waitingFor, ['po'])
  assert.equal(s.round, 1)
  assert.equal(s.artifacts.brief.path, 'zayavka-7-fast.md')
  assert.equal(s.artifacts.deep.sha256, 'abc')
  assert.deepEqual(s.timeline.map((t) => t.stage), ['intake', 'scenario', 'brief', 'brief_review', 'deep', 'deep', 'agreement'])
  assert.equal(s.timeline[2].summary, 'Заказчик согласовал сценарий приёмки')
})

test('раунд: форма → ответы → пересборка → раунд 2', () => {
  let s = run(ev('briefApproved'), ev('deepReady'))
  s = reduce(s, ev('formPublished', { data: { addressees: ['заказчика', 'команды Платёжки'] } }))
  assert.deepEqual(s.waitingFor, ['customer', 'team:команды Платёжки'])
  s = reduce(s, ev('formAnswered', { data: { questions: { total: 12, answered: 3 } } }))
  assert.deepEqual(s.questions, { total: 12, answered: 3 })
  s = reduce(s, ev('deepStarted'))
  assert.equal(s.stage, 'rebuilding')
  s = reduce(s, ev('deepReady'))
  assert.equal(s.round, 2)
})

test('повтор события и события после отмены — без изменений', () => {
  const e = ev('registered')
  const s = reduce(reduce(initialState(input), e), e)
  assert.equal(s.events, 1)
  const cancelled = reduce(s, ev('cancelled'))
  assert.equal(cancelled.stage, 'cancelled')
  assert.equal(reduce(cancelled, ev('deepReady')), cancelled)
})

test('сборка не удалась → ждём PO; хроника ограничена', () => {
  assert.equal(run(ev('briefApproved'), ev('deepFailed', { data: { error: 'модель недоступна' } })).stage, 'deep_failed')
  let s = initialState(input)
  for (let i = 0; i < 250; i++) s = reduce(s, ev('note'))
  assert.equal(s.timeline.length, 200)
  assert.equal(statusOf(s).events, 250)
})
