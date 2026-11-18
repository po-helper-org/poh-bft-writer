// Служебный токен моста Hermes (DATA_SOURCES_TOKEN_<ID>): без OAuth, статус «service»,
// подключение/отключение отклоняются, 401 — понятная ошибка без попытки обновления,
// токен не попадает ни в один ответ API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { McpSource, serviceTokenEnv, SERVICE_REJECTED } from '../lib/sources.js'
import { apply } from '../lib/index.js'

const TOKEN = 'svc-test-token-not-a-secret-0123456789'

/** Подставной MCP: пускает только Bearer TOKEN (или отвечает 401 всем). */
async function fakeBridge({ reject = false } = {}) {
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

test('имя переменной: po-hq → DATA_SOURCES_TOKEN_PO_HQ', () => {
  assert.equal(serviceTokenEnv('po-hq'), 'DATA_SOURCES_TOKEN_PO_HQ')
  assert.equal(serviceTokenEnv('a.b c'), 'DATA_SOURCES_TOKEN_A_B_C')
})

test('служебный токен: поиск без OAuth, статус service, токен не в статусе', async () => {
  const bridge = await fakeBridge()
  try {
    const source = new McpSource('svc-a', 'Штаб', bridge.url, 'staff', { serviceToken: TOKEN })
    assert.equal(source.mode, 'service')
    assert.equal(await source.connected(), true)
    const result = await source.search('абонемент', 5)
    assert.deepEqual(result.errors, [])
    assert.ok(result.findings.some((f) => f.id === 'AB-1'))
    assert.ok(result.findings.some((f) => f.kind === 'confluence'))
    assert.ok(bridge.requests.every((r) => r.auth === `Bearer ${TOKEN}`))
    // Только инструменты чтения.
    const tools = new Set(bridge.requests.filter((r) => r.method === 'tools/call').map((r) => r.params.name))
    assert.ok([...tools].every((t) => ['jira_search', 'jira_get_issue', 'confluence_search', 'confluence_get_page'].includes(t)))
    const status = await source.status()
    assert.equal(status.mode, 'service')
    assert.equal(status.connected, true)
    assert.match(status.label, /служебным токеном Hermes/)
    assert.doesNotMatch(JSON.stringify(status), new RegExp(TOKEN))
    await assert.rejects(source.beginAuth('http://127.0.0.1:1/callback'), /служебным токеном/)
    await assert.rejects(source.disconnect(), /служебным токеном/)
  } finally {
    await bridge.close()
  }
})

test('служебный токен из окружения DATA_SOURCES_TOKEN_<ID>', async () => {
  process.env.DATA_SOURCES_TOKEN_SVC_ENV = TOKEN
  try {
    const source = new McpSource('svc-env', 'Штаб', 'http://127.0.0.1:9/mcp')
    assert.equal(source.mode, 'service')
    const plain = new McpSource('svc-none', 'Штаб', 'http://127.0.0.1:9/mcp')
    assert.equal(plain.mode, 'oauth')
    assert.equal((await plain.status()).mode, 'oauth')
  } finally {
    delete process.env.DATA_SOURCES_TOKEN_SVC_ENV
  }
})

test('401 от моста — «выпустите новый», без повторов и обновления', async () => {
  const bridge = await fakeBridge({ reject: true })
  try {
    const source = new McpSource('svc-b', 'Штаб', bridge.url, 'staff', { serviceToken: TOKEN })
    await assert.rejects(source.searchConfluence('абонемент'), (e) => e.message === SERVICE_REJECTED)
    // Один запрос initialize — ни повтора, ни обращения к выдаче токенов.
    assert.equal(bridge.requests.length, 1)
    assert.ok(bridge.requests.every((r) => r.url === '/mcp'))
    const status = await source.status()
    assert.equal(status.error, SERVICE_REJECTED)
    assert.equal(status.connected, true)
    assert.doesNotMatch(JSON.stringify(status), new RegExp(TOKEN))
  } finally {
    await bridge.close()
  }
})

test('маршруты: статус без токена, «Подключить»/«Отключить» отклоняются, приёмник входа не поднимается', async () => {
  const bridge = await fakeBridge()
  process.env.DATA_SOURCES_TOKEN_SVC_ROUTE = TOKEN
  process.env.ADMIN_PASSWORD = 'admin-test'
  const routes = new Map()
  const effects = []
  const ctx = {
    get: (name) => (name === 'connection' ? { fetch: { register: (route) => { routes.set(route.path, route); return () => {} } } } : undefined),
    effect: (fn, label) => { effects.push(label); fn() },
    inject: (_names, applyScoped) => applyScoped(ctx),
    provide: () => () => {},
  }
  try {
    apply(ctx, { sources: [{ id: 'svc-route', name: 'Штаб', url: bridge.url }] })
    assert.ok(!effects.some((label) => /приёмник входа/.test(label)))
    const { createHmac } = await import('node:crypto')
    const cookie = `portal_admin=${createHmac('sha256', 'admin-test').update('portal-admin-v1').digest('hex')}`
    const call = (path, init = {}) => routes.get(path.split('?')[0]).fetch(new Request(`http://portal${path}`, { ...init, headers: { cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } }))

    const status = await call('/api/data-sources.status')
    const statusText = await status.text()
    assert.doesNotMatch(statusText, new RegExp(TOKEN))
    const body = JSON.parse(statusText)
    assert.equal(body.sources[0].mode, 'service')
    assert.equal(body.sources[0].connected, true)

    const connect = await call('/api/data-sources.connect?source=svc-route')
    assert.notEqual(connect.status, 302)
    assert.match(await connect.text(), /служебным токеном Hermes/)

    const disconnect = await call('/api/data-sources.disconnect', { method: 'POST', body: JSON.stringify({ source: 'svc-route' }) })
    assert.equal(disconnect.status, 409)
    const disconnectText = await disconnect.text()
    assert.doesNotMatch(disconnectText, new RegExp(TOKEN))
    assert.match(disconnectText, /служебным токеном/)

    const search = await call('/api/data-sources.search', { method: 'POST', body: JSON.stringify({ query: 'абонемент' }) })
    const searchText = await search.text()
    assert.doesNotMatch(searchText, new RegExp(TOKEN))
    assert.ok(JSON.parse(searchText).findings.length > 0)
  } finally {
    delete process.env.DATA_SOURCES_TOKEN_SVC_ROUTE
    delete process.env.ADMIN_PASSWORD
    await bridge.close()
  }
})
