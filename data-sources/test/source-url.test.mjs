// Адрес источника: из конфига или DATA_SOURCES_URL_<ID>; не задан — «не настроен»,
// без обращений к сети и без падения.
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

test('имя переменной адреса: po-hq → DATA_SOURCES_URL_PO_HQ', () => {
  assert.equal(sourceUrlEnv('po-hq'), 'DATA_SOURCES_URL_PO_HQ')
})

test('адрес не задан — «не настроен», не подключён, служебный токен не помогает', async () => {
  const source = new McpSource('url-none', 'Шлюз', '', 'staff', { serviceToken: 'svc' })
  const status = await source.status()
  assert.equal(status.configured, false)
  assert.equal(status.connected, false)
  assert.equal(status.label, NOT_CONFIGURED_LABEL)
  assert.equal(await source.connected(), false)
  await assert.rejects(source.beginAuth('http://127.0.0.1:1/callback'), /DATA_SOURCES_URL_URL_NONE/)
})

test('источник по умолчанию: адрес из DATA_SOURCES_URL_PO_HQ, без него — «не настроен»', async () => {
  delete process.env.DATA_SOURCES_URL_PO_HQ
  delete process.env.DATA_SOURCES_TOKEN_PO_HQ
  const bare = fakeCtx()
  apply(bare.ctx)
  const [none] = await bare.service().status()
  assert.equal(none.id, 'po-hq')
  assert.equal(none.configured, false)
  assert.equal(none.label, 'не настроен')
  assert.equal(await bare.service().available(), false)
  assert.equal(await bare.service().recon(['q']), undefined)
  assert.ok(!bare.effects.some((label) => /приёмник входа/.test(label)))

  process.env.DATA_SOURCES_URL_PO_HQ = 'http://127.0.0.1:9/mcp'
  process.env.DATA_SOURCES_TOKEN_PO_HQ = 'svc'
  try {
    const set = fakeCtx()
    apply(set.ctx)
    const [source] = await set.service().status()
    assert.equal(source.url, 'http://127.0.0.1:9/mcp')
    assert.equal(source.configured, true)
    assert.equal(source.mode, 'service')
  } finally {
    delete process.env.DATA_SOURCES_URL_PO_HQ
    delete process.env.DATA_SOURCES_TOKEN_PO_HQ
  }
})
