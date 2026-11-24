// «Ответы формы → входящее событие в БФТ» (ADR-0027): отправка формы — входящее событие заявки.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { submissionsOf, submitAnswers } from '../lib-test/forms.js'
import { inboxView, rebuildLabel } from '../lib-test/form-inbox.js'
import { historyEvents } from '../lib-test/lifecycle-history.js'
import { deepFormSidebar, formPage } from '../lib-test/form-page.js'

const Q = (qid, text, addressee, side = 'team') => ({ qid, text, addressee, side, priority: 'main', refs: [{ section: 'Функциональные требования', id: 'ФТ-3' }] })
const questions = [Q('a', 'Какой лимит промокодов?', 'заказчика', 'customer'), Q('b', 'Есть ли событие покупки?', 'Ивана Примерова'), Q('c', 'Нужен ли отчёт?', 'Ивана Примерова')]
const form = () => ({
  id: '11111111-2222-4333-8444-555555555555', slug: 'zayavka-7', sessionId: 's7', title: 'Промокоды', createdAt: '2026-11-20T09:00:00Z', publishedAt: '2026-11-20T09:05:00Z',
  versions: [{ v: 1, at: '2026-11-20T09:00:00Z', deepAt: 'd1', editsRev: 0, questions }], answers: {}, history: [], edits: { rev: 0, added: [], removed: [], edited: {} },
})
const T1 = new Date('2026-11-20T10:00:00Z'), T2 = new Date('2026-11-20T11:00:00Z')

test('одна отправка — ответы с одним временем; заменённый позже ответ отправка не теряет', () => {
  const f = form()
  submitAnswers(f, [{ qid: 'b', text: 'Да, есть' }, { qid: 'c', status: 'unknown' }], 'Мария Тестова', T1)
  submitAnswers(f, [{ qid: 'b', text: 'Да, событие order_paid' }], '', T2)
  const subs = submissionsOf(f)
  assert.equal(subs.length, 2)
  const [first, second] = subs
  assert.equal(first.at, T1.toISOString())
  assert.equal(first.author, 'Мария Тестова')
  assert.deepEqual(first.addressees, ['Ивана Примерова'])
  assert.deepEqual(first.items.map((i) => [i.qid, i.status, i.text]), [['b', 'answer', 'Да, есть'], ['c', 'unknown', '']])
  assert.equal(first.saved, 2)
  assert.equal(first.unknown, 1)
  assert.equal(second.author, undefined, 'без подписи — не выдумываем')
  assert.equal(second.items[0].text, 'Да, событие order_paid')
})

test('событие цикла по отправке: кто, кому, сколько — без текстов ответов; eventId прежний', () => {
  const at = '2026-11-20T10:00:00.000Z'
  const events = historyEvents({
    taskId: 7, title: 'Промокоды', created: '2026-11-19T09:00:00Z', now: '2026-11-24T12:00:00Z', rebuildAfterMs: 120_000,
    form: { id: 'f1', createdAt: '2026-11-20T09:00:00Z', publishedAt: '2026-11-20T09:05:00Z', total: 3,
      answers: [{ at, status: 'answer', author: 'Мария Тестова', addressee: 'Ивана Примерова' }, { at, status: 'unknown', author: 'Мария Тестова', addressee: 'Ивана Примерова' }] },
  })
  const e = events.find((x) => x.kind === 'formAnswered')
  assert.equal(e.eventId, `form:answers:f1:${at}`)
  assert.deepEqual(e.data.submission, { formId: 'f1', author: 'Мария Тестова', addressees: ['Ивана Примерова'], saved: 2, unknown: 1 })
  assert.equal(e.actor.name, 'Мария Тестова')
  assert.match(e.summary, /^Форма заполнена \(Мария Тестова\): \+2/)
  assert.ok(!JSON.stringify(e).includes('Да,'), 'тексты ответов — только в файле формы')
})

test('входящие: статус пересборки из процесса, ответы из файла; неизвестные процессу — честно без статуса', () => {
  const f = form()
  submitAnswers(f, [{ qid: 'a', text: '3 в месяц' }], 'Мария Тестова', T1)
  submitAnswers(f, [{ qid: 'b', status: 'unknown' }], '', T2)
  const cycle = [{ id: `form:answers:${f.id}:${T2.toISOString()}`, kind: 'formSubmitted', at: T2.toISOString(), formId: f.id, addressees: ['Ивана Примерова'], saved: 1, unknown: 1,
    rebuild: { state: 'waiting', dueAt: '2026-11-20T11:02:00.000Z' } }]
  const view = inboxView(f, cycle)
  assert.equal(view.cycle, true)
  assert.deepEqual(view.items.map((i) => i.rebuild.state), ['waiting', 'unknown'], 'новые сверху')
  assert.equal(view.items[0].author, undefined)
  assert.deepEqual(view.items[0].items, [{ qid: 'b', question: 'Есть ли событие покупки?', addressee: 'Ивана Примерова', text: '', status: 'unknown' }])
  assert.match(view.items[0].rebuild.label, /^Ждёт паузу — пересборка в /)
  assert.equal(view.items[1].author, 'Мария Тестова')
  assert.match(view.items[1].rebuild.label, /Нет в процессе заявки/)
  const down = inboxView(f, undefined)
  assert.equal(down.cycle, false)
  assert.ok(down.items.every((i) => /процесс заявки недоступен/.test(i.rebuild.label)))
})

test('подписи статусов пересборки', () => {
  assert.equal(rebuildLabel({ state: 'building' }, true), 'Собирается по этим ответам')
  assert.match(rebuildLabel({ state: 'ready', at: '2026-11-20T11:09:00Z' }, true), /^Готово — учтено в БФТ /)
  assert.equal(rebuildLabel({ state: 'failed', reason: 'модель не ответила' }, true), 'Ошибка пересборки: модель не ответила')
  assert.equal(rebuildLabel({ state: 'skipped', reason: 'ответы уже учтены сборкой' }, true), 'Пересборка не понадобилась: ответы уже учтены сборкой')
})

test('сайдбар документа: раздел «Входящие» с опросом и оповещением, если есть адрес', () => {
  const layer = { sessionId: 's7', questions, answers: {}, removed: [], api: { create: 'c', revoke: 'r', edit: 'e', inbox: 'customer-form.formInbox' } }
  const html = deepFormSidebar(layer)
  assert.match(html, /id="csInbox"/)
  assert.match(html, /"customer-form\.formInbox"/)
  assert.match(html, /Форма заполнена/)
  assert.ok(html.indexOf('id="csInbox"') < html.indexOf('class="cs-sb-group"'), 'входящие — над вопросами')
  assert.ok(!deepFormSidebar({ ...layer, api: { create: 'c', revoke: 'r', edit: 'e' } }).includes('id="csInbox"'))
})

test('форма: после отправки — плашка «Ответы отправлены»; прежняя отправка видна в шапке', () => {
  const f = form()
  const html = formPage(f, f.versions[0], { previewHref: 'preview', answerHref: 'form/answer' })
  assert.match(html, /id="sent"[^>]*hidden/)
  assert.ok(!html.includes('Последняя отправка ответов'))
  submitAnswers(f, [{ qid: 'a', text: '3 в месяц' }], '', T1)
  assert.match(formPage(f, f.versions[0], { previewHref: 'preview', answerHref: 'form/answer' }), /Последняя отправка ответов: /)
})

test('отправка старше готовой сборки — учтена: coveredBy, без паузы пересборки', () => {
  const at = '2026-11-20T10:00:00.000Z'
  const base = { taskId: 7, title: 'Промокоды', created: '2026-11-19T09:00:00Z', now: '2026-11-24T12:00:00Z', rebuildAfterMs: 120_000,
    form: { id: 'f2', createdAt: '2026-11-21T09:00:00Z', publishedAt: '2026-11-21T09:05:00Z', total: 3, answers: [{ at, status: 'answer', addressee: 'заказчика' }] } }
  const covered = historyEvents({ ...base, deep: { stage: 'ready', startedAt: '2026-11-20T10:05:00.000Z', finishedAt: '2026-11-20T10:15:00.000Z' } }).find((x) => x.kind === 'formAnswered')
  assert.equal(covered.data.submission.coveredBy, '2026-11-20T10:05:00.000Z')
  assert.equal(covered.data.rebuildAfterMs, undefined)
  const fresh = historyEvents({ ...base, deep: { stage: 'building', startedAt: '2026-11-20T10:05:00.000Z' } }).find((x) => x.kind === 'formAnswered')
  assert.equal(fresh.data.submission.coveredBy, undefined, 'идёт сборка — ответы ждут следующую')
  assert.equal(fresh.data.rebuildAfterMs, 120_000)
})
