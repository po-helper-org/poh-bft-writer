import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'
import { buildCreateDraft, buildHandoff, chatPath, MCP_ENVIRONMENT, nextCommand, RESPONSE_FORMAT } from '../src/handoff.js'
import type { BftTask } from '../src/model.js'

const ENV = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/team/' }
const config = loadConfig(ENV)

const task: BftTask = {
  id: 'PO-21', title: 'Фильтровать заказы с возвратом', stage: 'FAST-DONE',
  stageSource: 'artifacts', description: '', howToDemo: [],
  links: { other: [], html: '.bft/documentation/po-21/po-21.html' },
  artifacts: { fast: true, fastHtml: true, deep: false, deepHtml: false, custdev: false, custdevHtml: false },
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

// ── Слэш-команда следующего навыка и пути от рабочего пространства чата ──────

const artifacts = (over: Partial<BftTask['artifacts']>): BftTask['artifacts'] => ({
  fast: false, fastHtml: false, deep: false, deepHtml: false, custdev: false, custdevHtml: false, ...over,
})
const inChat = { chatDir: '.bft' }

test('черновик начинается со слэш-команды: харнесс загружает навык только по ней', () => {
  const fast = { ...task, slug: 'po-21', artifactStage: 'FAST-DONE' as const, artifacts: artifacts({ fast: true, fastHtml: true }) }
  const handoff = buildHandoff(fast, null, config, inChat)
  assert.equal(handoff.command, '/bft-deep po-21')
  assert.ok(handoff.prompt.startsWith('/bft-deep po-21\n\n'), handoff.prompt)
})

test('команда выбирается по составу артефактов, а не по стадии доски', () => {
  const base = { ...task, slug: 'po-21', links: { other: [], html: '.bft/documentation/po-21/po-21.html' } }
  const deepReady = artifacts({ fast: true, fastHtml: true, deep: true, deepHtml: true })

  // fast без страницы — сначала собрать страницу, deep не запускать.
  assert.equal(nextCommand({ ...base, links: { other: [] }, artifacts: artifacts({ fast: true }) }, undefined), '/bft-html po-21-fast.md')
  assert.equal(nextCommand({ ...task, slug: 'po-21', links: { other: [], html: '.bft/documentation/po-21/po-21-fast.html' }, artifacts: artifacts({ fast: true }) }, '.bft'), '/bft-html documentation/po-21/po-21-fast.md')
  // deep без страницы — страница по deep-документу.
  assert.equal(nextCommand({ ...base, artifacts: artifacts({ fast: true, fastHtml: true, deep: true }) }, '.bft'), '/bft-html documentation/po-21/po-21.md')
  // deep собран, не хватает только ссылок — отгрузка.
  assert.equal(nextCommand({ ...base, stage: 'DEEP-REVIEW', artifactStage: 'DEEP-REVIEW', artifacts: deepReady, missing: ['ссылка на эпик JIRA'] }, '.bft'), '/bft-deliver po-21')
  // DEEP-DONE — доработка.
  assert.equal(nextCommand({ ...base, stage: 'DEEP-DONE', artifactStage: 'DEEP-DONE', artifacts: deepReady, missing: [] }, '.bft'), '/bft-deep po-21')
  // Доска выше файлов (эпик сброшен до fast): deep, а не deliver.
  assert.equal(nextCommand({ ...base, stage: 'DEEP-REVIEW', artifactStage: 'FAST-DONE', artifacts: artifacts({ fast: true, fastHtml: true }), missing: ['единый документ po-21.md со stage: deep'] }, '.bft'), '/bft-deep po-21')
  // NEED-CUSTDEV без скрипта интервью — интервью.
  assert.equal(nextCommand({ ...base, stage: 'NEED-CUSTDEV', artifacts: artifacts({ fast: true, fastHtml: true }) }, '.bft'), '/bft-custdev po-21')
  assert.equal(nextCommand({ ...base, stage: 'NEED-CUSTDEV', artifacts: artifacts({ fast: true, fastHtml: true, custdev: true }) }, '.bft'), '/bft-deep po-21')
})

test('пути в черновике — от рабочего пространства чата, и стадии доски и диска названы обе', () => {
  const reset = {
    ...task, slug: 'po-21', stage: 'DEEP-REVIEW' as const, stageSource: 'backlog' as const, artifactStage: 'FAST-DONE' as const,
    artifacts: artifacts({ fast: true, fastHtml: true }),
    links: { other: [], html: '.bft/documentation/po-21/po-21-fast.html' },
    missing: ['единый документ po-21.md со stage: deep'],
  }
  const handoff = buildHandoff(reset, null, config, inChat)
  assert.match(handoff.prompt, /Стадия на доске: DEEP-REVIEW; по артефактам на диске: FAST-DONE\./)
  assert.match(handoff.prompt, /Документ: documentation\/po-21\/po-21-fast\.md, страница ревью: documentation\/po-21\/po-21-fast\.html/)
  assert.ok(!handoff.prompt.includes('.bft/documentation'), 'путь от корня раздела в чат не уходит')
  assert.equal(chatPath('.bft/documentation/x/x.md', ''), '.bft/documentation/x/x.md')
  assert.equal(chatPath('bft/documentation/x/x.md', 'bft'), 'documentation/x/x.md')
})

test('правка PO к fast-документу: без команды навыка, с линтером и пересборкой страницы', () => {
  const fast = { ...task, slug: 'po-21', artifactStage: 'FAST-DONE' as const, artifacts: artifacts({ fast: true, fastHtml: true }), links: { other: [], html: '.bft/documentation/po-21/po-21-fast.html' } }
  const handoff = buildHandoff(fast, null, config, { ...inChat, note: 'Добавь шаг 9: заказ виден в истории.' })
  assert.equal(handoff.command, undefined)
  assert.ok(!handoff.prompt.startsWith('/'), handoff.prompt)
  assert.match(handoff.prompt, /Правка PO к документу documentation\/po-21\/po-21-fast\.md:\nДобавь шаг 9/)
  assert.match(handoff.prompt, /bft-lint\.py documentation\/po-21\/po-21-fast\.md/)
  assert.match(handoff.prompt, /bft-html-export\.py documentation\/po-21\/po-21-fast\.md/)
})

test('правка PO к deep-документу на отгрузке — всё равно /bft-deep, не /bft-deliver', () => {
  const deep = { ...task, stage: 'DEEP-REVIEW' as const, artifactStage: 'DEEP-REVIEW' as const, artifacts: artifacts({ deep: true, deepHtml: true }), missing: ['ссылка на страницу Confluence', 'ссылка на эпик JIRA'] }
  assert.equal(nextCommand(deep, undefined), '/bft-deliver po-21', 'без правки — отгрузка')
  const handoff = buildHandoff(deep, null, config, { note: 'Убери раздел про MRS.' })
  assert.equal(handoff.command, '/bft-deep po-21')
  assert.ok(handoff.prompt.startsWith('/bft-deep po-21\n'), handoff.prompt)
})

test('правка PO к deep-документу — доработка через /bft-deep', () => {
  const deep = {
    ...task, slug: 'po-21', stage: 'DEEP-DONE' as const, artifactStage: 'DEEP-DONE' as const,
    artifacts: artifacts({ fast: true, fastHtml: true, deep: true, deepHtml: true }),
    links: { other: [], html: '.bft/documentation/po-21/po-21.html' },
  }
  const handoff = buildHandoff(deep, null, config, { ...inChat, note: 'Убери раздел про MRS.' })
  assert.equal(handoff.command, '/bft-deep po-21')
  assert.match(handoff.prompt, /Правка PO к документу documentation\/po-21\/po-21\.md:\nУбери раздел про MRS\./)
  assert.ok(!handoff.prompt.includes('bft-lint.py'), 'deep сам гоняет линтер и пересобирает страницу')
})

test('черновик создания: слова PO из мини-промта идут в диктовку, команда /bft-fast', () => {
  const draft = buildCreateDraft({ ...task, slug: undefined, artifactStage: undefined, artifacts: artifacts({}), links: { other: [] } }, { description: 'Описание.' }, 'Шаг: оплачиваю билет.')
  assert.equal(draft.command, '/bft-fast PO-21 po-21')
  assert.match(draft.prompt, /Дополнительно от PO \(дословно, источник — PO\):\nШаг: оплачиваю билет\./)
})

test('итог в чат — коротким списком правок: формат задаёт черновик плагина, а не навык', () => {
  const handoff = buildHandoff(task, null, config)
  assert.ok(handoff.prompt.endsWith(RESPONSE_FORMAT), handoff.prompt)
  assert.match(RESPONSE_FORMAT, /^Итоговый ответ в чат — коротко/)
  assert.match(RESPONSE_FORMAT, /Внесены правки:/)
  const draft = buildCreateDraft({ ...task, links: { other: [] }, artifacts: artifacts({}) }, {})
  assert.ok(draft.prompt.endsWith(RESPONSE_FORMAT), draft.prompt)
})

test('навыкам с Jira/Confluence — подсказка про MCP; fast и html обходятся без неё', () => {
  const deep = { ...task, stage: 'DEEP-REVIEW' as const, artifactStage: 'DEEP-REVIEW' as const, artifacts: artifacts({ deep: true, deepHtml: true }), missing: ['ссылка на эпик JIRA'] }
  const deliver = buildHandoff(deep, null, config)
  assert.equal(deliver.command, '/bft-deliver po-21')
  assert.ok(deliver.prompt.includes(MCP_ENVIRONMENT), deliver.prompt)
  assert.ok(deliver.prompt.indexOf(MCP_ENVIRONMENT) < deliver.prompt.indexOf(RESPONSE_FORMAT), 'среда — до формата итога')
  assert.match(RESPONSE_FORMAT, /Ссылки \(только если публиковал или менял\):\n- JIRA: /)

  const fast = buildHandoff(task, null, config)
  assert.equal(fast.command, '/bft-deep po-21')
  assert.ok(fast.prompt.includes(MCP_ENVIRONMENT), 'deep сверяет ссылки через MCP')
  const html = buildHandoff({ ...task, artifacts: artifacts({ fast: true, fastHtml: false }) }, null, config)
  assert.match(html.command ?? '', /^\/bft-html/)
  assert.ok(!html.prompt.includes(MCP_ENVIRONMENT))
})
