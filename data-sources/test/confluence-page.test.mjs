// Чат заказчика (ADR-0019): страница Confluence целиком через шлюз — только confluence_get_page,
// id — только цифры; служба без подключённого источника — исключение (чат говорит «недоступен»).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpSource } from '../lib/sources.js'
import { apply } from '../lib/index.js'

const wrap = (value) => JSON.stringify({ result: JSON.stringify(value) })

test('readConfluencePage: текст и метаданные; неверный id — до сети', async () => {
  const source = new McpSource('test-page', 'Тест', 'http://127.0.0.1:9/mcp')
  const calls = []
  source.call = async (tool, args) => {
    calls.push({ tool, args })
    return wrap({ metadata: { title: 'Регламент заявок', url: 'https://wiki.example.test/pages/viewpage.action?pageId=42', space: { key: 'SRV', name: 'Сервис' }, version: { when: '2026-10-02' } }, content: { value: 'Текст страницы' } })
  }
  const page = await source.readConfluencePage('42')
  assert.deepEqual(page, { id: '42', title: 'Регламент заявок', text: 'Текст страницы', url: 'https://wiki.example.test/pages/viewpage.action?pageId=42', space: 'SRV', spaceName: 'Сервис', updated: '2026-10-02' })
  assert.deepEqual(calls, [{ tool: 'confluence_get_page', args: { page_id: '42', convert_to_markdown: true, include_metadata: true } }])
  await assert.rejects(source.readConfluencePage('42 OR 1=1'), /неверный id/)
  assert.equal(calls.length, 1)
})

test('служба: не настроен — searchConfluence и readConfluencePage бросают; e2eToken без флага e2e-hooks не берётся', async () => {
  const saved = { url: process.env.DATA_SOURCES_URL_ATLASSIAN, token: process.env.DATA_SOURCES_TOKEN_ATLASSIAN, home: process.env.DSH_HOME }
  delete process.env.DATA_SOURCES_URL_ATLASSIAN
  delete process.env.DATA_SOURCES_TOKEN_ATLASSIAN
  process.env.DSH_HOME = '/nonexistent-e2e-home'
  let service
  const ctx = { effect: (fn) => fn(), provide: (name, value) => { if (name === 'dataSources') service = value; return () => {} }, inject() {}, get() {} }
  apply(ctx, { sources: [{ id: 'atlassian', name: 'Тест', url: 'http://127.0.0.1:9/mcp', e2eToken: 'e2e-double' }] })
  assert.equal(await service.available(), false, 'токен из конфига без флага e2e-hooks не действует')
  await assert.rejects(service.searchConfluence('регламент'), /нет подключённых источников/)
  await assert.rejects(service.readConfluencePage('42'), /нет подключённых источников/)
  for (const [key, env] of [['url', 'DATA_SOURCES_URL_ATLASSIAN'], ['token', 'DATA_SOURCES_TOKEN_ATLASSIAN'], ['home', 'DSH_HOME']]) {
    if (saved[key] === undefined) delete process.env[env]; else process.env[env] = saved[key]
  }
})
