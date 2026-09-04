import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BftTaskSummary } from '../src/model.js'
import { boardColumns, queueGroups, queueSize, searchTasks } from '../src/queue.js'

const task = (id: string, stage: BftTaskSummary['stage'], title = id): BftTaskSummary =>
  ({ id, title, stage, stageSource: 'artifacts' })

const TASKS = [
  task('PO-7', 'To Do', 'Проблема с непрогруженными билетами'),
  task('PO-21', 'FAST-DONE', 'Vibeapp — фильтровать заказы с возвратом'),
  task('PO-22', 'DEEP-REVIEW', 'Билеты в кино в Vibe App'),
  task('PO-1', 'DEEP-DONE', 'Отгружено'),
  task('PO-2', 'Cancelled', 'Отменено'),
]

test('очередь идёт от почти готового к нетронутому', () => {
  assert.deepEqual(queueGroups(TASKS).map(g => g.stage), ['DEEP-REVIEW', 'FAST-DONE', 'To Do'])
})

test('пустые стадии в панели не показываются', () => {
  assert.deepEqual(queueGroups([task('PO-7', 'To Do')]).map(g => g.stage), ['To Do'])
})

test('завершённые и отменённые в счётчик очереди не идут', () => {
  assert.equal(queueSize(TASKS), 3)
})

test('доска сохраняет пустые колонки — «сюда ничего не дошло» тоже смысл', () => {
  const columns = boardColumns(TASKS)
  assert.equal(columns.length, 7)
  assert.deepEqual(columns.find(c => c.stage === 'DEEP-WORK')?.tasks, [])
})

test('поиск не различает регистр и вид дефиса', () => {
  assert.deepEqual(searchTasks(TASKS, 'po-21').map(t => t.id), ['PO-21'])
  assert.deepEqual(searchTasks(TASKS, 'PO–21').map(t => t.id), ['PO-21'])
  assert.deepEqual(searchTasks(TASKS, '  po   21 ').map(t => t.id), [])
})

test('поиск идёт и по названию', () => {
  assert.deepEqual(searchTasks(TASKS, 'вибе').map(t => t.id), [])
  assert.deepEqual(searchTasks(TASKS, 'Vibeapp').map(t => t.id), ['PO-21'])
})

test('пустой запрос отдаёт всё', () => {
  assert.equal(searchTasks(TASKS, '   ').length, TASKS.length)
})
