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

test('роль документа выбирает, какой артефакт эпика открыть', async () => {
  const tree = {
    '/ws/.bft/documentation': ['alpha'],
    '/ws/.bft/documentation/alpha': ['alpha-fast.md', 'alpha-fast.html', 'alpha-custdev.md', 'alpha-custdev.html'],
    '/ws/.bft/documentation/alpha/alpha-fast.md': DOC,
    '/ws/.bft/documentation/alpha/alpha-fast.html': '<h1>БФТ</h1>',
    '/ws/.bft/documentation/alpha/alpha-custdev.md': '# CustDev',
    '/ws/.bft/documentation/alpha/alpha-custdev.html': '<h1>Интервью</h1>',
  }
  const reader = new BftReader(loadConfig(ENV), ports(tree))

  // По умолчанию — документ требования: старый вызов без роли ведёт себя как прежде.
  const requirement = await reader.findDocument('alpha')
  assert.equal(requirement?.path, '.bft/documentation/alpha/alpha-fast.html')
  assert.equal(requirement?.content, '<h1>БФТ</h1>')

  const custdev = await reader.findDocument('alpha', 'custdev')
  assert.equal(custdev?.path, '.bft/documentation/alpha/alpha-custdev.html')
  assert.equal(custdev?.content, '<h1>Интервью</h1>')
})

test('интервью не готовили — роль custdev отдаёт null, а не документ требования', async () => {
  const reader = new BftReader(loadConfig(ENV), ports({ ...TREE }))
  assert.equal(await reader.findDocument('alpha', 'custdev'), null)
})

// ── Доска: черновик создания, сверка, документ по связке ─────────────────────

const ENV_BOARD = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }
const fastDoc = (slug: string, title: string) =>
  `---\npageId: pending\nepic_slug: ${slug}\nstage: fast\n---\n\n# [БФТ] ${slug}: ${title}\n`
const listJson = (tasks: Array<{ id: string; title: string; status: string; references?: string[] }>) =>
  JSON.stringify({ schemaVersion: 1, kind: 'task-list', tasks: tasks.map(t => ({ type: 'bft', references: [], ...t })) })
const viewJson = (task: Record<string, unknown>) => JSON.stringify({ schemaVersion: 1, kind: 'task-view', task })

/** Доска-подделка: список, карточка и запись — с учётом уже сделанных правок. */
function boardPorts(
  tree: Record<string, string[] | string>,
  board: Array<{ id: string; title: string; status: string; references: string[]; description?: string }>,
  calls: string[][] = [],
): BftPorts {
  return {
    ...ports(tree),
    async runCommand(_bin, args) {
      calls.push(args)
      if (args[1] === 'list') return { stdout: listJson(board), code: 0 }
      if (args[1] === 'view') {
        const task = board.find(t => t.id === args[2])
        return task ? { stdout: viewJson({ ...task, acceptanceCriteria: [{ text: 'Крит 1' }] }), code: 0 } : { stdout: '', code: 1 }
      }
      if (args[1] === 'edit') {
        const task = board.find(t => t.id === args[2])
        if (!task) return { stdout: '', stderr: 'Task not found', code: 1 }
        const status = args.indexOf('-s')
        if (status !== -1) task.status = args[status + 1]
        const ref = args.indexOf('--add-ref')
        if (ref !== -1 && !task.references.includes(args[ref + 1])) task.references.push(args[ref + 1])
        return { stdout: 'ok', code: 0 }
      }
      return { stdout: '', code: 1 }
    },
  }
}

test('задача без документа: черновик — /bft-fast с источником из задачи и слагом по id', async () => {
  const tree: Record<string, string[] | string> = { '/ws/.bft/documentation': [] }
  const board = [{ id: 'PO-11', title: 'БФТ: AI Harness агент', status: 'To Do', references: [], description: 'Заказчик: Иванов. PoC агента.' }]
  const reader = new BftReader(loadConfig(ENV_BOARD), boardPorts(tree, board))

  const draft = await reader.handoff('PO-11')
  assert.equal(draft.continued, false)
  assert.match(draft.prompt, /^\/bft-fast PO-11 po-11\n/)
  assert.match(draft.prompt, /Название эпика \(дословно в H1\): AI Harness агент/)
  assert.match(draft.prompt, /<docs_path>\/po-11\/po-11-fast\.md по docs_path из bft-config\.md/)
  assert.match(draft.prompt, /Описание:\nЗаказчик: Иванов\. PoC агента\./)
  assert.match(draft.prompt, /Критерии приёмки:\n1\. Крит 1/)

  // Заход открыт в журнале — сверка закроет его, когда документ появится.
  const log = await reader.readWorkLog()
  assert.deepEqual(log.entries.map(e => [e.epic, e.stage, e.finishedAt]), [['PO-11', 'To Do', undefined]])
})

test('сверка: документ появился — доска поднята, ссылка записана, отрезок закрыт; повтор пуст', async () => {
  const tree: Record<string, string[] | string> = {
    '/ws/.bft/documentation': ['po-11'],
    '/ws/.bft/documentation/po-11': ['po-11-fast.md', 'po-11-fast.html'],
    '/ws/.bft/documentation/po-11/po-11-fast.md': fastDoc('po-11', 'AI Harness агент'),
    '/ws/.bft/documentation/po-11/po-11-fast.html': '<h1>x</h1>',
  }
  const board = [{ id: 'PO-11', title: 'БФТ: AI Harness агент', status: 'To Do', references: [] }]
  const calls: string[][] = []
  const reader = new BftReader(loadConfig(ENV_BOARD), boardPorts(tree, board, calls))
  await reader.startWork({ epic: 'PO-11', stage: 'To Do', startedAt: '2026-09-12T08:00:00Z' })

  const first = await reader.reconcile()
  assert.deepEqual(first.edits, [{ id: 'PO-11', stage: 'FAST-DONE', addRef: '.bft/documentation/po-11/po-11-fast.html', ok: true }])
  assert.deepEqual(calls.filter(c => c[1] === 'edit'), [
    ['task', 'edit', 'PO-11', '-s', 'FAST-DONE', '--add-ref', '.bft/documentation/po-11/po-11-fast.html', '--plain'],
  ])
  assert.deepEqual(first.scan.tasks.map(t => [t.id, t.stage, t.board?.stage, t.board?.refs]),
    [['PO-11', 'FAST-DONE', 'FAST-DONE', ['.bft/documentation/po-11/po-11-fast.html']]])

  const log = await reader.readWorkLog()
  assert.equal(log.entries[0].finishedAt !== undefined, true)
  assert.equal(log.entries[0].summary, 'FAST-DONE, страница .bft/documentation/po-11/po-11-fast.html')

  const second = await reader.reconcile()
  assert.deepEqual(second.edits, [])
  assert.equal(calls.filter(c => c[1] === 'edit').length, 1, 'повторная сверка ничего не пишет')

  // Список для панели идёт через сверку и отдаёт уже слитую строку.
  assert.deepEqual((await reader.listTasks()).map(t => [t.id, t.slug, t.stage]), [['PO-11', 'po-11', 'FAST-DONE']])
})

test('сверка: провал CLI — причина словом у задачи, скан жив', async () => {
  const tree: Record<string, string[] | string> = {
    '/ws/.bft/documentation': ['po-11'],
    '/ws/.bft/documentation/po-11': ['po-11-fast.md', 'po-11-fast.html'],
    '/ws/.bft/documentation/po-11/po-11-fast.md': fastDoc('po-11', 'X'),
  }
  const board = [{ id: 'PO-11', title: 'X', status: 'To Do', references: [] }]
  const failing: BftPorts = {
    ...boardPorts(tree, board),
    async runCommand(_bin, args) {
      if (args[1] === 'list') return { stdout: listJson(board), code: 0 }
      return { stdout: '', stderr: 'Error: Invalid status', code: 1 }
    },
  }
  const { scan, edits } = await new BftReader(loadConfig(ENV_BOARD), failing).reconcile()
  assert.equal(edits[0].ok, false)
  assert.deepEqual(scan.tasks[0].missing, ['доска не обновлена: Error: Invalid status'])
  assert.equal(scan.tasks[0].stage, 'FAST-DONE', 'стадия по файлам показывается и без доски')
})

test('документ задачи находится по связке, а не по идентификатору-как-каталогу', async () => {
  const tree: Record<string, string[] | string> = {
    '/ws/.bft/documentation': ['legacy'],
    '/ws/.bft/documentation/legacy': ['legacy-fast.md', 'legacy-fast.html'],
    '/ws/.bft/documentation/legacy/legacy-fast.md': fastDoc('legacy', 'Блокировка мест'),
    '/ws/.bft/documentation/legacy/legacy-fast.html': '<h1>Страница</h1>',
  }
  const board = [{ id: 'PO-20', title: 'БФТ: Блокировка мест', status: 'FAST-DONE', references: ['bft/documentation/legacy/legacy-fast.html'] }]
  const reader = new BftReader(loadConfig(ENV_BOARD), boardPorts(tree, board))
  const found = await reader.findDocument('PO-20')
  assert.deepEqual(found, { path: '.bft/documentation/legacy/legacy-fast.html', kind: 'html', content: '<h1>Страница</h1>' })
  // Документ есть — черновик продолжает работу, а не создаёт документ заново.
  assert.match((await reader.handoff('PO-20')).prompt, /^Продолжи работу над БФТ PO-20/)
})
