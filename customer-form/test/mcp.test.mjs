// MCP «Система БФТ» (ADR-0023): токены, пользователи, кука входа, протокол и схемы инструментов.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpTokens, Users, sessionCookie, sessionLogin, whoIs, authMode } from '../lib-test/access.js'
import { mcpHandler } from '../lib-test/mcp-server.js'
import { jsonSchema } from '../lib-test/mcp-bft.js'
import { FAST_PARAMS } from '../lib-test/request-flow.js'

const dir = mkdtempSync(join(tmpdir(), 'bft-mcp-'))

test('токен: показывается один раз, на томе — только отпечаток; отзыв гасит доступ', () => {
  const store = new McpTokens(() => join(dir, 'tokens.json'))
  const out = store.issue('ivanov', 'Claude Code')
  assert.match(out.token, /^bftmcp_[A-Za-z0-9_-]{43}$/)
  assert.equal(store.verify(`Bearer ${out.token}`), 'ivanov')
  assert.equal(store.verify('Bearer bftmcp_' + 'x'.repeat(43)), undefined)
  assert.equal(store.verify(undefined), undefined)
  const views = store.list('ivanov')
  assert.equal(views.length, 1)
  assert.ok(!('hash' in views[0]))
  assert.ok(views[0].lastUsedAt)
  assert.deepEqual(store.list('petrov'), [])
  assert.equal(store.revoke('petrov', views[0].id), false, 'чужой токен не отозвать')
  assert.equal(store.revoke('ivanov', views[0].id), true)
  assert.equal(store.verify(`Bearer ${out.token}`), undefined)
})

test('не больше десяти действующих токенов на человека', () => {
  const store = new McpTokens(() => join(dir, 'tokens-limit.json'))
  for (let i = 0; i < 10; i++) assert.ok('token' in store.issue('a', `t${i}`))
  assert.ok('error' in store.issue('a', 'лишний'))
})

test('пользователи: пароль scrypt, отключённый не входит, логин и длина проверяются', () => {
  const users = new Users(() => join(dir, 'users.json'))
  assert.match(users.save('Ivan', 'Иван', 'короткий'), /не короче 10/)
  assert.match(users.save('я', 'x', 'длинный-пароль-1'), /логин/)
  assert.equal(users.save('ivan.p', 'Иван', 'длинный-пароль-1'), undefined)
  assert.equal(users.verify('IVAN.P', 'длинный-пароль-1')?.login, 'ivan.p')
  assert.equal(users.verify('ivan.p', 'другой-пароль-2'), undefined)
  assert.ok(!JSON.stringify(users.list()).includes('scrypt'))
  users.setDisabled('ivan.p', true)
  assert.equal(users.verify('ivan.p', 'длинный-пароль-1'), undefined)
  assert.equal(users.active('ivan.p'), false)
})

test('кука входа подписана и истекает; whoIs: sso — заголовок Authentik, local — кука действующего', () => {
  const key = Buffer.alloc(32, 7)
  const cookie = sessionCookie('ivan.p', 1000, key)
  assert.equal(sessionLogin(cookie, 2000, key), 'ivan.p')
  assert.equal(sessionLogin(cookie, 1000 + 13 * 3600_000, key), undefined, 'истекла')
  assert.equal(sessionLogin(cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 2000, key), undefined, 'подпись')
  const users = new Users(() => join(dir, 'users.json'))
  const sso = new Request('http://x/', { headers: { 'x-authentik-username': 'akadmin' } })
  assert.equal(whoIs(sso, users, 'sso'), 'akadmin')
  assert.equal(whoIs(sso, users, 'local'), undefined, 'в коробке заголовку не верим')
  assert.equal(authMode({ PORTAL_AUTH: 'sso' }), 'sso')
  assert.equal(authMode({}), 'local')
})

const spec = {
  name: 'bft-system', version: '1', instructions: 'цикл',
  authenticate: (r) => (r.headers.get('authorization') === 'Bearer ok' ? 'ivanov' : undefined),
  tools: [
    { name: 'echo', description: 'эхо', inputSchema: { type: 'object' }, call: async (args, caller) => `${caller.user}:${args.text}` },
    { name: 'boom', description: 'ошибка', inputSchema: { type: 'object' }, call: async () => { throw new Error('исправь поле') } },
  ],
  prompts: [{ name: 'guide', description: 'путеводитель', get: async (a) => `идея: ${a.idea ?? '-'}` }],
  resources: [{ uri: 'bft://guide', name: 'g', description: 'd', mimeType: 'text/markdown', read: async () => '# G' }],
}
const call = (body, auth = 'Bearer ok') => mcpHandler(spec)(new Request('http://x/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }))

test('MCP: без токена — 401 и WWW-Authenticate; initialize, инструменты, промты, ресурсы', async () => {
  const denied = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, '')
  assert.equal(denied.status, 401)
  assert.match(denied.headers.get('www-authenticate'), /Bearer/)
  const init = await (await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).json()
  assert.equal(init.result.protocolVersion, '2025-03-26')
  assert.equal(init.result.instructions, 'цикл')
  assert.ok(init.result.capabilities.tools)
  assert.equal((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202)
  const list = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
  assert.deepEqual(list.result.tools.map((t) => t.name), ['echo', 'boom'])
  const ok = await (await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'привет' } } })).json()
  assert.deepEqual(ok.result, { content: [{ type: 'text', text: 'ivanov:привет' }], isError: false })
  const bad = await (await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'boom', arguments: {} } })).json()
  assert.equal(bad.result.isError, true)
  assert.equal(bad.result.content[0].text, 'исправь поле')
  const prompt = await (await call({ jsonrpc: '2.0', id: 5, method: 'prompts/get', params: { name: 'guide', arguments: { idea: 'отчёт' } } })).json()
  assert.equal(prompt.result.messages[0].content.text, 'идея: отчёт')
  const res = await (await call({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'bft://guide' } })).json()
  assert.equal(res.result.contents[0].text, '# G')
  const batch = await (await call([{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', id: 8, method: 'nope' }])).json()
  assert.deepEqual(batch[0], { jsonrpc: '2.0', id: 7, result: {} })
  assert.equal(batch[1].error.code, -32601)
})

test('схема брифа чата → JSON Schema: обязательные поля, вложенные объекты, без своих флагов', () => {
  const schema = jsonSchema({ properties: FAST_PARAMS })
  assert.equal(schema.type, 'object')
  assert.ok(schema.required.includes('title') && schema.required.includes('requirements'))
  assert.equal(schema.properties.want.type, 'object')
  assert.ok(schema.properties.want.required.includes('quote'))
  assert.equal(schema.properties.requirements.items.type, 'object')
  assert.ok(!JSON.stringify(schema).includes('"required":true'))
})
