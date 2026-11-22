// Источник только по токену шлюза источников (ADR-0015): без OAuth, статус без
// токена, 401 — понятная ошибка без повторов, call() пускает только белый список,
// маршрутов «Подключить»/«Отключить» и приёмника входа нет.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHmac } from 'node:crypto'
import { McpSource, serviceTokenEnv, isReadOnlyTool, READ_ONLY_TOOLS, SERVICE_REJECTED, CONNECTED_LABEL } from '../lib/sources.js'
import { apply, ROUTE, DEFAULT_SOURCES } from '../lib/index.js'

const TOKEN = 'gw-test-token-not-a-secret-0123456789'

/** Подставной шлюз: пускает только Bearer TOKEN (или отвечает 401 всем). */
async function fakeGateway({ reject = false } = {}) {
  const requests = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      requests.push({ url: req.url, auth: req.headers.authorization, method: body.method, params: body.params })
      if (reject || req.headers.authorization !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"invalid_token"}')
        return
      }
      if (body.id === undefined) { res.writeHead(202).end(); return }
      let result
      if (body.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fake', version: '0' } }
      else if (body.method === 'tools/call' && body.params.name === 'confluence_search') {
        result = { content: [{ type: 'text', text: JSON.stringify([{ id: '7', title: 'Абонемент: продажа', url: 'https://c/pages/viewpage.action?pageId=7', content: { value: 'абонемент' } }]) }] }
      } else if (body.method === 'tools/call' && body.params.name === 'jira_search') {
        result = { content: [{ type: 'text', text: JSON.stringify({ issues: [{ key: 'AB-1', summary: 'Абонемент в приложении', browse_url: 'https://j/browse/AB-1' }] }) }] }
      } else result = { content: [{ type: 'text', text: 'неизвестно' }], isError: true }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }).end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/mcp`
  return { url, requests, close: () => new Promise((resolve) => server.close(resolve)) }
}

function fakeCtx() {
  const routes = new Map()
  const effects = []
  const ctx = {
    get: (name) => (name === 'connection' ? { fetch: { register: (route) => { routes.set(route.path, route); return () => {} } } } : undefined),
    effect: (fn, label) => { effects.push(label); fn() },
    inject: (_names, applyScoped) => applyScoped(ctx),
    provide: () => () => {},
  }
  return { ctx, routes, effects }
}

test('источник по умолчанию — atlassian, «Jira и Confluence (только чтение)»', () => {
  assert.deepEqual(DEFAULT_SOURCES, [{ id: 'atlassian', name: 'Jira и Confluence (только чтение)' }])
  assert.equal(serviceTokenEnv('atlassian'), 'DATA_SOURCES_TOKEN_ATLASSIAN')
  assert.equal(serviceTokenEnv('a.b c'), 'DATA_SOURCES_TOKEN_A_B_C')
})

test('белый список: ровно четыре инструмента чтения, точное совпадение имени', () => {
  assert.deepEqual([...READ_ONLY_TOOLS].sort(), ['confluence_get_page', 'confluence_search', 'jira_get_issue', 'jira_search'])
  for (const name of READ_ONLY_TOOLS) assert.equal(isReadOnlyTool(name), true)
  for (const name of ['jira_create_issue', 'confluence_update_page', 'shell', 'send_message', 'JIRA_SEARCH', 'jira_search ', ' jira_search',
    'mcp__x__jira_search', 'atlassian_jira_search', 'jira_search/../shell', 'jira_search\u0000', '', undefined, null, {}]) {
    assert.equal(isReadOnlyTool(name), false, String(name))
  }
})

test('call() отклоняет инструмент вне белого списка до сети', async () => {
  const gw = await fakeGateway()
  try {
    const source = new McpSource('gw-deny', 'Шлюз', gw.url, { serviceToken: TOKEN })
    for (const name of ['jira_create_issue', 'confluence_update_page', 'shell', 'JIRA_SEARCH', 'mcp__gw__jira_search']) {
      await assert.rejects(source.call(name, {}), /не в белом списке/)
    }
    assert.equal(gw.requests.length, 0, 'ни одного запроса к шлюзу')
  } finally {
    await gw.close()
  }
})

test('токен: поиск, статус без токена, только инструменты чтения', async () => {
  const gw = await fakeGateway()
  try {
    const source = new McpSource('gw-a', 'Шлюз', gw.url, { serviceToken: TOKEN })
    assert.equal(source.configured, true)
    assert.equal(await source.connected(), true)
    const result = await source.search('абонемент', 5)
    assert.deepEqual(result.errors, [])
    assert.ok(result.findings.some((f) => f.id === 'AB-1'))
    assert.ok(result.findings.some((f) => f.kind === 'confluence'))
    assert.ok(gw.requests.every((r) => r.auth === `Bearer ${TOKEN}`))
    assert.ok(!gw.requests.some((r) => r.method === 'tools/list'), 'tools/list не зовётся')
    const tools = new Set(gw.requests.filter((r) => r.method === 'tools/call').map((r) => r.params.name))
    assert.ok([...tools].every((t) => READ_ONLY_TOOLS.includes(t)))
    const status = await source.status()
    assert.equal(status.connected, true)
    assert.equal(status.label, CONNECTED_LABEL)
    assert.equal('mode' in status, false)
    assert.doesNotMatch(JSON.stringify(status), new RegExp(TOKEN))
    assert.doesNotMatch(JSON.stringify(source), new RegExp(TOKEN))
    assert.equal(typeof source.beginAuth, 'undefined')
    assert.equal(typeof source.disconnect, 'undefined')
  } finally {
    await gw.close()
  }
})

test('токен из окружения DATA_SOURCES_TOKEN_<ID>; без токена — «не настроен»', async () => {
  process.env.DATA_SOURCES_TOKEN_GW_ENV = TOKEN
  try {
    const source = new McpSource('gw-env', 'Шлюз', 'http://127.0.0.1:9/mcp')
    assert.equal(source.configured, true)
    const bare = new McpSource('gw-none', 'Шлюз', 'http://127.0.0.1:9/mcp')
    assert.equal(bare.configured, false)
    assert.equal(await bare.connected(), false)
    const status = await bare.status()
    assert.equal(status.label, 'не настроен')
    await assert.rejects(bare.searchConfluence('x'), /DATA_SOURCES_TOKEN_GW_NONE/)
  } finally {
    delete process.env.DATA_SOURCES_TOKEN_GW_ENV
  }
})

test('401 от шлюза — «перевыпустите токен», без повторов', async () => {
  const gw = await fakeGateway({ reject: true })
  try {
    const source = new McpSource('gw-b', 'Шлюз', gw.url, { serviceToken: TOKEN })
    await assert.rejects(source.searchConfluence('абонемент'), (e) => e.message === SERVICE_REJECTED)
    assert.equal(gw.requests.length, 1)
    assert.ok(gw.requests.every((r) => r.url === '/mcp'))
    const status = await source.status()
    assert.equal(status.error, SERVICE_REJECTED)
    assert.doesNotMatch(JSON.stringify(status), new RegExp(TOKEN))
  } finally {
    await gw.close()
  }
})

test('маршруты: только статус и поиск; «Подключить»/«Отключить» и приёмника входа нет', async () => {
  const gw = await fakeGateway()
  process.env.DATA_SOURCES_TOKEN_GW_ROUTE = TOKEN
  process.env.ADMIN_PASSWORD = 'admin-test'
  const { ctx, routes, effects } = fakeCtx()
  try {
    apply(ctx, { sources: [{ id: 'gw-route', name: 'Шлюз', url: gw.url }] })
    assert.deepEqual([...routes.keys()].sort(), [ROUTE.search, ROUTE.status].sort())
    assert.ok(!routes.has('/api/data-sources.connect'))
    assert.ok(!routes.has('/api/data-sources.disconnect'))
    assert.ok(!effects.some((label) => /приёмник|callback|:30\d\d/.test(label ?? '')))
    const cookie = `portal_admin=${createHmac('sha256', 'admin-test').update('portal-admin-v1').digest('hex')}`
    const call = (path, init = {}) => routes.get(path).fetch(new Request(`http://portal${path}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } }))

    const statusText = await (await call(ROUTE.status)).text()
    assert.doesNotMatch(statusText, new RegExp(TOKEN))
    const body = JSON.parse(statusText)
    assert.equal(body.admin, true)
    assert.equal(body.sources[0].connected, true)

    const searchText = await (await call(ROUTE.search, { method: 'POST', body: JSON.stringify({ query: 'абонемент' }) })).text()
    assert.doesNotMatch(searchText, new RegExp(TOKEN))
    assert.ok(JSON.parse(searchText).findings.length > 0)
  } finally {
    delete process.env.DATA_SOURCES_TOKEN_GW_ROUTE
    delete process.env.ADMIN_PASSWORD
    await gw.close()
  }
})
