import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config.js'
import type { BftPorts } from '../src/ports.js'
import { scanWorkspace } from '../src/reader.js'

/** Поддельный воркспейс: ключ — путь, значение — содержимое либо список файлов. */
function fakePorts(tree: Record<string, string[] | string>): BftPorts {
  return {
    async listDirectory(path) {
      const entry = tree[path]
      return Array.isArray(entry) ? entry : []
    },
    async readTextFile(path) {
      const entry = tree[path]
      return typeof entry === 'string' ? entry : null
    },
  }
}

const deepDoc = (slug: string, opts: { stage?: string; pageId?: string; jira?: string } = {}) =>
  `---\npageId: ${opts.pageId ?? 'pending'}\njira: "${opts.jira ?? '[СОЗДАТЬ эпик]'}"\n` +
  `status: Черновик 0.2\nepic_slug: ${slug}\nstage: ${opts.stage ?? 'deep'}\n---\n\n` +
  `# [БФТ] ${slug}: Название эпика\n`

test('очередь собирается из артефактов, без Backlog.md', async () => {
  const ports = fakePorts({
    '/ws/.bft/documentation': ['alpha', 'beta'],
    '/ws/.bft/documentation/alpha': ['alpha-fast.md', 'alpha-fast.html'],
    '/ws/.bft/documentation/beta': ['beta.md', 'beta.html'],
    '/ws/.bft/documentation/beta/beta.md': deepDoc('beta'),
  })
  const { tasks, docsPath } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws' }), ports)

  assert.equal(docsPath, '.bft/documentation')
  assert.deepEqual(tasks.map(t => [t.id, t.stage]), [['alpha', 'FAST-DONE'], ['beta', 'DEEP-REVIEW']])
  assert.ok(tasks.every(t => t.stageSource === 'artifacts'))
})

test('название берётся из H1, а не из имени папки', async () => {
  const ports = fakePorts({
    '/ws/.bft/documentation': ['beta'],
    '/ws/.bft/documentation/beta': ['beta.md'],
    '/ws/.bft/documentation/beta/beta.md': deepDoc('beta'),
  })
  const { tasks } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws' }), ports)
  assert.equal(tasks[0].title, 'Название эпика')
})

test('прежняя раскладка каталога подхватывается запасным путём', async () => {
  const ports = fakePorts({
    '/ws/bft/documentation': ['gamma'],
    '/ws/bft/documentation/gamma': ['gamma-fast.md'],
  })
  const { tasks, docsPath } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws' }), ports)
  assert.equal(docsPath, 'bft/documentation')
  assert.deepEqual(tasks.map(t => t.id), ['gamma'])
})

test('каталог без документов эпиком не считается', async () => {
  const ports = fakePorts({
    '/ws/.bft/documentation': ['artefacts', 'alpha'],
    '/ws/.bft/documentation/artefacts': ['personas.csv'],
    '/ws/.bft/documentation/alpha': ['alpha-fast.md'],
  })
  const { tasks } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws' }), ports)
  assert.deepEqual(tasks.map(t => t.id), ['alpha'])
})

test('ссылки строятся только на существующие объекты', async () => {
  const ports = fakePorts({
    '/ws/.bft/documentation': ['nolinks', 'links'],
    '/ws/.bft/documentation/nolinks': ['nolinks.md'],
    '/ws/.bft/documentation/nolinks/nolinks.md': deepDoc('nolinks'),
    '/ws/.bft/documentation/links': ['links.md', 'links.html'],
    '/ws/.bft/documentation/links/links.md': deepDoc('links', { pageId: '2272447498', jira: 'GDSLV-1409' }),
  })
  const { tasks } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws' }), ports)
  const [withLinks, without] = [tasks.find(t => t.id === 'links')!, tasks.find(t => t.id === 'nolinks')!]

  assert.equal(without.links.confluence, undefined)
  assert.equal(without.links.epic, undefined)
  assert.equal(without.links.html, undefined)
  assert.equal(withLinks.links.confluence, 'https://confluence.mts.ru/pages/viewpage.action?pageId=2272447498')
  assert.equal(withLinks.links.epic, 'https://jira.mts.ru/browse/GDSLV-1409')
  assert.equal(withLinks.links.html, '.bft/documentation/links/links.html')
  assert.equal(withLinks.stage, 'DEEP-DONE')
})
