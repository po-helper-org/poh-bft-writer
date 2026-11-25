// «Ключи и доступы» (ADR-0030): хранилище (права 600), статус без значений, окружение и сброс,
// маршруты только администратору, значение никогда не возвращается, проверки связи.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyKeys, KEY_SPECS, KeyStore, keyStatuses, specOf, validateKeyValue } from '../lib-test/keys.js'
import { checkGoogleKey, registerKeys } from '../lib-test/keys-routes.js'

const SECRET = 'tok_SuperSecret_0123456789abcdef'

test('реестр: у каждого ключа назначение; редактируемые — только те, что читаются при использовании', () => {
  const names = KEY_SPECS.map((k) => k.name)
  assert.equal(new Set(names).size, names.length)
  for (const k of KEY_SPECS) {
    assert.ok(k.purpose.length > 10, k.name)
    if (!k.editable) assert.ok(k.elsewhere, `${k.name}: где задаётся`)
  }
  assert.ok(specOf('CONFLUENCE_PUBLISH_TOKEN').editable)
  assert.equal(specOf('DATA_SOURCES_TOKEN_ATLASSIAN').editable, false, 'токен шлюза выпускает скрипт шлюза')
  for (const g of ['models', 'sources', 'confluence', 'tracker', 'materials', 'agents', 'access']) assert.ok(KEY_SPECS.some((k) => k.group === g), g)
})

test('хранилище: файл 600, каталог 700; статус — без значения секрета', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'keys-')), 'portal-keys')
  const store = new KeyStore(dir)
  store.set('CONFLUENCE_PUBLISH_TOKEN', SECRET, 'admin', '2026-11-25T10:00:00.000Z')
  store.set('CONFLUENCE_PUBLISH_URL', 'https://wiki.example.test', 'admin', '2026-11-25T10:00:00.000Z')
  assert.equal((await stat(join(dir, 'keys.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(dir)).mode & 0o777, 0o700)
  const statuses = keyStatuses(store.read(), { GOOGLE_DRIVE_API_KEY: 'g-env' })
  assert.ok(!JSON.stringify(statuses).includes(SECRET), 'значение секрета в статусе')
  assert.ok(!JSON.stringify(statuses).includes('g-env'), 'значение секрета из окружения в статусе')
  const tok = statuses.find((k) => k.name === 'CONFLUENCE_PUBLISH_TOKEN')
  assert.deepEqual({ set: tok.set, source: tok.source, changedAt: tok.changedAt, by: tok.by, envSet: tok.envSet }, { set: true, source: 'settings', changedAt: '2026-11-25T10:00:00.000Z', by: 'admin', envSet: false })
  assert.equal(statuses.find((k) => k.name === 'CONFLUENCE_PUBLISH_URL').value, 'https://wiki.example.test', 'адрес — не секрет, показывается')
  const g = statuses.find((k) => k.name === 'GOOGLE_DRIVE_API_KEY')
  assert.equal(g.source, 'env')
  assert.equal(statuses.find((k) => k.name === 'BFT_REVIEW_AGENT_KEY').source, 'none')
  const ext = keyStatuses(store.read(), {}, { BFT_REVIEW_AGENT_KEY: '«Настройки → Портал»' }).find((k) => k.name === 'BFT_REVIEW_AGENT_KEY')
  assert.deepEqual([ext.set, ext.source, ext.where], [true, 'elsewhere', '«Настройки → Портал»'], 'ключ агента из раздела «Портал»')
})

test('окружение процесса: заданное в настройках главнее, сброс возвращает значение окружения', () => {
  const baseline = { GOOGLE_DRIVE_API_KEY: 'from-env', ANTHROPIC_API_KEY: 'a' }
  const env = { ...baseline }
  applyKeys(env, baseline, { GOOGLE_DRIVE_API_KEY: 'from-settings', CONFLUENCE_PUBLISH_TOKEN: 't', ANTHROPIC_API_KEY: 'нельзя' })
  assert.equal(env.GOOGLE_DRIVE_API_KEY, 'from-settings')
  assert.equal(env.CONFLUENCE_PUBLISH_TOKEN, 't')
  assert.equal(env.ANTHROPIC_API_KEY, 'a', 'нередактируемый ключ настройки не меняют')
  applyKeys(env, baseline, {})
  assert.equal(env.GOOGLE_DRIVE_API_KEY, 'from-env')
  assert.equal('CONFLUENCE_PUBLISH_TOKEN' in env, false)
})

test('проверка значения: пустое, пробелы в ключе, адрес не http', () => {
  const tok = specOf('CONFLUENCE_PUBLISH_TOKEN')
  assert.throws(() => validateKeyValue(tok, '  '), /пустое/)
  assert.throws(() => validateKeyValue(tok, 'a b'), /пробелы/)
  assert.equal(validateKeyValue(tok, `  ${SECRET}\n`), SECRET)
  assert.throws(() => validateKeyValue(specOf('CONFLUENCE_PUBLISH_URL'), 'wiki.example.test'), /http/)
})

function routes(admin = true) {
  const handlers = {}
  const register = (route) => { handlers[route.path] = route.fetch; return () => {} }
  return mkdtemp(join(tmpdir(), 'keys-r-')).then((d) => {
    const store = new KeyStore(join(d, 'portal-keys'))
    const env = { GOOGLE_DRIVE_API_KEY: 'env-g' }
    const baseline = { ...env }
    const checked = []
    registerKeys(register, {
      store, baseline, env, isAdmin: () => admin, who: () => 'po-admin', now: () => '2026-11-25T12:00:00.000Z',
      checks: { 'confluence-write': async () => { checked.push(env.CONFLUENCE_PUBLISH_TOKEN === SECRET); return { ok: true, text: 'вход есть: Тестовый' } } },
    })
    const call = (path, body) => handlers[path](new Request(`http://x${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))
    return { call, store, env, checked, dir: d }
  })
}

test('маршруты: только администратору', async () => {
  const { call } = await routes(false)
  assert.equal((await call('/api/customer-form.keys')).status, 403)
  assert.equal((await call('/api/customer-form.keys', { name: 'CONFLUENCE_PUBLISH_TOKEN', value: SECRET })).status, 403)
  assert.equal((await call('/api/customer-form.keysCheck', { name: 'CONFLUENCE_PUBLISH_TOKEN' })).status, 403)
})

test('маршруты: задать → значение не возвращается, действует в окружении; проверка; сброс; чужой ключ — 409', async () => {
  const { call, store, env, checked, dir } = await routes(true)
  const res = await call('/api/customer-form.keys', { name: 'CONFLUENCE_PUBLISH_TOKEN', value: SECRET })
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(!text.includes(SECRET), 'значение ушло обратно в браузер')
  const tok = JSON.parse(text).keys.find((k) => k.name === 'CONFLUENCE_PUBLISH_TOKEN')
  assert.deepEqual([tok.set, tok.source, tok.by], [true, 'settings', 'po-admin'])
  assert.equal(env.CONFLUENCE_PUBLISH_TOKEN, SECRET, 'действует без перезапуска')
  assert.ok((await readFile(join(dir, 'portal-keys', 'keys.json'), 'utf8')).includes(SECRET), 'значение — только в файле 600')

  const checkedView = await (await call('/api/customer-form.keysCheck', { name: 'CONFLUENCE_PUBLISH_TOKEN' })).json()
  assert.deepEqual(checked, [true])
  assert.deepEqual(checkedView.keys.find((k) => k.name === 'CONFLUENCE_PUBLISH_TOKEN').lastCheck, { ok: true, text: 'вход есть: Тестовый', at: '2026-11-25T12:00:00.000Z' })
  assert.equal((await call('/api/customer-form.keysCheck', { name: 'GOOGLE_DRIVE_API_KEY' })).status, 404, 'проверки google в этом наборе нет')

  // Новый ключ снимает старую проверку.
  await call('/api/customer-form.keys', { name: 'CONFLUENCE_PUBLISH_TOKEN', value: `${SECRET}x` })
  assert.equal(store.read().checks?.CONFLUENCE_PUBLISH_TOKEN, undefined)

  const reset = await (await call('/api/customer-form.keys', { name: 'CONFLUENCE_PUBLISH_TOKEN', reset: true })).json()
  assert.equal(reset.keys.find((k) => k.name === 'CONFLUENCE_PUBLISH_TOKEN').source, 'none')
  assert.equal('CONFLUENCE_PUBLISH_TOKEN' in env, false)

  const g = await call('/api/customer-form.keys', { name: 'GOOGLE_DRIVE_API_KEY', value: 'new-g' })
  assert.equal(env.GOOGLE_DRIVE_API_KEY, 'new-g')
  assert.equal((await g.json()).keys.find((k) => k.name === 'GOOGLE_DRIVE_API_KEY').envSet, true)
  await call('/api/customer-form.keys', { name: 'GOOGLE_DRIVE_API_KEY', reset: true })
  assert.equal(env.GOOGLE_DRIVE_API_KEY, 'env-g', '«Вернуть из окружения»')

  const foreign = await call('/api/customer-form.keys', { name: 'DATA_SOURCES_TOKEN_ATLASSIAN', value: 'x' })
  assert.equal(foreign.status, 409)
  assert.match((await foreign.json()).error, /install-sources-gateway/)
  assert.equal((await call('/api/customer-form.keys', { name: 'NOPE', value: 'x' })).status, 404)
  assert.equal((await call('/api/customer-form.keys', { name: 'CONFLUENCE_PUBLISH_TOKEN', value: 'a b' })).status, 400)
})

test('проверка ключа Google: 404 на несуществующий файл — ключ принят, 400 API key not valid — нет', async () => {
  const reply = (status, body = '') => async () => new Response(body, { status })
  assert.equal((await checkGoogleKey('k', reply(404))).ok, true)
  assert.match((await checkGoogleKey('k', reply(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}'))).text, /недействителен/)
  assert.match((await checkGoogleKey('k', reply(403))).text, /не включён/)
  assert.equal((await checkGoogleKey(undefined)).ok, false)
})
