import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BftReader } from '../src/bft-reader.js'
import { loadConfig } from '../src/config.js'
import { ChatBusyError, ChatRunNotFoundError, ChatUnavailableError, DocumentOutsideWorkspaceError, InvalidTaskIdError, OkrHandoffError, TaskNotFoundError } from '../src/errors.js'
import type { BftPorts, StreamSink } from '../src/ports.js'

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
  assert.deepEqual(first.edits, [{ id: 'PO-11', stage: 'FAST-DONE', addRefs: ['.bft/documentation/po-11/po-11-fast.html'], ok: true }])
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

// ── «Добавить в OKR» ──────────────────────────────────────────────────────────

const deepDoc = (slug: string, title: string) =>
  `---\npageId: 2272447498\njira: "GDSLV-1409"\nepic_slug: ${slug}\nstage: deep\n---\n\n# [БФТ] ${slug}: ${title}\n`
const OKR_FORM = {
  confluence: 'https://confluence.mts.ru/pages/viewpage.action?pageId=2272447498',
  epic: 'https://jira.mts.ru/browse/GDSLV-1409',
  quarter: '2026-Q4',
  stages: {
    research: { sprint: null, resources: '' },
    analyze: { sprint: 2, resources: 'SA' },
    dev: { sprint: 3, resources: 'BE' },
    qa: { sprint: null, resources: '' },
    release: { sprint: null, resources: '' },
  },
  teams: 'GDS/Платформа',
  techLeads: '',
  executors: '',
  comment: 'Ждём Финтех',
}
const DEEP_TREE = {
  '/ws/.bft/documentation': ['po-140'],
  '/ws/.bft/documentation/po-140': ['po-140.md', 'po-140.html'],
  '/ws/.bft/documentation/po-140/po-140.md': deepDoc('po-140', 'Признак заказа'),
  '/ws/.bft/documentation/po-140/po-140.html': '<h1>x</h1>',
}

test('добавить в OKR: стадия OKR-ADDED, план и комментарий на доске, отрезок закрыт', async () => {
  const tree: Record<string, string[] | string> = { ...DEEP_TREE }
  const board = [{ id: 'PO-140', title: 'БФТ: Признак заказа', status: 'DEEP-DONE', references: ['.bft/documentation/po-140/po-140.html'] }]
  const calls: string[][] = []
  const reader = new BftReader(loadConfig(ENV_BOARD), boardPorts(tree, board, calls))

  const task = await reader.addToOkr('PO-140', OKR_FORM)
  assert.equal(task.stage, 'OKR-ADDED')
  assert.equal(task.stageSource, 'backlog', 'по файлам стадия остаётся DEEP-DONE — выше её ставит доска')
  assert.equal(task.artifactStage, 'DEEP-DONE')

  const edit = calls.find(c => c[1] === 'edit')
  assert.deepEqual(edit, [
    'task', 'edit', 'PO-140', '-s', 'OKR-ADDED',
    '--plan', 'quarter: 2026-Q4\nanalyze: спринт 3 / SA\ndev: спринт 4 / BE\nteams: GDS/Платформа',
    '--append-notes', 'OKR: Ждём Финтех',
    '--add-ref', OKR_FORM.confluence,
    '--add-ref', OKR_FORM.epic,
    '--plain',
  ])

  const log = await reader.readWorkLog()
  assert.deepEqual(log.entries.map(e => [e.epic, e.stage, e.summary]), [['PO-140', 'DEEP-DONE', 'OKR-ADDED, квартал 2026-Q4']])

  // Сверка после передачи ничего не понижает: OKR-ADDED выше DEEP-DONE по артефактам.
  // Доска-подделка статична и ссылку на эпик, которую только что дописал addToOkr, не
  // помнит — поэтому сверка честно просит её снова: эпик из frontmatter документа.
  const { edits } = await reader.reconcile()
  assert.deepEqual(edits, [{ id: 'PO-140', addRefs: [OKR_FORM.epic], ok: true }])
})

test('в OKR передаётся только DEEP-DONE и только с доски', async () => {
  const notReady = [{ id: 'PO-140', title: 'X', status: 'DEEP-REVIEW', references: [] }]
  const tree: Record<string, string[] | string> = { ...DEEP_TREE, '/ws/.bft/documentation/po-140': ['po-140.md'] }
  await assert.rejects(
    () => new BftReader(loadConfig(ENV_BOARD), boardPorts(tree, notReady)).addToOkr('PO-140', OKR_FORM),
    (error: unknown) => error instanceof OkrHandoffError && /DEEP-REVIEW/.test(error.message),
  )

  // Уже передано — второй раз план не перезаписывается.
  const added = [{ id: 'PO-140', title: 'X', status: 'OKR-ADDED', references: [] }]
  await assert.rejects(
    () => new BftReader(loadConfig(ENV_BOARD), boardPorts({ ...DEEP_TREE }, added)).addToOkr('PO-140', OKR_FORM),
    (error: unknown) => error instanceof OkrHandoffError && /OKR-ADDED/.test(error.message),
  )

  // Документ без задачи доски: писать некуда.
  await assert.rejects(
    () => new BftReader(loadConfig(ENV_BOARD), boardPorts({ ...DEEP_TREE }, [])).addToOkr('po-140', OKR_FORM),
    (error: unknown) => error instanceof OkrHandoffError && /нет задачи на доске/.test(error.message),
  )

  // Доска выключена в настройках.
  await assert.rejects(
    () => new BftReader(loadConfig({ ...ENV_BOARD, BFT_BACKLOG_BIN: 'off' }), ports({ ...DEEP_TREE })).addToOkr('po-140', OKR_FORM),
    (error: unknown) => error instanceof OkrHandoffError && /выключена/.test(error.message),
  )
})

test('добавить в OKR: отказ CLI — причина в ошибке, журнал не трогается', async () => {
  const board = [{ id: 'PO-140', title: 'X', status: 'DEEP-DONE', references: [] }]
  const tree: Record<string, string[] | string> = { ...DEEP_TREE }
  const failing: BftPorts = {
    ...boardPorts(tree, board),
    async runCommand(_bin, args) {
      if (args[1] === 'list') return { stdout: listJson(board), code: 0 }
      return { stdout: '', stderr: 'Error: Invalid status: OKR-ADDED', code: 1 }
    },
  }
  const reader = new BftReader(loadConfig(ENV_BOARD), failing)
  await assert.rejects(
    () => reader.addToOkr('PO-140', OKR_FORM),
    (error: unknown) => error instanceof OkrHandoffError && /Invalid status: OKR-ADDED/.test(error.message),
  )
  assert.deepEqual((await reader.readWorkLog()).entries, [])
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
  // Документ есть — черновик открывается командой следующего навыка по слагу каталога и
  // продолжает работу, а не создаёт документ заново. Пути — от рабочего пространства чата
  // (`.bft/`, родитель docsPath), а не от корня раздела.
  const handoff = await reader.handoff('PO-20')
  assert.equal(handoff.command, '/bft-deep legacy')
  assert.match(handoff.prompt, /^\/bft-deep legacy\n\nПродолжи работу над БФТ PO-20/)
  assert.match(handoff.prompt, /Документ: documentation\/legacy\/legacy-fast\.md/)
  // Правка PO уходит в тот же черновик обратной связью к документу.
  assert.match((await reader.handoff('PO-20', 'Добавь шаг.')).prompt, /Правка PO к документу documentation\/legacy\/legacy-fast\.md:\nДобавь шаг\./)
})

// ── Рабочее пространство чатов и сессии ──────────────────────────────────────

test('рабочее пространство чатов — родитель каталога документов, с bft-config.md из корня и относительными путями', async () => {
  const tree: Record<string, string[] | string> = {
    '/ws/bft/documentation': ['alpha'],
    '/ws/bft/documentation/alpha': ['alpha-fast.md'],
    '/ws/bft-config.md': '# bft-config\n\n## docs_path\nbft/documentation\n\n## team_name\nGDS\n',
  }
  const reader = new BftReader(
    loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0', BFT_INDEX_PATH: 'bft/index', BFT_SKILLS_PATH: 'agent/skills' }),
    ports(tree),
  )
  assert.equal(await reader.sessionWorkspace(), '/ws/bft')
  const config = tree['/ws/bft/bft-config.md']
  assert.equal(typeof config, 'string')
  assert.match(config as string, /## docs_path\ndocumentation\n/)
  assert.match(config as string, /## index_path\nindex\n/)
  assert.match(config as string, /## skills_path\n\.\.\/agent\/skills\n/)
  assert.match(config as string, /## team_name\nGDS/)

  // Копия следует за корневым конфигом: PO дописал wiki_space в корне — в копии он есть.
  tree['/ws/bft-config.md'] = '# bft-config\n\n## docs_path\nbft/documentation\n\n## wiki_space\nGDS\n'
  await reader.sessionWorkspace()
  assert.match(tree['/ws/bft/bft-config.md'] as string, /## wiki_space\nGDS/)
  assert.match(tree['/ws/bft/bft-config.md'] as string, /## docs_path\ndocumentation\n/)
})

test('корневого конфига нет — копия из шаблона один раз, дальше правки PO в ней не трогаются', async () => {
  const tree: Record<string, string[] | string> = { '/ws/bft/documentation': [] }
  const reader = new BftReader(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0', BFT_DOCS_PATH: 'bft/documentation', BFT_INDEX_PATH: 'bft/index' }), ports(tree))
  await reader.sessionWorkspace()
  assert.match(tree['/ws/bft/bft-config.md'] as string, /## docs_path\ndocumentation\n/)
  tree['/ws/bft/bft-config.md'] = 'мой конфиг'
  await reader.sessionWorkspace()
  assert.equal(tree['/ws/bft/bft-config.md'], 'мой конфиг')
})

test('привязка чатов выключена пустым sessionPath — null, ничего не пишется', async () => {
  const tree: Record<string, string[] | string> = { '/ws/.bft/documentation': [] }
  const reader = new BftReader(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0', BFT_SESSION_PATH: '' }), ports(tree))
  assert.equal(await reader.sessionWorkspace(), null)
  assert.equal(Object.keys(tree).length, 1)
})

test('сессия чата записывается в журнал и возвращается в строке требования', async () => {
  const tree: Record<string, string[] | string> = {
    '/ws/.bft/documentation': ['alpha'],
    '/ws/.bft/documentation/alpha': ['alpha-fast.md', 'alpha-fast.html'],
  }
  const reader = new BftReader(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }), ports(tree))
  await reader.attachSession('alpha', 'sess-1')
  let task = await reader.getTask('alpha')
  assert.deepEqual([task.session?.id, task.session?.state], ['sess-1', 'idle'])

  await reader.touchSession('sess-1', 'running')
  await reader.touchSession('other', 'running')
  task = await reader.getTask('alpha')
  assert.equal(task.session?.state, 'running')

  await reader.markInterrupted()
  task = await reader.getTask('alpha')
  assert.equal(task.session?.state, 'failed')

  await assert.rejects(() => reader.attachSession('nope', 'sess-9'), TaskNotFoundError)
})

test('параллельные правки журнала не теряются: записи идут через одну очередь', async () => {
  const tree: Record<string, string[] | string> = {
    '/ws/.bft/documentation': ['alpha', 'beta'],
    '/ws/.bft/documentation/alpha': ['alpha-fast.md'],
    '/ws/.bft/documentation/beta': ['beta-fast.md'],
  }
  const reader = new BftReader(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }), ports(tree))
  await Promise.all([reader.attachSession('alpha', 's-a'), reader.attachSession('beta', 's-b')])
  await Promise.all([reader.touchSession('s-a', 'running'), reader.touchSession('s-b', 'failed')])
  const log = await reader.readWorkLog()
  assert.deepEqual(log.entries.map(e => [e.epic, e.sessionId, e.sessionState]).sort(), [['alpha', 's-a', 'running'], ['beta', 's-b', 'failed']])
})

test('чат через Claude Code: без порта запуска — недоступен, статус отвечает available:false', async () => {
  const reader = new BftReader(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }), ports({ ...TREE }))
  assert.equal(reader.chatAvailable(), false)
  assert.equal(reader.chatStatus('alpha'), null)
  await assert.rejects(() => reader.chatStart('alpha'), ChatUnavailableError)
  assert.throws(() => reader.chatPoll('run', 0), ChatUnavailableError)
})

test('ход Claude Code: черновик в stdin, cwd — рабочее пространство чатов, сессия в журнале до первого события', async () => {
  const tree: Record<string, string[] | string> = { ...TREE }
  const spawned: { bin: string; args: string[]; cwd: string; input: string; sink: StreamSink }[] = []
  const base = ports(tree)
  const reader = new BftReader(
    loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0', BFT_CLAUDE_BIN: '/opt/claude' }),
    {
      ...base,
      spawnStreaming(bin, args, cwd, input, sink) {
        spawned.push({ bin, args, cwd, input, sink })
        return { kill() { sink.exit(null) } }
      },
    },
  )
  assert.equal(reader.chatAvailable(), true)

  const started = await reader.chatStart('alpha', 'Убери раздел про MRS.')
  assert.equal(started.status, 'running')
  assert.equal(spawned.length, 1)
  assert.equal(spawned[0].bin, '/opt/claude')
  assert.equal(spawned[0].cwd, '/ws/.bft', 'родитель каталога документов')
  assert.ok(spawned[0].input.startsWith('/bft-deep alpha\n'), spawned[0].input)
  assert.match(spawned[0].input, /Правка PO к документу documentation\/alpha\/alpha\.md:\nУбери раздел про MRS\./)
  const sessionArg = spawned[0].args.indexOf('--session-id')
  assert.ok(sessionArg >= 0, spawned[0].args.join(' '))
  assert.equal(spawned[0].args[sessionArg + 1], started.sessionId)
  assert.deepEqual(spawned[0].args.slice(spawned[0].args.indexOf('--add-dir'), spawned[0].args.indexOf('--add-dir') + 2), ['--add-dir', '/ws'])

  // Журнал: сессия Claude Code, «агент ходит» — ещё до того, как CLI что-то ответил.
  let task = await reader.getTask('alpha')
  assert.deepEqual([task.session?.id, task.session?.kind, task.session?.state], [started.sessionId, 'claude', 'running'])
  assert.deepEqual(reader.chatStatus('alpha'), { runId: started.runId, status: 'running', sessionId: started.sessionId })

  // Второй ход, пока идёт первый, — отказ.
  await assert.rejects(() => reader.chatStart('alpha'), ChatBusyError)

  // Опрос: черновик первым событием, дальше — поток CLI.
  spawned[0].sink.line(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Готово' } } }))
  const poll = reader.chatPoll(started.runId, 0)
  assert.deepEqual(poll.events.map(event => event.kind), ['user', 'delta'])
  assert.throws(() => reader.chatPoll('nope', 0), ChatRunNotFoundError)

  // Завершение: журнал — «ждёт», следующий ход продолжает ту же сессию.
  spawned[0].sink.line(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Готово', session_id: started.sessionId }))
  spawned[0].sink.exit(0)
  await new Promise(resolve => setTimeout(resolve, 20))
  task = await reader.getTask('alpha')
  assert.equal(task.session?.state, 'idle')
  // Продолжение сессии: текст PO уходит как есть — это ответ в тот же диалог.
  const second = await reader.chatStart('alpha', ' ок, публикуй ')
  assert.equal(second.sessionId, started.sessionId)
  const resumeArg = spawned[1].args.indexOf('--resume')
  assert.equal(spawned[1].args[resumeArg + 1], started.sessionId)
  assert.ok(!spawned[1].args.includes('--session-id'))
  assert.equal(spawned[1].input, 'ок, публикуй')
  spawned[1].sink.exit(0)
  await new Promise(resolve => setTimeout(resolve, 20))

  // Пустое поле в продолжаемой сессии — черновик следующего шага по артефактам.
  const third = await reader.chatStart('alpha')
  assert.equal(third.sessionId, started.sessionId)
  assert.ok(spawned[2].input.startsWith('/bft-deliver alpha\n'), spawned[2].input)
  spawned[2].sink.exit(0)
  await new Promise(resolve => setTimeout(resolve, 20))

  // Сессии на диске больше нет: CLI упал, не назвав её в init, — журнал говорит «удалена»,
  // следующий ход открывает новую сессию, а не бьётся в ту же ошибку.
  await reader.chatStart('alpha', 'ещё')
  spawned[3].sink.stderr('No conversation found with session ID: ' + started.sessionId)
  spawned[3].sink.exit(1)
  await new Promise(resolve => setTimeout(resolve, 20))
  task = await reader.getTask('alpha')
  assert.equal(task.session?.state, 'gone')
  const fresh = await reader.chatStart('alpha', 'снова')
  assert.notEqual(fresh.sessionId, started.sessionId)
  assert.ok(spawned[4].args.includes('--session-id') && !spawned[4].args.includes('--resume'))
  // Новая сессия — снова черновик навыка: правка к deep-документу — под /bft-deep.
  assert.ok(spawned[4].input.startsWith('/bft-deep alpha\n'), spawned[4].input)
  assert.match(spawned[4].input, /Правка PO к документу documentation\/alpha\/alpha\.md:\nснова/)

  // «Остановить» — ход stopped, сессия ждёт PO, а не «прервалась».
  assert.equal(reader.chatStop(fresh.runId), true)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(reader.chatPoll(fresh.runId, 0).status, 'stopped')
  task = await reader.getTask('alpha')
  assert.equal(task.session?.state, 'idle')
})

test('сверки не идут параллельно: вторая ждёт первую', async () => {
  const tree: Record<string, string[] | string> = { ...TREE }
  let inFlight = 0
  let overlap = 0
  const base = ports(tree)
  const reader = new BftReader(loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0', BFT_BACKLOG_BIN: '/opt/backlog' }), {
    ...base,
    async runCommand() {
      inFlight += 1
      if (inFlight > 1) overlap += 1
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return { stdout: '', code: -1 }
    },
  })
  await Promise.all([reader.reconcile(), reader.reconcile(), reader.listTasks()])
  assert.equal(overlap, 0)
})
