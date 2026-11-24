// Сам workflow на локальном сервере Temporal (dev server CLI скачивается при первом запуске).
// Только с BFT_FLOW_E2E=1: в сборке образа сети и лишних минут нет.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { ensureSearchAttributes } from '../lib/setup.js'

test('BftLifecycle: события → стадия, хроника, атрибуты поиска, повтор', { skip: process.env.BFT_FLOW_E2E !== '1', timeout: 180_000 }, async () => {
  const env = await TestWorkflowEnvironment.createLocal()
  try {
    await ensureSearchAttributes(env.connection, 'default', () => {})
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: 'bft-flow', workflowsPath: new URL('../lib/workflows.js', import.meta.url).pathname })
    await worker.runUntil(async () => {
      const client = env.client
      const input = { taskId: 7, slug: 'zayavka-7', sessionId: 's-7', title: 'Поток заказов', createdAt: '2026-11-19T10:00:00Z' }
      const event = (id, kind) => ({ eventId: id, at: `2026-11-19T10:0${id}:00Z`, actor: { kind: 'system' }, kind })
      const handle = await client.workflow.signalWithStart('BftLifecycle', {
        workflowId: 'bft-7', taskQueue: 'bft-flow', args: [input], signal: 'event', signalArgs: [event('1', 'registered')],
      })
      for (const [id, kind] of [['2', 'scenarioApproved'], ['3', 'briefBuilt'], ['3', 'briefBuilt'], ['4', 'briefApproved'], ['5', 'deepReady']]) {
        await client.workflow.signalWithStart('BftLifecycle', { workflowId: 'bft-7', taskQueue: 'bft-flow', args: [input], signal: 'event', signalArgs: [event(id, kind)] })
      }
      let status
      for (let i = 0; i < 50; i++) {
        status = await handle.query('status')
        if (status.events === 5) break
        await new Promise((r) => setTimeout(r, 200))
      }
      assert.equal(status.stage, 'agreement')
      assert.equal(status.round, 1)
      assert.equal(status.events, 5, 'повтор briefBuilt не применился')
      const timeline = await handle.query('timeline')
      assert.equal(timeline.length, 5)
      const desc = await handle.describe()
      assert.deepEqual(desc.searchAttributes.BftStage, ['agreement'])
      await handle.signal('event', event('6', 'cancelled'))
      const result = await handle.result()
      assert.equal(result.stage, 'cancelled')
    })
  } finally {
    await env.teardown()
  }
})

test('шаг 2–3: пауза после ответов — таймер цикла, затем DeepBuild с временем последнего ответа', { skip: process.env.BFT_FLOW_E2E !== '1', timeout: 180_000 }, async () => {
  const env = await TestWorkflowEnvironment.createLocal()
  try {
    await ensureSearchAttributes(env.connection, 'default', () => {})
    const calls = []
    const portal = await Worker.create({
      connection: env.nativeConnection, taskQueue: 'bft-portal',
      activities: {
        async rebuildFromAnswers() { throw new Error('новый цикл так не пересобирает') },
        async buildDeep(req) { calls.push(req); return { stage: 'skipped', startedAt: req.startedAt, reason: 'ответы уже учтены сборкой' } },
      },
    })
    const flow = await Worker.create({ connection: env.nativeConnection, taskQueue: 'bft-flow', workflowsPath: new URL('../lib/workflows.js', import.meta.url).pathname })
    await portal.runUntil(flow.runUntil(async () => {
      const client = env.client
      const input = { taskId: 8, slug: 'zayavka-8', sessionId: 's-8', title: 'Отчёты', createdAt: '2026-11-19T10:00:00Z' }
      const now = new Date().toISOString()
      const send = (event) => client.workflow.signalWithStart('BftLifecycle', { workflowId: 'bft-8', taskQueue: 'bft-flow', args: [input], signal: 'event', signalArgs: [event] })
      const handle = await send({ eventId: 'ready', at: '2026-11-19T10:05:00Z', actor: { kind: 'system' }, kind: 'deepReady' })
      await send({ eventId: 'ans', at: now, actor: { kind: 'customer' }, kind: 'formAnswered', data: { rebuildAfterMs: 1500, questions: { total: 3, answered: 1 }, submission: { formId: 'f8', author: 'Мария Тестова', addressees: ['заказчика'], saved: 1, unknown: 0 } } })
      let status
      for (let i = 0; i < 50 && !(status = await handle.query('status')).rebuild; i++) await new Promise((r) => setTimeout(r, 100))
      assert.ok(status.rebuild, 'пересборка ждёт паузу')
      assert.equal(calls.length, 0)
      for (let i = 0; i < 100 && (calls.length === 0 || (status = await handle.query('status')).build); i++) await new Promise((r) => setTimeout(r, 100))
      assert.equal(calls.length, 1)
      assert.equal(calls[0].reason, 'answers')
      assert.equal(calls[0].lastSubmitAt, now)
      status = await handle.query('status')
      assert.equal(status.rebuild, undefined)
      assert.equal(status.build, undefined)
      const timeline = await handle.query('timeline')
      assert.match(timeline.at(-1).summary, /не собирали: ответы уже учтены/)
      // Входящее событие (ADR-0027): отправка с подписью и итогом пересборки по ней.
      const inbox = await handle.query('inbox')
      assert.equal(inbox.length, 1)
      assert.equal(inbox[0].author, 'Мария Тестова')
      assert.equal(inbox[0].rebuild.state, 'skipped')
      assert.match(inbox[0].rebuild.reason, /ответы уже учтены/)
      await handle.signal('event', { eventId: 'c', at: '2026-11-25T10:00:00Z', actor: { kind: 'po' }, kind: 'cancelled' })
      await handle.result()
    }))
  } finally {
    await env.teardown()
  }
})

test('шаг 3: сборку ведёт цикл — DeepBuild, ответы во время сборки → ещё одна после неё', { skip: process.env.BFT_FLOW_E2E !== '1', timeout: 180_000 }, async () => {
  const env = await TestWorkflowEnvironment.createLocal()
  try {
    await ensureSearchAttributes(env.connection, 'default', () => {})
    const calls = []
    const portal = await Worker.create({
      connection: env.nativeConnection, taskQueue: 'bft-portal',
      activities: {
        async rebuildFromAnswers() { throw new Error('шаг 3 так не пересобирает') },
        async buildDeep(req) {
          calls.push(req)
          await new Promise((r) => setTimeout(r, 3000))
          return { stage: 'ready', startedAt: req.startedAt, finishedAt: new Date().toISOString() }
        },
      },
    })
    const flow = await Worker.create({ connection: env.nativeConnection, taskQueue: 'bft-flow', workflowsPath: new URL('../lib/workflows.js', import.meta.url).pathname })
    await portal.runUntil(flow.runUntil(async () => {
      const client = env.client
      const input = { taskId: 9, slug: 'zayavka-9', sessionId: 's-9', title: 'Склад', createdAt: '2026-11-19T10:00:00Z' }
      const send = (event) => client.workflow.signalWithStart('BftLifecycle', { workflowId: 'bft-9', taskQueue: 'bft-flow', args: [input], signal: 'event', signalArgs: [event] })
      const t0 = new Date().toISOString()
      const handle = await send({ eventId: 'approved', at: t0, actor: { kind: 'customer' }, kind: 'briefApproved' })
      await send({ eventId: `deep:requested:${t0}`, at: t0, actor: { kind: 'customer' }, kind: 'deepRequested', data: { reason: 'approved', startedAt: t0 } })
      // Повтор просьбы во время сборки — вторую не ставит.
      await send({ eventId: 'deep:requested:again', at: t0, actor: { kind: 'po' }, kind: 'deepRequested', data: { reason: 'retry' } })
      await new Promise((r) => setTimeout(r, 1000))
      await send({ eventId: 'ans', at: new Date().toISOString(), actor: { kind: 'customer' }, kind: 'formAnswered', data: { rebuildAfterMs: 300 } })
      let status
      for (let i = 0; i < 200; i++) {
        status = await handle.query('status')
        if (calls.length === 2 && !status.build) break
        await new Promise((r) => setTimeout(r, 100))
      }
      assert.deepEqual(calls.map((c) => c.reason), ['approved', 'answers'])
      assert.equal(calls[0].startedAt, t0, 'время начала — из просьбы портала')
      assert.ok(calls[1].lastSubmitAt)
      assert.equal(status.build, undefined)
      assert.equal(status.rebuild, undefined)
      assert.equal(status.stage, 'agreement')
      assert.equal(status.round, 2)
      const timeline = await handle.query('timeline')
      assert.ok(timeline.some((t) => /после текущей сборки/.test(t.summary)))
      const children = []
      for await (const w of client.workflow.list({ query: 'WorkflowType = "DeepBuild"' })) children.push(w.workflowId)
      assert.deepEqual(children.sort(), ['bft-9-deep-1', 'bft-9-deep-2'])
      await handle.signal('event', { eventId: 'c', at: '2026-11-30T10:00:00Z', actor: { kind: 'po' }, kind: 'cancelled' })
      await handle.result()
    }))
  } finally {
    await env.teardown()
  }
})
