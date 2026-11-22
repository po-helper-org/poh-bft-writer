// Адрес источника: из конфига или DATA_SOURCES_URL_<ID>; нет адреса или токена —
// «не настроен», без обращений к сети и без падения.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpSource, sourceUrlEnv, NOT_CONFIGURED_LABEL } from '../lib/sources.js'
import { apply } from '../lib/index.js'

function fakeCtx() {
  const routes = new Map()
  const effects = []
  let provided
  const ctx = {
    get: (name) => (name === 'connection' ? { fetch: { register: (route) => { routes.set(route.path, route); return () => {} } } } : undefined),
    effect: (fn, label) => { effects.push(label); fn() },
    inject: (_names, applyScoped) => applyScoped(ctx),
    provide: (name, value) => { if (name === 'dataSources') provided = value; return () => {} },
  }
  return { ctx, routes, effects, service: () => provided }
}

test('имя переменной адреса: atlassian → DATA_SOURCES_URL_ATLASSIAN', () => {
  assert.equal(sourceUrlEnv('atlassian'), 'DATA_SOURCES_URL_ATLASSIAN')
})

test('адрес не задан — «не настроен», не подключён, токен не помогает', async () => {
  const source = new McpSource('url-none', 'Шлюз', '', { serviceToken: 'svc' })
  const status = await source.status()
  assert.equal(status.configured, false)
  assert.equal(status.connected, false)
  assert.equal(status.label, NOT_CONFIGURED_LABEL)
  assert.equal(await source.connected(), false)
  await assert.rejects(source.searchJira('q'), /DATA_SOURCES_URL_URL_NONE/)
})

test('источник по умолчанию: адрес и токен из окружения, без них — «не настроен»', async () => {
  delete process.env.DATA_SOURCES_URL_ATLASSIAN
  delete process.env.DATA_SOURCES_TOKEN_ATLASSIAN
  const bare = fakeCtx()
  apply(bare.ctx)
  const [none] = await bare.service().status()
  assert.equal(none.id, 'atlassian')
  assert.equal(none.name, 'Jira и Confluence (только чтение)')
  assert.equal(none.configured, false)
  assert.equal(none.label, 'не настроен')
  assert.equal(await bare.service().available(), false)
  assert.equal(await bare.service().recon(['q']), undefined)

  // Адрес без токена — всё ещё «не настроен».
  process.env.DATA_SOURCES_URL_ATLASSIAN = 'http://127.0.0.1:9/mcp'
  try {
    const urlOnly = fakeCtx()
    apply(urlOnly.ctx)
    const [source] = await urlOnly.service().status()
    assert.equal(source.configured, false)
    assert.equal(source.url, 'http://127.0.0.1:9/mcp')

    process.env.DATA_SOURCES_TOKEN_ATLASSIAN = 'svc'
    const set = fakeCtx()
    apply(set.ctx)
    const [ready] = await set.service().status()
    assert.equal(ready.url, 'http://127.0.0.1:9/mcp')
    assert.equal(ready.configured, true)
    assert.equal(ready.connected, true)
    assert.doesNotMatch(JSON.stringify(ready), /svc/)
  } finally {
    delete process.env.DATA_SOURCES_URL_ATLASSIAN
    delete process.env.DATA_SOURCES_TOKEN_ATLASSIAN
  }
})
