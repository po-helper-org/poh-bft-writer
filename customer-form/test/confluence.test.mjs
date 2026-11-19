// Документы Confluence в чате заказчика (ADR-0019): поиск и чтение через службу
// dataSources (шлюз источников — двойник), материал заявки, страница в карте
// находок полного БФТ, честный ответ при недоступном шлюзе.
// Данные вымышленные: нейтральный домен «заявки на ремонт оборудования».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// Папка документов заявок (FAST_ROOT) — во временном каталоге: модули читают DSH_HOME при загрузке.
process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'cf-confluence-'))
const {
  confluenceLink, customerPage, hitsText, pageLabel, readCustomerPages, sameConfluence, saveCustomerPages, unavailableText, withCustomerPages,
} = await import('../lib-test/confluence.js')
const { Materials } = await import('../lib-test/materials.js')
const { attachConfluenceTool, searchConfluenceTool } = await import('../lib-test/tool.js')
const { parseSources } = await import('../lib-test/canon-check.js')
const { sourcesForModel } = await import('../lib-test/bft-deep.js')
const { FAST_ROOT, fastFiles, fastSlug } = await import('../lib-test/bft-fast.js')

const WIKI = 'https://wiki.example.test'
const HITS = [
  { id: '101', title: 'Регламент заявок на ремонт', url: `${WIKI}/pages/viewpage.action?pageId=101`, container: 'SRV', containerName: 'Сервис', updated: '2026-10-02T10:00:00Z', snippet: 'Заявку подаёт мастер смены' },
  { id: '102', title: 'Ремонт: справочник оборудования', url: `${WIKI}/pages/viewpage.action?pageId=102`, container: 'SRV' },
]
const PAGE = {
  id: '101', title: 'Регламент заявок на ремонт', url: `${WIKI}/pages/viewpage.action?pageId=101`, space: 'SRV', spaceName: 'Сервис', updated: '2026-10-02',
  text: '## Порядок\n\nЗаявку подаёт мастер смены. Диспетчер назначает исполнителя в течение 2 часов.',
}

/** Служба dataSources-двойник: что спрашивали, что отвечать. */
function fakeSource({ available = true, search, read } = {}) {
  const calls = []
  return {
    calls,
    available: async () => available,
    searchConfluence: async (query, limit) => { calls.push(['search', query, limit]); return search ? search(query) : HITS },
    readConfluencePage: async (id) => { calls.push(['read', id]); return read ? read(id) : { ...PAGE, id } },
  }
}

const agent = (id = 's-1') => ({ session: { id, deriveMessages: () => [] }, inject() {} })
const noBacklog = { find: async () => undefined }

test('ссылки Confluence: id страницы, /display/, прочие — мимо', () => {
  assert.deepEqual(confluenceLink(`${WIKI}/pages/viewpage.action?pageId=101`), { pageId: '101' })
  assert.deepEqual(confluenceLink('https://acme.example.test/wiki/spaces/SRV/pages/555/Title+Here'), { pageId: '555' })
  assert.deepEqual(confluenceLink(`${WIKI}/display/SRV/Регламент+заявок`), { space: 'SRV', title: 'Регламент заявок' })
  assert.equal(confluenceLink('https://shop.example.test/item?pageId=7'), undefined, 'pageId на чужом сайте — не Confluence')
  assert.equal(confluenceLink('https://news.example.test/display/a/b'), undefined, '/display/ не на вики — мимо')
  assert.equal(confluenceLink('https://docs.google.com/document/d/x/edit'), undefined)
  assert.equal(confluenceLink('not a url'), undefined)
  assert.ok(sameConfluence(`${WIKI}/x`, PAGE))
  assert.ok(!sameConfluence('https://other.example.test/x', PAGE), 'страница с другого хоста — не та')
})

test('список для модели: название, пространство, ссылка; пусто — честно', () => {
  const list = hitsText('регламент ремонта', HITS)
  assert.match(list, /1\. «Регламент заявок на ремонт» — Сервис \(SRV\), изменена 2026-10-02/)
  assert.match(list, /pageId: 101 · ссылка: https:\/\/wiki\.example\.test\/pages\/viewpage\.action\?pageId=101/)
  assert.match(list, /ask_user_question/)
  assert.match(list, /attach_confluence_page/)
  assert.match(hitsText('марсоход', []), /ничего не найдено.*не выдумывай/s)
  assert.match(unavailableText('шлюз источников не ответил'), /недоступен \(шлюз источников не ответил\).*не выдумывай/s)
})

test('search_confluence: запрос в шлюз, список; нет источника или сбой — «недоступен»', async () => {
  const materials = new Materials('http://ingest.invalid')
  const tool = searchConfluenceTool(materials)
  assert.match(await tool.execute({ query: 'регламент' }, { agent: agent() }), /Поиск по Confluence сейчас недоступен \(источник не подключён\)/)

  materials.confluence = fakeSource({ available: false })
  assert.match(await tool.execute({ query: 'регламент' }, { agent: agent() }), /недоступен/)

  materials.confluence = fakeSource({ search: () => { throw new Error('MCP HTTP 502: Bad Gateway') } })
  const down = await tool.execute({ query: 'регламент' }, { agent: agent() })
  assert.match(down, /недоступен \(шлюз источников не ответил\)/)
  assert.doesNotMatch(down, /502/, 'подробности сбоя — в журнал, не модели')

  const source = fakeSource()
  materials.confluence = source
  const found = await tool.execute({ query: '  регламент   ремонта ', limit: 50 }, { agent: agent() })
  assert.deepEqual(source.calls[0], ['search', 'регламент ремонта', 10], 'запрос сжат, лимит не больше 10')
  assert.match(found, /Регламент заявок на ремонт/)
  await assert.rejects(tool.execute({ query: ' ' }, { agent: agent() }), /пустой запрос/)
})

test('attach_confluence_page: материал S1 сразу модели, повтор не дублирует, read_customer_materials его не повторяет', async () => {
  const materials = new Materials('http://ingest.invalid')
  const source = fakeSource()
  materials.confluence = source
  const search = searchConfluenceTool(materials)
  const attach = attachConfluenceTool(materials, noBacklog)
  const a = agent('s-attach')
  await search.execute({ query: 'регламент' }, { agent: a })
  const out = await attach.execute({ pageId: '101' }, { agent: a })
  assert.match(out, /приложена к заявке как материал S1/)
  assert.match(out, /<source id="S1" name="Confluence: Регламент заявок на ремонт" type="страница Confluence «Регламент заявок на ремонт» — Сервис \(SRV\)/)
  assert.match(out, /Источник: https:\/\/wiki\.example\.test\/pages\/viewpage\.action\?pageId=101/)
  assert.match(out, /Диспетчер назначает исполнителя в течение 2 часов/)
  assert.match(out, /links submit_customer_request/)
  assert.deepEqual(materials.list('s-attach').map((m) => m.name), ['Confluence: Регламент заявок на ремонт'])

  await attach.execute({ pageId: '101' }, { agent: a })
  assert.equal(materials.list('s-attach').length, 1, 'та же страница — тот же материал')
  assert.equal(source.calls.filter(([kind]) => kind === 'read').length, 1)
  assert.deepEqual((await materials.take('s-attach')).ready, [], 'уже отдан модели результатом инструмента')
  assert.deepEqual(materials.confluencePages('s-attach').map((p) => [p.page.id, p.material]), [['101', 'S1']])

  await assert.rejects(attach.execute({ pageId: '101; DROP' }, { agent: a }), /только цифры/)
})

test('attach_confluence_page: страница не читается или шлюза нет — «недоступен», без выдумки', async () => {
  const materials = new Materials('http://ingest.invalid')
  const attach = attachConfluenceTool(materials, noBacklog)
  assert.match(await attach.execute({ pageId: '101' }, { agent: agent('s-x') }), /недоступен \(источник не подключён\)/)
  materials.confluence = fakeSource({ read: () => { throw new Error('страница удалена') } })
  assert.match(await attach.execute({ pageId: '101' }, { agent: agent('s-x') }), /недоступен \(страница не прочитана: страница удалена\)/)
})

test('attach_confluence_page: .md в задачу и страница рядом с документом для полного БФТ', async () => {
  const materials = new Materials('http://ingest.invalid')
  materials.confluence = fakeSource()
  const files = []
  const ticket = { taskId: 990001 }
  const backlog = { find: async () => ticket, attach: async (_t, name, bytes) => { files.push([name, new TextDecoder().decode(bytes)]) } }
  await attachConfluenceTool(materials, backlog).execute({ pageId: '101' }, { agent: agent('s-ticket') })
  assert.equal(files.length, 1)
  assert.match(files[0][0], /^S1-confluence-.*\.md$/)
  assert.match(files[0][1], /Диспетчер назначает исполнителя/)
  const pages = await readCustomerPages(fastFiles(FAST_ROOT, fastSlug(ticket.taskId)).dir)
  assert.deepEqual(pages.map((p) => [p.id, p.material, p.url]), [['101', 'S1', PAGE.url]])
  assert.match(pages[0].body, /^\*\*Порядок\*\*/, 'заголовки страницы не режут карту находок')
})

test('ссылка Confluence в сообщении — через шлюз; чужой хост или сбой — обычная страница', async () => {
  const materials = new Materials('http://ingest.invalid')
  const webCalls = []
  materials.web = { fetch: async ({ url }) => { webCalls.push(url); return { url, statusCode: 401, body: { kind: 'text', content: '' }, truncated: false } } }
  materials.confluence = fakeSource()
  const m = materials.addLink('s-link', `${WIKI}/pages/viewpage.action?pageId=101`)
  const r = await m.result
  assert.ok(r.ok)
  assert.equal(r.label, pageLabel(PAGE))
  assert.equal(webCalls.length, 0, 'вики не открывается через ctx.web, если шлюз прочитал')
  assert.deepEqual(materials.confluencePages('s-link').map((p) => p.material), ['S1'])

  // Шлюз вернул страницу с другого Confluence — не та страница: обычная загрузка (вход нужен — ошибка, как раньше).
  materials.confluence = fakeSource({ read: (id) => ({ ...PAGE, id, url: `https://other.example.test/pages/viewpage.action?pageId=${id}` }) })
  const other = await materials.addLink('s-link2', `${WIKI}/pages/viewpage.action?pageId=101`).result
  assert.equal(other.ok, false)
  assert.match(other.error, /нужен вход/)
  assert.equal(webCalls.length, 1)

  // /display/KEY/Title — поиском, только точное название и пространство.
  const source = fakeSource()
  materials.confluence = source
  const shown = await materials.addLink('s-link3', `${WIKI}/display/SRV/Регламент+заявок+на+ремонт`).result
  assert.ok(shown.ok)
  assert.deepEqual(source.calls.map(([k]) => k), ['search', 'read'])
})

test('страницы заказчика — первым разделом карты находок; дубль разведки убран; parseSources и модель их видят', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-pages-'))
  await saveCustomerPages(dir, [customerPage(PAGE, 'S2')])
  await saveCustomerPages(dir, [customerPage({ ...PAGE, title: 'Регламент заявок на ремонт (новая версия)' }, 'S2')])
  const pages = await readCustomerPages(dir)
  assert.equal(pages.length, 1, 'по id — замена, а не дубль')

  const recon = [
    '# Корпоративные источники', '', 'Источник: Jira и Confluence · 2026-11-19 10:00. Запросы: «ремонт».', '',
    '## Регламент заявок на ремонт', 'Confluence · SRV · page', 'Тип: страница', `Ссылка для БФТ: [Confluence: Регламент заявок на ремонт](${PAGE.url})`, '', 'старое тело', '',
    '## SRV-7 · Мобильная заявка', 'Jira · SRV · Задача · Открыт', 'Тип: задача', 'Ссылка для БФТ: [Jira SRV-7](https://jira.example.test/browse/SRV-7)', '', 'описание', '',
  ].join('\n')
  const map = withCustomerPages(recon, pages)
  assert.ok(map.indexOf('## Приложено заказчиком в чате') < map.indexOf('## SRV-7'), 'страницы заказчика — первыми')
  assert.equal(map.split(PAGE.url).length - 1, 1, 'та же страница из разведки убрана')
  const found = parseSources(map)
  assert.deepEqual(found.map((f) => [f.kind, f.id]), [['confluence', '101'], ['jira', 'SRV-7']])
  assert.match(found[0].body, /Диспетчер назначает исполнителя/)
  assert.match(sourcesForModel(map), /Ссылка для БФТ: \[Confluence: Регламент заявок на ремонт \(новая версия\)\]/)

  const alone = withCustomerPages('', pages)
  assert.match(alone, /^# Корпоративные источники/)
  assert.equal(parseSources(alone).length, 1)
  assert.equal(withCustomerPages(recon, []), recon)
  assert.equal(customerPage({ ...PAGE, url: undefined }), undefined, 'без ссылки в карту не идёт')
  const long = customerPage({ ...PAGE, text: 'а'.repeat(9000) }, 'S3')
  assert.match(long.body, /полный текст в материалах заявки \(S3\)/)
  assert.ok(JSON.parse(await readFile(join(dir, 'customer-pages.json'), 'utf8')).length === 1)
})
