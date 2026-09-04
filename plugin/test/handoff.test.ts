import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'
import { buildHandoff } from '../src/handoff.js'
import type { BftTask } from '../src/model.js'

const ENV = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/team/' }
const config = loadConfig(ENV)

const task: BftTask = {
  id: 'PO-21', title: 'Фильтровать заказы с возвратом', stage: 'FAST-DONE',
  stageSource: 'artifacts', description: '', howToDemo: [],
  links: { other: [], html: '.bft/documentation/po-21/po-21.html' },
  artifacts: { fast: true, fastHtml: true, deep: false, deepHtml: false },
  missing: [],
}

test('есть закрытый отрезок — черновик продолжает его, а не начинает заново', () => {
  const handoff = buildHandoff(task, {
    epic: 'PO-21', stage: 'FAST-DONE', startedAt: '2026-09-01T10:00:00Z',
    finishedAt: '2026-09-03T18:00:00Z', summary: 'разобрали возвраты, осталась модерация',
    contextRef: 'po-21-round-1',
  }, config)

  assert.equal(handoff.continued, true)
  assert.equal(handoff.contextUrl, 'https://entire.io/team/b/po-21-round-1')
  assert.match(handoff.prompt, /Прошлый заход \(03\.09\.2026\)/)
  assert.match(handoff.prompt, /осталась модерация/)
  assert.match(handoff.prompt, /продолжи оттуда, а не с нуля/)
})

test('отрезков не было — сказано прямо, ссылка не выдумывается', () => {
  const handoff = buildHandoff(task, null, config)
  assert.equal(handoff.continued, false)
  assert.equal(handoff.contextUrl, undefined)
  assert.match(handoff.prompt, /это первый заход/)
})

test('нехватка до следующей стадии попадает в черновик: стадия сама не говорит, что делать', () => {
  const handoff = buildHandoff({ ...task, stage: 'DEEP-REVIEW', missing: ['ссылка на эпик JIRA'] }, null, config)
  assert.match(handoff.prompt, /не хватает: ссылка на эпик JIRA/)
})

test('требование entire.io снято — про контекст в черновике молчим', () => {
  const without = loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' })
  const handoff = buildHandoff(task, null, without)
  assert.equal(handoff.contextUrl, undefined)
  assert.ok(!handoff.prompt.includes('первый заход'))
})
