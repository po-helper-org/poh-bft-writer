// ConfluencePublish (ADR-0028) на локальном сервере Temporal: шаги по порядку, ход в query,
// отказ Confluence без повторов, сетевой сбой — с повтором. Только с BFT_FLOW_E2E=1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TestWorkflowEnvironment } from '@temporalio/testing'
import { Worker } from '@temporalio/worker'
import { ApplicationFailure } from '@temporalio/common'
import { ensureSearchAttributes } from '../lib/setup.js'

const req = (run) => ({ taskId: 7, slug: 'zayavka-7', sessionId: 's-7', run, parent: { id: '100', title: 'Раздел БФТ', space: 'DEMO' } })
const rendered = { title: '[БФТ] zayavka-7: Поток', labels: ['bft', 'bft-zayavka-7'], body: { path: '/x/page.xhtml', sha256: 'a', name: 'page.xhtml', contentType: 'application/xhtml+xml', size: 1 }, attachments: [], warnings: [] }

test('ConfluencePublish: преобразование → страница → вложения → готово; отказ — без повтора', { skip: process.env.BFT_FLOW_E2E !== '1', timeout: 180_000 }, async () => {
  const env = await TestWorkflowEnvironment.createLocal()
  try {
    await ensureSearchAttributes(env.connection, 'default', () => {})
    const calls = []
    let flaky = 0
    const portal = await Worker.create({
      connection: env.nativeConnection, taskQueue: 'bft-portal',
      activities: {
        async confluenceRender(r) { calls.push(['render', r.run]); return rendered },
        async confluenceUpsertPage(r) {
          calls.push(['page', r.run])
          if (r.run === 2) throw ApplicationFailure.nonRetryable('Нет прав: создание страницы (403)', 'ConfluenceRejected')
          if (r.run === 1 && flaky++ === 0) throw ApplicationFailure.retryable('Confluence временно недоступен (502)', 'ConfluenceRetry')
          return { pageId: '555', url: 'https://wiki.example.test/pages/viewpage.action?pageId=555', version: 1, mode: 'create', title: rendered.title }
        },
        async confluenceAttach() { calls.push(['attach']); return { uploaded: ['bft-diagram-1.png'], skipped: [], names: { 'bft-diagram-1.png': 'bft-diagram-1.png' } } },
        async confluenceFinish(_r, _x, page) { calls.push(['finish']); return { url: page.url, pageId: page.pageId } },
      },
    })
    const flow = await Worker.create({ connection: env.nativeConnection, taskQueue: 'bft-flow', workflowsPath: new URL('../lib/workflows.js', import.meta.url).pathname })
    await portal.runUntil(flow.runUntil(async () => {
      const ok = await env.client.workflow.start('ConfluencePublish', { workflowId: 'bft-7-confluence-1', taskQueue: 'bft-flow', args: [req(1)] })
      const result = await ok.result()
      assert.equal(result.status, 'done')
      assert.equal(result.url, 'https://wiki.example.test/pages/viewpage.action?pageId=555')
      assert.deepEqual(result.steps.map((s) => s.status), ['done', 'done', 'done', 'done'])
      assert.match(result.steps[1].detail, /создана/)
      assert.equal(calls.filter((c) => c[0] === 'page' && c[1] === 1).length, 2, 'сбой 502 повторён')
      const progress = await ok.query('progress')
      assert.equal(progress.status, 'done', 'ход читается и у завершённого workflow')

      const bad = await env.client.workflow.start('ConfluencePublish', { workflowId: 'bft-7-confluence-2', taskQueue: 'bft-flow', args: [req(2)] })
      await assert.rejects(bad.result())
      assert.equal(calls.filter((c) => c[0] === 'page' && c[1] === 2).length, 1, 'отказ 403 не повторяется')
      const failed = await bad.query('progress')
      assert.equal(failed.status, 'failed')
      assert.deepEqual(failed.steps.map((s) => s.status), ['done', 'failed', 'pending', 'pending'])
      assert.match(failed.error, /403/)
      const desc = await bad.describe()
      assert.equal(desc.status.name, 'FAILED')
    }))
  } finally {
    await env.teardown()
  }
})
