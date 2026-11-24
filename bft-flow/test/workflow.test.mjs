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
