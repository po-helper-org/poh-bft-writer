// Клик по задаче «Управления БФТ» — чат заявки в портале (ADR-0020), иначе Vikunja.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openTarget, sessionsOf } from '../lib/model.js'

const sessions = sessionsOf({ ok: true, items: [{ taskId: 8, sessionId: 'session-abc' }, { taskId: 'x', sessionId: 'bad' }, { taskId: 9 }] })

test('ответ портала → taskId → сессия, мусор мимо', () => {
  assert.deepEqual([...sessions], [[8, 'session-abc']])
  assert.equal(sessionsOf(null).size, 0)
})

test('запрос с чатом — чат заявки в портале', () => {
  assert.deepEqual(openTarget({ id: 8, url: '', links: [] }, sessions), { kind: 'chat', sessionId: 'session-abc', href: './?session=session-abc' })
})

test('задача «Проработка БФТ» — чат первого привязанного запроса', () => {
  assert.equal(openTarget({ id: 40, url: '', links: [{ id: 3, title: 'a' }, { id: 8, title: 'b' }] }, sessions).sessionId, 'session-abc')
})

test('без чата — Vikunja, если трекер открывается снаружи; иначе ничего', () => {
  assert.deepEqual(openTarget({ id: 5, url: 'https://tracker/tasks/5', links: [] }, sessions), { kind: 'tracker', url: 'https://tracker/tasks/5' })
  assert.deepEqual(openTarget({ id: 5, url: '', links: [] }, sessions), { kind: 'none' })
})
