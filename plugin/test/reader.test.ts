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
    async writeTextFile(path, content) { tree[path] = content },
    async realPath(path) { return path },
    async runCommand() { return { stdout: '', code: -1 } },
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
  const { tasks, docsPath } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' }), ports)

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
  const { tasks } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' }), ports)
  assert.equal(tasks[0].title, 'Название эпика')
})

test('прежняя раскладка каталога подхватывается запасным путём', async () => {
  const ports = fakePorts({
    '/ws/bft/documentation': ['gamma'],
    '/ws/bft/documentation/gamma': ['gamma-fast.md', 'gamma-fast.html'],
  })
  const { tasks, docsPath } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' }), ports)
  assert.equal(docsPath, 'bft/documentation')
  assert.deepEqual(tasks.map(t => t.id), ['gamma'])
})

test('каталог без документов эпиком не считается', async () => {
  const ports = fakePorts({
    '/ws/.bft/documentation': ['artefacts', 'alpha'],
    '/ws/.bft/documentation/artefacts': ['personas.csv'],
    '/ws/.bft/documentation/alpha': ['alpha-fast.md', 'alpha-fast.html'],
  })
  const { tasks } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' }), ports)
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
  const { tasks } = await scanWorkspace(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' }), ports)
  const [withLinks, without] = [tasks.find(t => t.id === 'links')!, tasks.find(t => t.id === 'nolinks')!]

  assert.equal(without.links.confluence, undefined)
  assert.equal(without.links.epic, undefined)
  assert.equal(without.links.html, undefined)
  assert.equal(withLinks.links.confluence, 'https://confluence.mts.ru/pages/viewpage.action?pageId=2272447498')
  assert.equal(withLinks.links.epic, 'https://jira.mts.ru/browse/GDSLV-1409')
  assert.equal(withLinks.links.html, '.bft/documentation/links/links.html')
  assert.equal(withLinks.stage, 'DEEP-DONE')
  assert.deepEqual(withLinks.missing, [])
  // Неполный набор обязан объяснить себя, а не просто откатиться стадией.
  assert.equal(without.stage, 'DEEP-REVIEW')
  assert.deepEqual(without.missing,
    ['страница ревью', 'ссылка на страницу Confluence', 'ссылка на эпик JIRA'])
})

// ── Слияние с доской Backlog.md ───────────────────────────────────────────────

const boardJson = (tasks: Array<{ id: string; title: string; status: string; references?: string[] }>) =>
  JSON.stringify({ schemaVersion: 1, kind: 'task-list', tasks: tasks.map(t => ({ type: 'bft', references: [], ...t })) })

/** Порты с доской: `task list --json` отдаёт заданные задачи, остальное — как fakePorts. */
function boardPorts(tree: Record<string, string[] | string>, json: string, calls: string[][] = []): BftPorts {
  const base = fakePorts(tree)
  return {
    ...base,
    async runCommand(_bin, args) {
      calls.push(args)
      if (args[0] === 'task' && args[1] === 'list' && args.includes('--json')) return { stdout: json, code: 0 }
      return { stdout: '', code: 1 }
    },
  }
}

const ENV_BOARD = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }
const fastDoc = (slug: string, title: string) =>
  `---\npageId: pending\nepic_slug: ${slug}\nstage: fast\n---\n\n# [БФТ] ${slug}: ${title}\n`

test('задача доски и каталог эпика сливаются в одну строку: id задачи, слаг каталога', async () => {
  const ports = boardPorts({
    '/ws/.bft/documentation': ['po-11', 'legacy'],
    '/ws/.bft/documentation/po-11': ['po-11-fast.md', 'po-11-fast.html'],
    '/ws/.bft/documentation/po-11/po-11-fast.md': fastDoc('po-11', 'Из раздела'),
    '/ws/.bft/documentation/legacy': ['legacy-fast.md'],
    '/ws/.bft/documentation/legacy/legacy-fast.md': fastDoc('legacy', 'Блокировка мест'),
  }, boardJson([
    { id: 'PO-11', title: 'БФТ: Из раздела', status: 'To Do' },
    { id: 'PO-20', title: 'БФТ: Блокировка мест', status: 'REVIEW-DONE' },
    { id: 'PO-99', title: 'БФТ: Без документа', status: 'To Do' },
  ]))
  const { tasks, boardAvailable } = await scanWorkspace(loadConfig(ENV_BOARD), ports)

  assert.equal(boardAvailable, true)
  // Каталоги идут по алфавиту слагов, задачи без документа — после них.
  assert.deepEqual(tasks.map(t => [t.id, t.slug, t.stage, t.stageSource]), [
    // Связь по названию в H1: доска впереди файлов (REVIEW-DONE ставит PO) — берётся доска.
    ['PO-20', 'legacy', 'REVIEW-DONE', 'backlog'],
    // Слаг равен id: артефакты уже FAST-DONE, доска отстала — берётся стадия по файлам.
    ['PO-11', 'po-11', 'FAST-DONE', 'artifacts'],
    // Документа нет — строка доски как есть.
    ['PO-99', undefined, 'To Do', 'backlog'],
  ])
  assert.deepEqual(tasks[0].missing, ['страница ревью'], 'нехватка — всегда по артефактам')
  assert.deepEqual(tasks[1].board, { stage: 'To Do', refs: [] })
  assert.equal(tasks[1].artifactStage, 'FAST-DONE')
  assert.equal(tasks[1].links.html, '.bft/documentation/po-11/po-11-fast.html')
  assert.deepEqual(tasks[2].missing, ['документ БФТ'])
})

test('отмена на доске старше любого файла', async () => {
  const ports = boardPorts({
    '/ws/.bft/documentation': ['po-5'],
    '/ws/.bft/documentation/po-5': ['po-5-fast.md', 'po-5-fast.html'],
    '/ws/.bft/documentation/po-5/po-5-fast.md': fastDoc('po-5', 'Отменённая'),
  }, boardJson([{ id: 'PO-5', title: 'Отменённая', status: 'Cancelled' }]))
  const { tasks } = await scanWorkspace(loadConfig(ENV_BOARD), ports)
  assert.deepEqual(tasks.map(t => [t.id, t.stage, t.stageSource]), [['PO-5', 'Cancelled', 'backlog']])
})

test('два претендента на один каталог: связывается первый, второй остаётся отдельной строкой', async () => {
  const ports = boardPorts({
    '/ws/.bft/documentation': ['shared'],
    '/ws/.bft/documentation/shared': ['shared-fast.md'],
    '/ws/.bft/documentation/shared/shared-fast.md': fastDoc('shared', 'Одно название'),
  }, boardJson([
    { id: 'PO-1', title: 'Одно название', status: 'To Do' },
    { id: 'PO-2', title: 'Одно название', status: 'To Do' },
  ]))
  const { tasks } = await scanWorkspace(loadConfig(ENV_BOARD), ports)
  assert.deepEqual(tasks.map(t => [t.id, t.slug]), [['PO-1', 'shared'], ['PO-2', undefined]])
})

test('доска читается одним вызовом --json с фильтром по типу', async () => {
  const calls: string[][] = []
  const ports = boardPorts({ '/ws/.bft/documentation': [] }, boardJson([]), calls)
  await scanWorkspace(loadConfig(ENV_BOARD), ports)
  assert.deepEqual(calls, [['task', 'list', '--type', 'bft', '--json']])
})

test('CLI без --json падает на запасной --plain; нет CLI — очередь только из файлов', async () => {
  const tree = {
    '/ws/.bft/documentation': ['alpha'],
    '/ws/.bft/documentation/alpha': ['alpha-fast.md', 'alpha-fast.html'],
  }
  const plainOnly: BftPorts = {
    ...fakePorts(tree),
    async runCommand(_bin, args) {
      if (args.includes('--json')) return { stdout: 'error: unknown option', code: 1 }
      return { stdout: 'To Do:\n  [bft] PO-3 - БФТ: Из plain\n', code: 0 }
    },
  }
  const viaPlain = await scanWorkspace(loadConfig(ENV_BOARD), plainOnly)
  assert.deepEqual(viaPlain.tasks.map(t => t.id), ['alpha', 'PO-3'])
  assert.equal(viaPlain.boardAvailable, true)

  const noCli = await scanWorkspace(loadConfig(ENV_BOARD), fakePorts(tree))
  assert.deepEqual(noCli.tasks.map(t => t.id), ['alpha'])
  assert.equal(noCli.boardAvailable, false)
})
