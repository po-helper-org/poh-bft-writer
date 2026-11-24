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

// Входящие события: отправка формы → «Форма заполнена» со статусом пересборки (use case «Ответы формы → входящее событие»).
const answered = (at, submission, extra = {}) => ({ eventId: `form:answers:f1:${at}`, at, actor: { kind: 'customer' }, kind: 'formAnswered',
  data: { questions: { total: 10, answered: 2 }, rebuildAfterMs: 120_000, submission: { formId: 'f1', addressees: ['заказчика'], saved: 2, unknown: 0, ...submission } }, ...extra })
const at = (min) => `2026-11-20T10:${String(min).padStart(2, '0')}:00.000Z`
const agreed = () => run(ev('briefApproved'), ev('deepReady'))

test('отправка формы — входящее событие: кто, кому, сколько, ждёт паузу', () => {
  const s = reduce(agreed(), answered(at(1), { author: 'Мария Тестова', addressees: ['заказчика', 'Ивана Примерова'], saved: 3, unknown: 1 }))
  assert.equal(s.inbox.length, 1)
  const [e] = s.inbox
  assert.equal(e.kind, 'formSubmitted')
  assert.equal(e.author, 'Мария Тестова')
  assert.deepEqual(e.addressees, ['заказчика', 'Ивана Примерова'])
  assert.equal(e.saved, 3)
  assert.equal(e.unknown, 1)
  assert.deepEqual(e.rebuild, { state: 'waiting', dueAt: at(3) })
  assert.deepEqual(s.rebuild, { lastSubmitAt: at(1), dueAt: at(3) })
})

test('без подписи — author не выдумывается', () => {
  const s = reduce(agreed(), answered(at(1), {}))
  assert.equal(s.inbox[0].author, undefined)
})

test('вторая отправка сдвигает срок у обеих; пересборка → собирается → готово', () => {
  let s = reduce(agreed(), answered(at(1), { author: 'А' }))
  s = reduce(s, answered(at(2), { author: 'Б' }))
  assert.deepEqual(s.inbox.map((e) => e.rebuild), [{ state: 'waiting', dueAt: at(4) }, { state: 'waiting', dueAt: at(4) }])
  s = reduce(s, { eventId: 'rb', at: at(4), actor: { kind: 'system' }, kind: 'rebuildRequested', data: { lastSubmitAt: at(2), started: true } })
  assert.deepEqual(s.inbox.map((e) => e.rebuild.state), ['building', 'building'])
  s = reduce(s, { eventId: 'ds', at: at(5), actor: { kind: 'system' }, kind: 'deepStarted' })
  s = reduce(s, { eventId: 'dr', at: at(9), actor: { kind: 'system' }, kind: 'deepReady' })
  assert.deepEqual(s.inbox.map((e) => e.rebuild), [{ state: 'ready', at: at(9) }, { state: 'ready', at: at(9) }])
  assert.equal(s.round, 2)
})

test('портал не стал собирать — «не понадобилась» с причиной; ошибка — «ошибка»', () => {
  let s = reduce(agreed(), answered(at(1), {}))
  s = reduce(s, { eventId: 'rb', at: at(3), actor: { kind: 'system' }, kind: 'rebuildRequested', data: { lastSubmitAt: at(1), started: false, reason: 'ответы уже учтены сборкой' } })
  assert.deepEqual(s.inbox[0].rebuild, { state: 'skipped', at: at(3), reason: 'ответы уже учтены сборкой' })
  let f = reduce(agreed(), answered(at(1), {}))
  f = reduce(f, { eventId: 'rb', at: at(3), actor: { kind: 'system' }, kind: 'rebuildRequested', data: { lastSubmitAt: at(1), started: false, error: 'портал недоступен' } })
  assert.deepEqual(f.inbox[0].rebuild, { state: 'failed', at: at(3), reason: 'портал недоступен' })
})

test('ручная сборка после ответа тоже снимает ожидание; упавшая — ошибка', () => {
  let s = reduce(agreed(), answered(at(1), {}))
  s = reduce(s, { eventId: 'ds', at: at(2), actor: { kind: 'system' }, kind: 'deepStarted' })
  assert.equal(s.inbox[0].rebuild.state, 'building')
  s = reduce(s, { eventId: 'df', at: at(4), actor: { kind: 'system' }, kind: 'deepFailed', data: { error: 'модель не ответила' } })
  assert.deepEqual(s.inbox[0].rebuild, { state: 'failed', at: at(4), reason: 'модель не ответила' })
})

test('форма переиздана под новым ключом — та же отправка второй раз не заводится; старые события без submission — без входящих', () => {
  let s = reduce(agreed(), answered(at(1), {}))
  s = reduce(s, { ...answered(at(1), { formId: 'f2' }), eventId: `form:answers:f2:${at(1)}` })
  assert.equal(s.inbox.length, 1)
  const old = reduce(agreed(), { eventId: 'old', at: at(1), actor: { kind: 'customer' }, kind: 'formAnswered', data: { questions: { total: 3, answered: 1 } } })
  assert.equal(old.inbox, undefined)
})
