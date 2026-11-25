// Боковая панель формы вопросов на странице полного БФТ (ADR-0026).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customerDeepPage } from '../lib-test/fast-page.js'
import { deepFormSidebar, tagMarks } from '../lib-test/form-page.js'
import { insertPlanButton } from '../lib-test/plan.js'
import { planLinks } from '../lib-test/plan-routes.js'

const q = (qid, text, side, addressee = side === 'customer' ? 'заказчика' : 'Команда платежей') => ({ qid, text, side, addressee, refs: [{ section: 'ФТ', id: 'ФТ-1' }], primary: side === 'customer' })
const layer = (link) => ({
  sessionId: 's1', questions: [q('a', 'Какой лимит промокодов?', 'customer'), q('b', 'Есть ли событие покупки?', 'team')],
  answers: { a: { status: 'answered', text: '3 в месяц', author: 'Аня' } }, removed: [q('c', 'Старый вопрос', 'customer')],
  ...(link ? { link, version: 2 } : {}), api: { create: 'c', revoke: 'r', edit: 'e' },
})
const DEEP = '<html><body><div class="rail"><button id="navToggle">☰ Содержание</button></div><main><h1>БФТ</h1><h2>Проблема которую решаем</h2><p>Лимит <mark class="unc">[УТОЧНИТЬ у заказчика: Какой лимит промокодов?]</mark></p></main></body></html>'

test('панель: вопросы по сторонам, ответ, счётчик, без ссылки — «Сформировать форму»', () => {
  const html = deepFormSidebar(layer())
  assert.match(html, /⟩ Вопросы \(1\/2\)/)
  assert.match(html, /Заказчику<span class="cs-cnt">1<\/span>/)
  assert.match(html, /Команда платежей<span class="cs-cnt">1<\/span>/)
  assert.match(html, /class="sb-q done" data-qid="a"/)
  assert.match(html, /aria-label="Отвечен"/)
  assert.match(html, /Отвечено <b>1 из 2<\/b>/)
  assert.match(html, /3 в месяц <span class="who">· Аня<\/span>/)
  assert.match(html, /id="csCreate"/)
  assert.ok(!html.includes('id="csCopy"'))
  assert.match(html, /Убраны из формы · 1/)
  assert.ok(!html.includes('alert('), 'ошибки — строкой в панели, не alert')
  assert.match(html, /\.rail, #navDrawer, #uncDrawer\{ display:none/, 'вкладки навыка скрыты')
})

test('панель: ссылка выдана — «Скопировать ссылку», открыть, отозвать', () => {
  const html = deepFormSidebar(layer('https://x/form?id=1'))
  assert.match(html, /id="csCopy">Копировать/)
  assert.match(html, /id="csFormUrl" readonly value="https:\/\/x\/form\?id=1"/)
  assert.match(html, /id="csRevoke"/)
  assert.ok(!html.includes('id="csCreate"'))
})

test('панель без вопросов: пустое состояние, форма добавления открыта, подвала нет', () => {
  const html = deepFormSidebar({ ...layer(), questions: [], answers: {} })
  assert.match(html, /Вопросов пока нет/)
  assert.match(html, /<form class="cs-sb-add" id="csAddQ">/)
  assert.ok(!html.includes('id="csCreate"') && !html.includes('cs-sb-foot"'))
})

test('пометка [УТОЧНИТЬ] получает data-qid своего вопроса', () => {
  const out = tagMarks(DEEP, layer().questions)
  assert.match(out, /<mark class="unc" data-qid="a">/)
})

test('страница полного БФТ: блока и подвала формы в тексте нет, панель и «Планирование» — в рейке', () => {
  const page = customerDeepPage(DEEP, 's1', 'fast', undefined, layer())
  assert.ok(!page.includes('customer-questions') && !page.includes('customer-form-share'), 'управление формой — только в панели')
  assert.ok(page.indexOf('id="csSidebar"') > page.indexOf('</main>'))
  const withPlan = insertPlanButton(page, planLinks('s1'))
  assert.match(withPlan, /<button type="button" class="cs-rail-tab plan" data-panel="csPlanSide"/)
  assert.match(withPlan, /<aside class="cs-sb" id="csPlanSide"/)
  assert.ok(withPlan.indexOf('id="csPlanSide"') > withPlan.indexOf('id="customer-form-js"'), 'панель планирования — после скрипта панелей')
  assert.ok(!withPlan.includes('plan-bar'), 'кнопки под заголовком нет')
})
