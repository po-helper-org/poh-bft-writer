/**
 * Т5: чистое ядро — модель карточек указаний (directives.ts).
 * Тип исполнителя определяет kind (ADR-0003), адресат-человек различается
 * по подписи person, статусы — из контракта 1.0.0, бейдж считает ждущих.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { badgeCount, directiveCard } from '../src/directives.js'

test('решения PO — человек-PO с действием ответить', () => {
  const c = directiveCard({ id: 'd1', kind: 'decide', to: { role: 'po' }, text: 'Волна 1: A или B?', state: 'open' })
  assert.equal(c.executor, 'human')
  assert.equal(c.addressee, 'po')
  assert.deepEqual(c.actions, ['reply'])
  assert.equal(c.status, 'waiting')
})

test('ask адресату-заказчику узнаёт заказчика по подписи person', () => {
  const c = directiveCard({ id: 'd2', kind: 'ask', to: { role: 'addressee', person: 'Заказчик Pharma' }, text: 'Подтвердите границы', state: 'open' })
  assert.equal(c.addressee, 'customer')
  assert.equal(c.executor, 'human')
  assert.equal(c.person, 'Заказчик Pharma')
})

test('ask адресату-сотруднику — employee', () => {
  const c = directiveCard({ id: 'd3', kind: 'ask', to: { role: 'addressee', person: 'Техлид склада' }, text: 'Слоты?', state: 'open' })
  assert.equal(c.addressee, 'employee')
})

test('collect — агент: действие «В чат» (handoff), не прямой вызов', () => {
  const c = directiveCard({ id: 'd4', kind: 'collect', to: { role: 'executor' }, text: 'Воронка за квартал', state: 'open' })
  assert.equal(c.executor, 'agent')
  assert.equal(c.addressee, 'agent')
  assert.deepEqual(c.actions, ['chat'])
})

test('статусы: overdue, suspended→paused, closed→answered (только читать)', () => {
  assert.equal(directiveCard({ id: 'a', kind: 'decide', to: { role: 'po' }, state: 'overdue' }).status, 'overdue')
  assert.equal(directiveCard({ id: 'b', kind: 'decide', to: { role: 'po' }, state: 'suspended' }).status, 'paused')
  const closed = directiveCard({ id: 'c', kind: 'ask', to: { role: 'addressee' }, state: 'closed' })
  assert.equal(closed.status, 'answered')
  assert.deepEqual(closed.actions, ['watch'])
})

test('неизвестный kind — честный человек-адресат с ответом, не падение', () => {
  const c = directiveCard({ id: 'd9', kind: 'brand_new_kind', to: { role: 'addressee', person: 'Заказчик' }, text: '??', state: 'open' })
  assert.equal(c.executor, 'human')
  assert.equal(c.addressee, 'customer')
  assert.deepEqual(c.actions, ['reply'])
})

test('пустой текст — заголовок-заглушка по kind, не пустота', () => {
  const c = directiveCard({ id: 'd10', kind: 'approve_plan', to: { role: 'po' }, state: 'open' })
  assert.equal(c.title, 'Указание approve_plan')
})

test('бейдж: ждущие и просроченные считаются, отвеченные и пауза — нет', () => {
  const cards = [
    directiveCard({ id: '1', kind: 'decide', to: { role: 'po' }, state: 'open' }),
    directiveCard({ id: '2', kind: 'ask', to: { role: 'addressee' }, state: 'overdue' }),
    directiveCard({ id: '3', kind: 'ask', to: { role: 'addressee' }, state: 'closed' }),
    directiveCard({ id: '4', kind: 'decide', to: { role: 'po' }, state: 'suspended' }),
  ]
  assert.equal(badgeCount(cards), 2)
  assert.equal(badgeCount([]), 0)
})
