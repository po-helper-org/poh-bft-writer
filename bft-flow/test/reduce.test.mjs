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

test('форма опубликована до пересборки — после готовности ждём её адресатов; отзыв — снова PO', () => {
  let s = run(ev('briefApproved'), ev('deepStarted'), ev('formPublished', { data: { addressees: ['заказчика'] } }))
  assert.equal(s.stage, 'deep')
  s = reduce(s, ev('deepReady'))
  assert.deepEqual(s.waitingFor, ['customer'])
  s = reduce(s, ev('formRevoked'))
  assert.deepEqual(s.waitingFor, ['po'])
  assert.equal(s.formOpen, undefined)
})

test('шаг 2: ответ формы ставит пересборку через паузу, новый ответ сдвигает, сборка снимает', () => {
  const at = (m) => `2026-11-20T10:${String(m).padStart(2, '0')}:00.000Z`
  const e = (id, kind, m, data) => ({ eventId: id, at: at(m), actor: { kind: 'customer' }, kind, ...(data ? { data } : {}) })
  let s = run(ev('briefApproved'), ev('deepReady'))
  s = reduce(s, e('a1', 'formAnswered', 1, { rebuildAfterMs: 120_000 }))
  assert.deepEqual(s.rebuild, { lastSubmitAt: at(1), dueAt: at(3) })
  s = reduce(s, e('a2', 'formAnswered', 2, { rebuildAfterMs: 120_000 }))
  assert.deepEqual(s.rebuild, { lastSubmitAt: at(2), dueAt: at(4) })
  // Старый ответ (догрузка истории не по порядку) не откатывает ожидание.
  assert.deepEqual(reduce(s, e('a0', 'formAnswered', 0, { rebuildAfterMs: 120_000 })).rebuild, s.rebuild)
  // Ответы без паузы (старый портал) пересборку не ставят.
  assert.equal(reduce(run(ev('deepReady')), e('x', 'formAnswered', 5)).rebuild, undefined)
  // Сборка до последнего ответа не снимает, после — снимает.
  assert.ok(reduce(s, e('d1', 'deepStarted', 1)).rebuild)
  assert.equal(reduce(s, e('d2', 'deepStarted', 3)).rebuild, undefined)
  // Запрос пересборки по последнему ответу снимает; начал портал сборку — стадия «пересборка».
  const asked = reduce(s, e('r1', 'rebuildRequested', 5, { lastSubmitAt: at(2), started: true }))
  assert.equal(asked.rebuild, undefined)
  assert.equal(asked.stage, 'rebuilding')
  const skipped = reduce(s, e('r2', 'rebuildRequested', 5, { lastSubmitAt: at(2), started: false }))
  assert.equal(skipped.rebuild, undefined)
  assert.equal(skipped.stage, 'agreement')
  assert.equal(statusOf(s).rebuild.dueAt, at(4))
})

test('шаг 4: колонка трекера — в состоянии; решения PO меняют стадию; устаревший снимок отброшен', () => {
  const at = (m) => `2026-11-21T10:${String(m).padStart(2, '0')}:00.000Z`
  const seen = (id, to, m, actor = 'po') => ({ eventId: id, at: at(m), actor: { kind: actor }, kind: 'trackerObserved', data: { to } })
  let s = run(ev('briefApproved'), ev('deepReady'))
  assert.equal(s.column, undefined)
  s = reduce(s, seen('t1', 'Создан', 1))
  assert.equal(s.column, 'Создан')
  assert.equal(s.stage, 'agreement')
  s = reduce(s, seen('t2', 'Проработка БФТ', 3, 'system'))
  // Снимок портала, сделанный до переноса циклом, — не откатывает колонку.
  assert.equal(reduce(s, seen('t3', 'Создан', 2)).column, 'Проработка БФТ')
  const needsPo = reduce(s, seen('t4', 'Ожидает PO', 4))
  assert.equal(needsPo.stage, 'agreement')
  assert.deepEqual(needsPo.waitingFor, ['po'])
  assert.equal(reduce(s, seen('t5', 'Оценка', 4)).stage, 'validated')
  assert.equal(reduce(s, seen('t6', 'В работу: влёт этого квартала', 4)).stage, 'handed_off')
  assert.equal(reduce(s, seen('t7', 'Отменено', 4)).stage, 'cancelled')
  assert.equal(statusOf(s).column, 'Проработка БФТ')
})
