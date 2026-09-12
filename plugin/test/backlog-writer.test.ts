import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyBacklogEdits, planBacklogEdits } from '../src/backlog-writer.js'
import { loadConfig } from '../src/config.js'
import type { BftStage, BftTask } from '../src/model.js'
import type { BftPorts } from '../src/ports.js'

const DOCS = 'bft/documentation'

function row(opts: {
  id: string
  board?: { stage: BftStage; refs: string[] }
  artifactStage?: BftStage
  html?: string
}): BftTask {
  return {
    id: opts.id,
    title: opts.id,
    stage: opts.artifactStage ?? opts.board?.stage ?? 'To Do',
    stageSource: 'artifacts',
    board: opts.board,
    artifactStage: opts.artifactStage,
    description: '',
    howToDemo: [],
    links: { other: [], html: opts.html },
    artifacts: { fast: false, fastHtml: false, deep: false, deepHtml: false, custdev: false, custdevHtml: false },
    missing: [],
  }
}

test('стадия по артефактам выше — доска поднимается и получает ссылку на страницу', () => {
  const edits = planBacklogEdits([
    row({ id: 'PO-11', board: { stage: 'To Do', refs: [] }, artifactStage: 'FAST-DONE', html: 'bft/documentation/po-11/po-11-fast.html' }),
  ], DOCS)
  assert.deepEqual(edits, [{ id: 'PO-11', stage: 'FAST-DONE', addRef: 'bft/documentation/po-11/po-11-fast.html' }])
})

test('вниз никогда: доска знает про процесс больше, чем видно по файлам', () => {
  const edits = planBacklogEdits([
    row({ id: 'PO-1', board: { stage: 'DEEP-WORK', refs: ['bft/documentation/a/a-fast.html'] }, artifactStage: 'FAST-DONE', html: 'bft/documentation/a/a-fast.html' }),
  ], DOCS)
  assert.deepEqual(edits, [])
})

test('Cancelled не трогается ни в какую сторону', () => {
  const edits = planBacklogEdits([
    row({ id: 'PO-1', board: { stage: 'Cancelled', refs: [] }, artifactStage: 'DEEP-DONE', html: 'bft/documentation/a/a.html' }),
  ], DOCS)
  assert.deepEqual(edits, [])
})

test('ссылка уже записана в любой форме — второй раз не добавляется', () => {
  const edits = planBacklogEdits([
    row({ id: 'PO-1', board: { stage: 'FAST-DONE', refs: ['./bft/documentation/a/a-fast.html'] }, artifactStage: 'FAST-DONE', html: 'bft/documentation/a/a-fast.html' }),
    row({ id: 'PO-2', board: { stage: 'FAST-DONE', refs: ['.bft/documentation/b/B-fast.html'] }, artifactStage: 'FAST-DONE', html: 'bft/documentation/b/b-fast.html' }),
  ], DOCS)
  assert.deepEqual(edits, [])
})

test('только слитые строки: задаче без документа нечего писать, документу без задачи — некуда', () => {
  const edits = planBacklogEdits([
    row({ id: 'PO-1', board: { stage: 'To Do', refs: [] } }),
    row({ id: 'alpha', artifactStage: 'FAST-DONE', html: 'bft/documentation/alpha/alpha-fast.html' }),
  ], DOCS)
  assert.deepEqual(edits, [])
})

test('запись: одна команда на задачу, аргументы — ровно те, что понимает CLI', async () => {
  const calls: string[][] = []
  const ports = fakePorts(async (_bin, args) => { calls.push(args); return { stdout: 'Status: ○ FAST-DONE', code: 0 } })
  const results = await applyBacklogEdits(
    [{ id: 'PO-11', stage: 'FAST-DONE', addRef: 'bft/documentation/po-11/po-11-fast.html' }, { id: 'PO-12', addRef: 'x' }],
    loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0', BFT_BACKLOG_BIN: '/opt/backlog' }),
    ports,
  )
  assert.deepEqual(calls, [
    ['task', 'edit', 'PO-11', '-s', 'FAST-DONE', '--add-ref', 'bft/documentation/po-11/po-11-fast.html', '--plain'],
    ['task', 'edit', 'PO-12', '--add-ref', 'x', '--plain'],
  ])
  assert.ok(results.every(r => r.ok))
})

test('доска выключена — ни одного вызова', async () => {
  let called = 0
  const ports = fakePorts(async () => { called++; return { stdout: '', code: 0 } })
  const results = await applyBacklogEdits(
    [{ id: 'PO-11', stage: 'FAST-DONE' }],
    loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0', BFT_BACKLOG_BIN: 'off' }),
    ports,
  )
  assert.equal(called, 0)
  assert.deepEqual(results, [])
})

test('провал CLI — причина словом рядом с задачей, остальные задачи не страдают', async () => {
  const ports = fakePorts(async (_bin, args) => (args[2] === 'PO-1'
    ? { stdout: '', stderr: 'Error: Invalid status "FAST-DONE"\nUsage: …', code: 1 }
    : { stdout: 'ok', code: 0 }))
  const results = await applyBacklogEdits(
    [{ id: 'PO-1', stage: 'FAST-DONE' }, { id: 'PO-2', stage: 'FAST-DONE' }],
    loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }),
    ports,
  )
  assert.deepEqual(results.map(r => [r.id, r.ok, r.error]), [
    ['PO-1', false, 'Error: Invalid status "FAST-DONE"'],
    ['PO-2', true, undefined],
  ])
})

function fakePorts(run: BftPorts['runCommand']): BftPorts {
  return {
    async listDirectory() { return [] },
    async readTextFile() { return null },
    async writeTextFile() {},
    async realPath(p) { return p },
    runCommand: run,
  }
}
