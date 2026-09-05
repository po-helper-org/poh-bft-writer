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
