// Модель «Управления БФТ»: отметка смены статуса и SLA (ADR-0009).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ageLabel, daysSince, slaTone, statusComment, statusOfComment } from '../lib/model.js'

const NOW = Date.parse('2026-10-26T12:00:00+03:00')
const ago = (hours) => new Date(NOW - hours * 3600_000).toISOString()

test('отметка статуса читается обратно, в т.ч. с HTML-экранированием', () => {
  assert.equal(statusOfComment(statusComment('Создан', 'Ожидает PO', '<p>Ответственный: А.</p>')), 'Ожидает PO')
  assert.equal(statusOfComment(statusComment('Backlog', 'R&D <1>')), 'R&D <1>')
  assert.equal(statusOfComment('<p>Статус: &laquo;A&raquo; → &laquo;Оценка&raquo;</p>'), 'Оценка')
  assert.equal(statusOfComment('<p>обычный комментарий</p>'), undefined)
})

test('SLA: норма до 3 суток, внимание до недели, дальше просрочка', () => {
  assert.equal(slaTone('Ожидает PO', ago(30), NOW), 'neutral')
  assert.equal(slaTone('Ожидает PO', ago(80), NOW), 'warning')
  assert.equal(slaTone('Ожидает PO', ago(24 * 8), NOW), 'danger')
  assert.equal(slaTone('Отменено', ago(24 * 30), NOW), 'neutral') // финальный статус SLA не копит
})

test('возраст: часы до суток, дальше дни', () => {
  assert.equal(ageLabel(ago(5), NOW), '5 ч')
  assert.equal(ageLabel(ago(50), NOW), '2 дн')
  assert.equal(daysSince('мусор', NOW), 0)
})
