// Согласование первичных требований из формы чата и со страницы (fast-approval.ts),
// отметка служебных «📌 …» портала (portal-note.ts). Запуск: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// FAST_ROOT читает DSH_HOME при загрузке модуля — задаём до импорта.
const HOME = mkdtempSync(join(tmpdir(), 'approval-'))
process.env.DSH_HOME = HOME
const approval = await import('../lib-test/fast-approval.js')
const { FAST_ROOT, fastFiles, fastSlug, fastState } = await import('../lib-test/bft-fast.js')
const { portalNoteSource } = await import('../lib-test/portal-note.js')

test.after(() => rmSync(HOME, { recursive: true, force: true }))

function fakeBacklog() {
  const calls = []
  return { calls, comment: async (_t, html) => { calls.push(['comment', html]) }, attach: async (_t, name) => { calls.push(['attach', name]) } }
}

test('согласование: отметка у документа, заявка и полный БФТ — один раз', async () => {
  const ticket = { taskId: 41 }
  const files = fastFiles(FAST_ROOT, fastSlug(41))
  mkdirSync(files.dir, { recursive: true })
  writeFileSync(files.md, '# документ\n')
  writeFileSync(files.html, '<html></html>')
  const started = []
  approval.portalHooks.startDeep = (t, sessionId) => { started.push([t.taskId, sessionId]); return true }
  const backlog = fakeBacklog()
  const first = await approval.approveFastRequest(backlog, ticket, 's-1')
  assert.equal(first.first, true)
  assert.equal(first.deep, true)
  assert.equal((await fastState(files)).approvedAt, first.approvedAt)
  const again = await approval.approveFastRequest(backlog, ticket, 's-1')
  assert.equal(again.first, false)
  assert.equal(again.approvedAt, first.approvedAt)
  assert.deepEqual(started, [[41, 's-1']], 'полный БФТ запущен один раз')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(backlog.calls.filter(([kind]) => kind === 'comment').length, 1, 'комментарий в заявку — один')
  assert.ok(JSON.parse(readFileSync(files.approval, 'utf8')).approvedAt)
  approval.portalHooks.startDeep = undefined
})

test('без модели портала: согласовано, полный БФТ не запущен', async () => {
  const files = fastFiles(FAST_ROOT, fastSlug(42))
  mkdirSync(files.dir, { recursive: true })
  writeFileSync(files.md, '# другой документ\n')
  writeFileSync(files.html, '<html></html>')
  const result = await approval.approveFastRequest(fakeBacklog(), { taskId: 42 }, 's-2')
  assert.equal(result.first, true)
  assert.equal(result.deep, false)
})

test('вопрос «Документ верный?» снимает страница: причина доходит до инструмента', () => {
  assert.equal(approval.releaseFastAsk('s-3', 'approved'), false, 'вопроса нет — нечего снимать')
  const hold = approval.holdFastAsk('s-3')
  assert.equal(approval.releaseFastAsk('s-3', 'approved'), true)
  assert.equal(hold.signal.aborted, true)
  assert.equal(hold.signal.reason, 'approved')
  assert.equal(approval.releaseFastAsk('s-3', 'remarks'), false, 'снят один раз')
  hold.done()
})

test('новый вопрос заменяет прежний; done старого не снимает новый', () => {
  const old = approval.holdFastAsk('s-4')
  const next = approval.holdFastAsk('s-4')
  assert.equal(old.signal.reason, 'remarks')
  old.done()
  assert.equal(approval.releaseFastAsk('s-4', 'remarks'), true)
  assert.equal(next.signal.aborted, true)
})

test('«📌 …» портала: роль заказчика с отметкой portalNote', () => {
  assert.deepEqual(portalNoteSource('ticket'), { kind: 'user', portalNote: 'ticket' })
  assert.deepEqual(portalNoteSource('demo'), { kind: 'user', portalNote: 'demo' })
})
