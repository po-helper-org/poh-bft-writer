import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  EMPTY_LOG, finishWork, lastFinished, openEntry, parseWorkLog, serializeWorkLog, startWork,
} from '../src/worklog.js'
import type { WorkLog } from '../src/worklog.js'

const entry = (epic: string, startedAt: string, extra: Record<string, unknown> = {}) =>
  ({ epic, stage: 'FAST-DONE' as const, startedAt, ...extra })

test('битый или чужой файл — пустой журнал, а не падение раздела', () => {
  assert.deepEqual(parseWorkLog('{не json'), EMPTY_LOG)
  assert.deepEqual(parseWorkLog('{"version":1}'), EMPTY_LOG)
  assert.deepEqual(parseWorkLog(null), EMPTY_LOG)
})

test('записи без обязательных полей отбрасываются, остальные живут', () => {
  const log = parseWorkLog('{"version":1,"entries":[{"epic":"a","startedAt":"2026-09-01"},{"foo":1}]}')
  assert.deepEqual(log.entries.map(e => e.epic), ['a'])
})

test('продолжают с последнего ЗАКРЫТОГО отрезка, а не с брошенного', () => {
  const log: WorkLog = { version: 1, entries: [
    entry('a', '2026-09-01', { finishedAt: '2026-09-01', summary: 'старое', contextRef: 'br-1' }),
    entry('a', '2026-09-03', { finishedAt: '2026-09-03', summary: 'свежее', contextRef: 'br-2' }),
    entry('a', '2026-09-04'),
  ] }
  assert.equal(lastFinished(log, 'a')?.summary, 'свежее')
  assert.equal(openEntry(log, 'a')?.startedAt, '2026-09-04')
})

test('история одного эпика не смешивается с чужой', () => {
  const log: WorkLog = { version: 1, entries: [
    entry('a', '2026-09-01', { finishedAt: '2026-09-01', summary: 'по a' }),
    entry('b', '2026-09-02', { finishedAt: '2026-09-02', summary: 'по b' }),
  ] }
  assert.equal(lastFinished(log, 'a')?.summary, 'по a')
  assert.equal(lastFinished(log, 'b')?.summary, 'по b')
  assert.equal(lastFinished(log, 'c'), null)
})

test('второй заход по тому же требованию не заводится, пока первый не закрыт', () => {
  const started = startWork(EMPTY_LOG, entry('a', '2026-09-01'))
  const again = startWork(started, entry('a', '2026-09-02'))
  assert.equal(again.entries.length, 1)
  assert.equal(again, started)
})

test('закрытие ставит дату, итог и ветку контекста', () => {
  const started = startWork(EMPTY_LOG, entry('a', '2026-09-01'))
  const done = finishWork(started, 'a', '2026-09-02', 'закрыли SLA', 'branch-42')
  assert.deepEqual(
    { ...done.entries[0] },
    { epic: 'a', stage: 'FAST-DONE', startedAt: '2026-09-01', finishedAt: '2026-09-02',
      summary: 'закрыли SLA', contextRef: 'branch-42' },
  )
  assert.equal(openEntry(done, 'a'), null)
})

test('закрывать нечего — журнал не меняется', () => {
  assert.equal(finishWork(EMPTY_LOG, 'a', '2026-09-02', 'итог'), EMPTY_LOG)
})

test('запись и чтение журнала обратимы', () => {
  const log = startWork(EMPTY_LOG, entry('a', '2026-09-01', { contextRef: 'br' }))
  assert.deepEqual(parseWorkLog(serializeWorkLog(log)), log)
})

// ── Сессии харнесса ──────────────────────────────────────────────────────────

import { attachSession, lastSession, markInterrupted, touchSession } from '../src/worklog.js'

test('сессия привязывается к открытому отрезку, а без него — открывает новый', () => {
  const started = startWork(EMPTY_LOG, entry('a', '2026-09-01'))
  const attached = attachSession(started, 'a', 'To Do', 'sess-1', '2026-09-02T10:00:00Z')
  assert.equal(attached.entries.length, 1)
  assert.deepEqual(
    [attached.entries[0].sessionId, attached.entries[0].sessionState, attached.entries[0].lastActivityAt],
    ['sess-1', 'idle', '2026-09-02T10:00:00Z'],
  )

  const fresh = attachSession(EMPTY_LOG, 'b', 'FAST-DONE', 'sess-2', '2026-09-03T10:00:00Z')
  assert.deepEqual(fresh.entries.map(e => [e.epic, e.stage, e.startedAt, e.sessionId]), [['b', 'FAST-DONE', '2026-09-03T10:00:00Z', 'sess-2']])
})

test('новый чат по тому же требованию замещает сессию в открытом отрезке', () => {
  const one = attachSession(EMPTY_LOG, 'a', 'To Do', 'sess-1', '2026-09-01T10:00:00Z')
  const two = attachSession(one, 'a', 'To Do', 'sess-2', '2026-09-02T10:00:00Z')
  assert.equal(two.entries.length, 1)
  assert.equal(two.entries[0].sessionId, 'sess-2')
})

test('состояние сессии меняется только у своих отрезков; чужая сессия — журнал тот же объект', () => {
  const log = attachSession(EMPTY_LOG, 'a', 'To Do', 'sess-1', '2026-09-01T10:00:00Z')
  assert.equal(touchSession(log, 'unknown', 'running', '2026-09-01T11:00:00Z'), log)
  const running = touchSession(log, 'sess-1', 'running', '2026-09-01T11:00:00Z')
  assert.deepEqual([running.entries[0].sessionState, running.entries[0].lastActivityAt], ['running', '2026-09-01T11:00:00Z'])
  const failed = touchSession(running, 'sess-1', 'failed', '2026-09-01T12:00:00Z')
  assert.equal(failed.entries[0].sessionState, 'failed')
})

test('перезапуск харнесса: «агент ходит» становится «прервалась», остальное не трогается', () => {
  let log = attachSession(EMPTY_LOG, 'a', 'To Do', 'sess-1', '2026-09-01T10:00:00Z')
  log = touchSession(log, 'sess-1', 'running', '2026-09-01T11:00:00Z')
  log = attachSession(log, 'b', 'To Do', 'sess-2', '2026-09-01T10:00:00Z')
  const after = markInterrupted(log, '2026-09-02T08:00:00Z')
  assert.deepEqual(after.entries.map(e => [e.epic, e.sessionState]), [['a', 'failed'], ['b', 'idle']])
  assert.equal(markInterrupted(after, '2026-09-02T09:00:00Z'), after, 'без running журнал не меняется')
})

test('последняя сессия — по последнему движению, а не по началу отрезка', () => {
  let log = attachSession(EMPTY_LOG, 'a', 'To Do', 'old', '2026-09-01T10:00:00Z')
  log = finishWork(log, 'a', '2026-09-01T12:00:00Z', 'готово')
  log = attachSession(log, 'a', 'FAST-DONE', 'new', '2026-09-03T10:00:00Z')
  log = touchSession(log, 'old', 'idle', '2026-09-04T10:00:00Z')
  assert.deepEqual(lastSession(log, 'a'), { id: 'old', state: 'idle', lastActivityAt: '2026-09-04T10:00:00Z' })
  assert.equal(lastSession(log, 'nope'), null)
  assert.equal(lastSession(startWork(EMPTY_LOG, entry('c', '2026-09-01')), 'c'), null, 'отрезок без сессии — не сессия')
})
