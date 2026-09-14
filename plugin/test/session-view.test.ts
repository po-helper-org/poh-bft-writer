import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describeSession } from '../src/client/session-view.js'

const NOW = Date.parse('2026-09-14T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const recorded = (state: 'running' | 'idle' | 'failed' | 'gone', at = '2026-09-12T09:00:00Z') => ({ id: 's', state, lastActivityAt: at })

test('нет записи — нет сессии', () => {
  assert.equal(describeSession(undefined, undefined, NOW), null)
})

test('живое сильнее записи: агент ходит сейчас — running, даже если журнал говорил failed', () => {
  const view = describeSession(recorded('failed'), { running: true, updatedAt: NOW - DAY, title: 'Чат' }, NOW)
  assert.deepEqual(view, { id: 's', state: 'running', title: 'Чат', days: 1, canOpen: true })
})

test('сессии нет в списке харнесса — удалена, открыть нельзя', () => {
  const view = describeSession(recorded('idle'), null, NOW)
  assert.deepEqual(view, { id: 's', state: 'gone', days: 2, canOpen: false })
})

test('без службы сессий верим журналу; failed и gone остаются, остальное — ждёт PO', () => {
  assert.equal(describeSession(recorded('failed'), undefined, NOW)?.state, 'failed')
  assert.equal(describeSession(recorded('running'), undefined, NOW)?.state, 'idle')
  const gone = describeSession(recorded('gone'), undefined, NOW)
  assert.deepEqual([gone?.state, gone?.canOpen], ['gone', false])
})

test('давность — по самой свежей отметке из двух; сегодня — 0', () => {
  assert.equal(describeSession(recorded('idle', '2026-09-10T00:00:00Z'), { running: false, updatedAt: NOW - 3 * 60 * 60 * 1000 }, NOW)?.days, 0)
  assert.equal(describeSession(recorded('idle', '2026-09-10T00:00:00Z'), { running: false, updatedAt: 0 }, NOW)?.days, 4)
  assert.equal(describeSession(recorded('idle', 'не дата'), undefined, NOW)?.days, 0)
})
