// Форма вопросов по БФТ (ADR-0018): вопросы из маркеров, стороны, стабильные qid, версии, ответы, страницы.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { answersContext, applyEdits, canonOf, deriveQuestions, editQuestions, latestVersion, newForm, questionForMarker, refreshForm, reissue, sideOf, submitAnswers, SubmitGate } from '../lib-test/forms.js'
import { arrange, formPage, linkMarks, mailPlan, previewPage } from '../lib-test/form-page.js'

const doc = (extra = '') => [
  '# [БФТ] zayavka-7: Отчёт по возвратам для партнёров', '',
  'шапка fast [УТОЧНИТЬ у заказчика: этот вопрос из шапки не в форме?]', '',
  '## Проблема которую решаем', '',
  '| Поле | Значение |', '|---|---|',
  '| ЧТО ДЕЛАЕМ | Отчёт по возвратам [УТОЧНИТЬ у заказчика: за какой период нужен отчёт?] |', '',
  '## Функциональные требования*', '',
  '| ID | Описание | Приоритет |', '|---|---|---|',
  '| ФТ-1 | Выгрузка возвратов [УТОЧНИТЬ у команды Платёжки: в каком формате отдаются возвраты?] | Высокий |',
  '| ФТ-2 | Тестовый доступ [УТОЧНИТЬ у Петрова: кто выдаёт тестовую учётку партнёра?] | Средний |',
  extra, '',
  '## Продолжить / уточнить БФТ', '', '[УТОЧНИТЬ у PO: этот вопрос из хвоста не в форме?]', '',
].join('\n')
const people = [{ name: 'Иван Петров', role: 'Заказчик' }]

test('вопросы — только из канона, сторона по адресату', () => {
  assert.ok(!canonOf(doc()).includes('шапка fast'))
  const qs = deriveQuestions(canonOf(doc()), people)
  assert.deepEqual(qs.map((q) => q.text), ['За какой период нужен отчёт?', 'В каком формате отдаются возвраты?', 'Кто выдаёт тестовую учётку партнёра?'])
  assert.deepEqual(qs.map((q) => q.side), ['customer', 'team', 'customer'])
  assert.equal(sideOf('команды Платёжки'), 'team')
  assert.equal(sideOf('заказчика'), 'customer')
  assert.ok(qs.every((q) => q.priority === 'main'))
})

test('больше десяти вопросов — все в форме, главные — первые десять', () => {
  const things = ['лимит партии', 'срок хранения', 'формат накладной', 'адрес склада', 'график отгрузки', 'тип упаковки', 'вес коробки', 'цвет этикетки', 'способ оплаты', 'канал уведомления', 'язык интерфейса', 'часовой пояс', 'валюта расчёта']
  const rows = things.map((t, i) => `| ФТ-${i + 3} | Пункт [УТОЧНИТЬ у команды Склада: какой ${t} нужен?] | Низкий |`).join('\n')
  const qs = deriveQuestions(canonOf(doc(rows)), people)
  assert.equal(qs.length, 16)
  assert.equal(qs.filter((q) => q.priority === 'main').length, 10)
})

test('qid переживает пересборку: тот же вопрос другими словами — тот же qid и ответ', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт' })
  assert.ok(refreshForm(form, { md: doc(), deepAt: '2026-11-19T10:00:00Z', people }))
  const v1 = latestVersion(form)
  const period = v1.questions.find((q) => /период/.test(q.text))
  const res = submitAnswers(form, [{ qid: period.qid, text: 'За прошлую неделю' }], 'Иван')
  assert.deepEqual(res, { saved: 1 })
  // Пересборка: вопрос о периоде переформулирован, вопрос о формате закрыт ответом.
  const md2 = doc().replace('за какой период нужен отчёт?', 'за какой период нужен отчёт партнёру?').replace(/\[УТОЧНИТЬ у команды Платёжки:[^\]]*\]/, 'CSV (ответ в форме согласования)')
  assert.ok(refreshForm(form, { md: md2, deepAt: '2026-11-19T11:00:00Z', people }))
  const v2 = latestVersion(form)
  assert.equal(v2.v, 2)
  assert.equal(v2.questions.length, 2)
  assert.equal(v2.questions.find((q) => /период/.test(q.text)).qid, period.qid)
  assert.equal(form.answers[period.qid].text, 'За прошлую неделю')
  // Тот же документ — версия не меняется.
  assert.equal(refreshForm(form, { md: md2, deepAt: '2026-11-19T11:00:00Z', people }), false)
})

test('правки PO: свой вопрос, переформулировка, адресат, убрать и вернуть — новая версия', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт' })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  const [first, second] = latestVersion(form).questions
  assert.equal(editQuestions(form, { op: 'add', text: 'Нужна ли выгрузка в Excel', addressee: 'заказчика' }, people), undefined)
  assert.equal(editQuestions(form, { op: 'edit', qid: first.qid, text: 'За какой период строить отчёт?' }, people), undefined)
  assert.equal(editQuestions(form, { op: 'edit', qid: second.qid, addressee: 'заказчика' }, people), undefined)
  assert.equal(editQuestions(form, { op: 'remove', qid: 'нет-такого' }), 'вопрос не найден')
  assert.equal(editQuestions(form, { op: 'add', text: 'Excel', addressee: 'x' }), 'вопрос — хотя бы два слова')
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  const v = latestVersion(form)
  assert.equal(v.v, 2)
  assert.equal(v.questions.find((q) => q.qid === first.qid).text, 'За какой период строить отчёт?')
  assert.equal(v.questions.find((q) => q.qid === second.qid).side, 'customer')
  const added = v.questions.find((q) => q.manual)
  assert.equal(added.text, 'Нужна ли выгрузка в Excel?')
  editQuestions(form, { op: 'remove', qid: first.qid })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  assert.ok(!latestVersion(form).questions.some((q) => q.qid === first.qid))
  editQuestions(form, { op: 'restore', qid: first.qid })
  assert.ok(applyEdits(latestVersion(form).questions.concat(first), form.edits).some((q) => q.qid === first.qid))
})

test('ответы: пустой — пропуск, «не знаю», смена ответа — прежний в истории, лимиты', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт' })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  const [a, b] = latestVersion(form).questions
  assert.deepEqual(submitAnswers(form, [{ qid: a.qid, text: '  ' }, { qid: 'чужой', text: 'x' }], undefined), { saved: 0 })
  assert.deepEqual(submitAnswers(form, [{ qid: a.qid, text: 'Неделя' }, { qid: b.qid, status: 'unknown' }], 'Команда отчётов'), { saved: 2 })
  assert.deepEqual(submitAnswers(form, [{ qid: a.qid, text: 'Месяц' }], 'Иван'), { saved: 1 })
  assert.equal(form.history.length, 1)
  assert.equal(form.answers[a.qid].text, 'Месяц')
  assert.equal(form.answers[b.qid].status, 'unknown')
  assert.ok('error' in submitAnswers(form, Array.from({ length: 101 }, () => ({ qid: a.qid, text: 'x' })), ''))
  const ctx = answersContext(form)
  assert.match(ctx, /^Ответы на вопросы согласования/)
  assert.match(ctx, /За какой период нужен отчёт\? → Месяц \(Иван, /)
  assert.match(ctx, /Не смогли ответить[\s\S]*В каком формате/)
  assert.equal(answersContext(undefined), '')
})

test('отзыв: старый ключ отозван, новый — с теми же ответами', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт' })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  form.publishedAt = '2026-11-19T10:00:00Z'
  submitAnswers(form, [{ qid: latestVersion(form).questions[0].qid, text: 'Неделя' }], '')
  const { old, fresh } = reissue(form)
  assert.ok(old.revokedAt && old.movedTo === fresh.id)
  assert.notEqual(fresh.id, form.id)
  assert.equal(fresh.publishedAt, undefined)
  assert.equal(Object.keys(fresh.answers).length, 1)
})

test('пометка [УТОЧНИТЬ] в документе — ссылкой на свой вопрос формы', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт' })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  const qs = latestVersion(form).questions
  assert.equal(questionForMarker(' у команды Платёжки: в каком формате отдаются возвраты?', qs)?.qid, qs[1].qid)
  const page = '<p>x <mark class="unc">[УТОЧНИТЬ у команды Платёжки: в каком формате отдаются возвраты?]</mark> и <mark class="unc">[УТОЧНИТЬ]</mark></p>'
  const linked = linkMarks(page, qs, (qid) => `form?id=1#q-${qid}`)
  assert.match(linked, new RegExp(`<a class="unc-link" href="form\\?id=1#q-${qs[1].qid}"[^>]*><mark class="unc">`))
  assert.match(linked, /и <mark class="unc">\[УТОЧНИТЬ\]<\/mark>/)
})

test('страница формы: заказчику — первым, команды по адресатам, ответы подставлены, noindex, ссылка на предпросмотр', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт по возвратам' })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  const v = latestVersion(form)
  submitAnswers(form, [{ qid: v.questions[0].qid, text: 'Неделя <b>' }], 'Иван')
  const { customer, teams } = arrange(v.questions)
  assert.equal(customer.length, 2)
  assert.deepEqual(teams.map((g) => g.addressee), ['команды Платёжки'])
  const html = formPage(form, v, { previewHref: 'preview?id=X', answerHref: 'form/answer' })
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/)
  assert.match(html, /href="preview\?id=X"/)
  assert.ok(html.indexOf('Вопросы заказчику') < html.indexOf('Уточнения для команд'))
  assert.ok(html.indexOf('За какой период') < html.indexOf('В каком формате'))
  assert.match(html, /Для: команды Платёжки/)
  assert.match(html, />Неделя &lt;b&gt;<\/textarea>/)
  assert.ok(!html.includes('<b>\n'))
})

test('предпросмотр: без выгрузки и комментариев, вопросы ведут в форму', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт' })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  const v = latestVersion(form)
  const deepHtml = '<html><head><title>x</title></head><body><div class="promptbox" id="panel"></div><main><h1 id="top">Отчёт</h1><h2>Проблема которую решаем</h2><p><mark class="unc">[УТОЧНИТЬ у заказчика: за какой период нужен отчёт?]</mark></p></main></body></html>'
  const page = previewPage(deepHtml, form, v, { formHref: 'form?id=K', building: true })
  assert.match(page, /noindex/)
  assert.match(page, /только чтение/)
  assert.match(page, /пересобирается/)
  assert.ok(!page.includes('bftDownload'))
  assert.match(page, new RegExp(`href="form\\?id=K#q-${v.questions[0].qid}"`))
  assert.match(page, /\.promptbox, #panel/)
})

test('ограничение частоты отправок на форму', () => {
  const gate = new SubmitGate(2, 1000)
  assert.ok(gate.allow('a', 0) && gate.allow('a', 10))
  assert.equal(gate.allow('a', 20), false)
  assert.ok(gate.allow('b', 20))
  assert.ok(gate.allow('a', 1500))
})

test('письма с вопросами: корневое — заказчику, ответы в цепочке — по адресатам; панель на странице формы', () => {
  const form = newForm({ slug: 'zayavka-7', sessionId: 's', title: 'Отчёт по возвратам' })
  refreshForm(form, { md: doc(), deepAt: 'd1', people })
  const v = latestVersion(form)
  const plan = mailPlan(form, v)
  assert.deepEqual(plan.customer, ['За какой период нужен отчёт?', 'Кто выдаёт тестовую учётку партнёра?'])
  assert.deepEqual(plan.teams, [{ addressee: 'команды Платёжки', items: ['В каком формате отдаются возвраты?'] }])
  const html = formPage(form, v, { previewHref: 'preview?id=X', answerHref: 'form/answer' })
  assert.match(html, /id="mailOpen"[^>]*>✉ Подготовить письма/)
  assert.match(html, /<aside class="drawer" id="mailDrawer"[^>]*hidden>/)
  assert.match(html, /id="mailSend" type="button">Отправить</)
  assert.match(html, /In-Reply-To/)
  assert.match(html, /placeholder="Мой ответ"/)
  // данные писем — JSON в скрипте, без адресов заказчика: адреса вписывает PO
  assert.match(html, /var PLAN=\{"title":"Отчёт по возвратам"/)
  assert.ok(!html.includes('@') || !/[\w.-]+@[\w-]+\.[a-z]{2,}/i.test(html.replace(/bft-form\.local|компания\.ru/g, '')))
})
