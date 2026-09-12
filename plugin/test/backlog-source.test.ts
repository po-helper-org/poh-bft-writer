import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseTaskList } from '../src/backlog-source.js'

const OUT = `To Do:
  TASK-1 - Билеты в кино в Vibe App (ac: 0/1)
  [HIGH] [bft] TASK-2 - БФТ: Возвраты заказов
  [other] TASK-3 - Чужой тип
FAST-DONE:
  TASK-4 - Уже прошло быстрый проход
Неизвестная колонка:
  TASK-5 - Сюда смотреть не надо
`

test('стадия берётся из заголовка группы: сам ряд её не содержит', () => {
  const tasks = parseTaskList(OUT)
  assert.deepEqual(tasks.map(t => [t.id, t.stage]),
    [['TASK-1', 'To Do'], ['TASK-2', 'To Do'], ['TASK-4', 'FAST-DONE']])
})

test('группа вне канона стадий игнорируется', () => {
  assert.ok(!parseTaskList(OUT).some(t => t.id === 'TASK-5'))
})

test('чужой тип отбрасывается, а задачи без типа проходят', () => {
  // Доска команды может не размечать задачи типом вовсе — отбрасывать тогда
  // всё подряд значило бы показать пустой раздел при полной доске.
  const ids = parseTaskList(OUT).map(t => t.id)
  assert.ok(ids.includes('TASK-1'), 'задача без типа должна пройти')
  assert.ok(!ids.includes('TASK-3'), 'чужой тип должен отсеяться')
})

test('служебные хвосты вывода CLI в название не попадают', () => {
  const tasks = parseTaskList(OUT)
  assert.equal(tasks[0].title, 'Билеты в кино в Vibe App')
  assert.equal(tasks[1].title, 'Возвраты заказов')
})

test('источник стадии помечен доской — он не выведен из файлов', () => {
  assert.ok(parseTaskList(OUT).every(t => t.stageSource === 'backlog'))
})

test('пустой вывод — пустой список, а не падение', () => {
  assert.deepEqual(parseTaskList(''), [])
  assert.deepEqual(parseTaskList('﻿To Do:\r\n  TASK-9 - С BOM и CRLF\r\n').map(t => t.id), ['TASK-9'])
})

// ── task list --json ──────────────────────────────────────────────────────────

import { parseTaskListJson } from '../src/backlog-source.js'

const JSON_OUT = JSON.stringify({
  schemaVersion: 1,
  kind: 'task-list',
  tasks: [
    { id: 'PO-7', title: 'БФТ: Проблема с билетами', status: 'To Do', type: 'bft', references: [] },
    { id: 'PO-20', title: 'БФТ: Блокировка мест', status: 'FAST-DONE', type: 'bft', references: ['bft/documentation/po20/po20-fast.html', ''] },
    { id: 'PO-1', title: 'Не БФТ', status: 'To Do', type: 'potask', references: [] },
    { id: 'PO-2', title: 'Чужой статус', status: 'In Progress', type: 'bft', references: [] },
    { id: 'PO-3', title: 'Без типа', status: 'To Do', references: [] },
    { title: 'Без идентификатора', status: 'To Do', type: 'bft' },
  ],
})

test('json: id, стадия и ссылки приходят одним вызовом', () => {
  const tasks = parseTaskListJson(JSON_OUT)
  assert.deepEqual(tasks.map(t => [t.id, t.stage, t.refs]), [
    ['PO-7', 'To Do', []],
    ['PO-20', 'FAST-DONE', ['bft/documentation/po20/po20-fast.html']],
    ['PO-3', 'To Do', []],
  ])
  assert.equal(tasks[0].title, 'Проблема с билетами')
  assert.ok(tasks.every(t => t.stageSource === 'backlog'))
})

test('json: статус вне канона и чужой тип не попадают в очередь', () => {
  const ids = parseTaskListJson(JSON_OUT).map(t => t.id)
  assert.ok(!ids.includes('PO-1'), 'чужой тип')
  assert.ok(!ids.includes('PO-2'), 'статус вне канона')
})

test('json: чужая версия схемы или битый вывод — пустой список, не догадки', () => {
  assert.deepEqual(parseTaskListJson('{"schemaVersion":2,"kind":"task-list","tasks":[{"id":"X-1","status":"To Do"}]}'), [])
  assert.deepEqual(parseTaskListJson('{"schemaVersion":1,"kind":"task-view","task":{}}'), [])
  assert.deepEqual(parseTaskListJson('не json'), [])
  assert.deepEqual(parseTaskListJson(''), [])
})
