import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BftReader } from '../src/bft-reader.js'
import { loadConfig } from '../src/config.js'
import { DocumentOutsideWorkspaceError, InvalidTaskIdError, TaskNotFoundError } from '../src/errors.js'
import type { BftPorts } from '../src/ports.js'

const ENV = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' }

const DOC = `---\npageId: pending\njira: "[СОЗДАТЬ эпик]"\nepic_slug: alpha\nstage: deep\n---\n\n# [БФТ] alpha: Альфа\n`

function ports(tree: Record<string, string[] | string>, links: Record<string, string> = {}): BftPorts {
  return {
    async listDirectory(path) { const e = tree[path]; return Array.isArray(e) ? e : [] },
    async readTextFile(path) { const e = tree[path]; return typeof e === 'string' ? e : null },
    async writeTextFile(path, content) { tree[path] = content },
    async realPath(path) { return links[path] ?? path },
    async runCommand() { return { stdout: '', code: -1 } },
  }
}

const TREE = {
  '/ws/.bft/documentation': ['alpha'],
  '/ws/.bft/documentation/alpha': ['alpha.md', 'alpha.html'],
  '/ws/.bft/documentation/alpha/alpha.md': DOC,
  '/ws/.bft/documentation/alpha/alpha.html': '<h1>Альфа</h1>',
}

test('требование отдаётся по идентификатору, чужого нет', async () => {
  const reader = new BftReader(loadConfig(ENV), ports({ ...TREE }))
  assert.equal((await reader.getTask('alpha')).title, 'Альфа')
  await assert.rejects(() => reader.getTask('beta'), TaskNotFoundError)
})

test('идентификатор с путём отвергается до всякого чтения', async () => {
  const reader = new BftReader(loadConfig(ENV), ports({ ...TREE }))
  for (const bad of ['../etc', 'a/b', '/abs', '..']) {
    await assert.rejects(() => reader.getTask(bad), InvalidTaskIdError, `принят «${bad}»`)
  }
})

test('путь из браузера не уводит за каталог документов', async () => {
  const reader = new BftReader(loadConfig(ENV), ports({ ...TREE }))
  for (const bad of ['../../.ssh/id_rsa', '/etc/passwd', '.bft/documentation/../../secret.md']) {
    await assert.rejects(() => reader.readDocument(bad), DocumentOutsideWorkspaceError, `принят «${bad}»`)
  }
})

test('симлинк наружу тоже не проходит — путь сверяется после раскрытия', async () => {
  const reader = new BftReader(
    loadConfig(ENV),
    ports({ ...TREE }, { '/ws/.bft/documentation/alpha/alpha.html': '/etc/shadow' }),
  )
  await assert.rejects(
    () => reader.readDocument('.bft/documentation/alpha/alpha.html'),
    DocumentOutsideWorkspaceError,
  )
})

test('документ внутри каталога читается', async () => {
  const reader = new BftReader(loadConfig(ENV), ports({ ...TREE }))
  assert.equal(await reader.readDocument('.bft/documentation/alpha/alpha.html'), '<h1>Альфа</h1>')
})

test('документ находится по идентификатору, без знания путей на клиенте', async () => {
  const reader = new BftReader(loadConfig(ENV), ports({ ...TREE }))
  const found = await reader.findDocument('alpha')
  assert.equal(found?.path, '.bft/documentation/alpha/alpha.html')
  assert.equal(found?.content, '<h1>Альфа</h1>')
})

test('пустой документ за находку не считается', async () => {
  const tree = { ...TREE, '/ws/.bft/documentation/alpha/alpha.html': '   \n ' }
  const reader = new BftReader(loadConfig(ENV), ports(tree))
  assert.equal(await reader.findDocument('alpha'), null)
})

test('журнал работы пишется и переживает перечитывание', async () => {
  const tree: Record<string, string[] | string> = { ...TREE }
  const reader = new BftReader(loadConfig(ENV), ports(tree))
  await reader.startWork({ epic: 'alpha', stage: 'DEEP-REVIEW', startedAt: '2026-09-04T10:00:00Z' })
  await reader.finishWork('alpha', 'закрыли ссылки', 'alpha-round-1')

  const log = await reader.readWorkLog()
  assert.equal(log.entries.length, 1)
  assert.equal(log.entries[0].summary, 'закрыли ссылки')
  assert.equal(log.entries[0].contextRef, 'alpha-round-1')
})

test('черновик для чата продолжает последний закрытый отрезок', async () => {
  const tree: Record<string, string[] | string> = { ...TREE }
  const reader = new BftReader(loadConfig(ENV), ports(tree))
  await reader.startWork({ epic: 'alpha', stage: 'DEEP-REVIEW', startedAt: '2026-09-04T10:00:00Z' })
  await reader.finishWork('alpha', 'закрыли ссылки', 'alpha-round-1')

  const handoff = await reader.handoff('alpha')
  assert.equal(handoff.continued, true)
  assert.equal(handoff.contextUrl, 'https://entire.io/t/b/alpha-round-1')
  assert.match(handoff.prompt, /закрыли ссылки/)
  // Страница ревью у фикстуры есть — в нехватке её быть не должно.
  assert.match(handoff.prompt, /не хватает: ссылка на страницу Confluence, ссылка на эпик JIRA\./)
  assert.ok(!handoff.prompt.includes('не хватает: страница ревью'))
})
