// Агент полного ревью (ADR-0024): адрес и ключ — из окружения, ответ Responses API → текст; разделы страницы.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { responseText, reviewAgentFromEnv, reviewAgentModel } from '../lib-test/review-agent.js'
import { changedBlocks, docRevOf, pageBlocks, pickBlocks } from '../lib-test/doc-sections.js'
import { mergePortalModels } from '../lib-test/models.js'

test('агент полного ревью: только с адресом и ключом из окружения', () => {
  assert.equal(reviewAgentFromEnv({}), undefined)
  assert.equal(reviewAgentFromEnv({ BFT_REVIEW_AGENT_URL: 'https://h/x', BFT_REVIEW_AGENT_KEY: '' }), undefined)
  assert.equal(reviewAgentFromEnv({ BFT_REVIEW_AGENT_URL: 'ftp://h/x', BFT_REVIEW_AGENT_KEY: 'k' }), undefined)
  assert.deepEqual(reviewAgentFromEnv({ BFT_REVIEW_AGENT_URL: 'https://h/x', BFT_REVIEW_AGENT_KEY: 'k', BFT_REVIEW_AGENT_MODEL: 'm' }), { url: 'https://h/x', key: 'k', model: 'm' })
})

test('ответ Responses API → текст', () => {
  assert.equal(responseText({ output_text: 'готово' }), 'готово')
  assert.equal(responseText({ output: [{ type: 'function_call' }, { type: 'message', content: [{ type: 'output_text', text: 'а' }, { type: 'output_text', text: 'б' }] }] }), 'аб')
  assert.equal(responseText({}), '')
})

test('вызов агента: Bearer, instructions + input, без хранения; ошибка HTTP — с кодом', async () => {
  const seen = []
  const ok = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '@@@ ОТЧЁТ\n[]' }] }] })) }
  let chars = 0
  const text = await reviewAgentModel({ url: 'https://h/review', key: 'секрет' }, ok).complete({ system: 'S', user: 'U' }, AbortSignal.timeout(1000), (n) => { chars = n })
  assert.equal(text, '@@@ ОТЧЁТ\n[]')
  assert.equal(chars, text.length)
  assert.equal(seen[0].url, 'https://h/review')
  assert.equal(seen[0].init.headers.authorization, 'Bearer секрет')
  assert.deepEqual(JSON.parse(seen[0].init.body), { instructions: 'S', input: 'U', store: false })
  const bad = async () => new Response('нет', { status: 401 })
  await assert.rejects(reviewAgentModel({ url: 'https://h', key: 'k' }, bad).complete({ system: '', user: '' }, AbortSignal.timeout(1000), () => {}), /HTTP 401/)
})

const page = (risks, extra = '') => `<html><body><main>\n<h1 id="top">Док</h1><p>шапка</p>\n<h2 id="sec-1">Проблема</h2><p>п</p>\n<details class="fold"><summary><h2 id="sec-2">Служебное</h2></summary><p>с</p></details>\n<h2 id="sec-3">Риски</h2><table><tr><td>${risks}</td></tr></table>${extra}\n<footer>lint ${risks}</footer>\n</main><script>var DOC_REV = "r-${risks}";</script></body></html>`

test('разделы страницы: свёрнутый блок — свой раздел, подвал не входит; изменённое — только изменённое', () => {
  assert.deepEqual(pageBlocks(page('a')).map((b) => b.id), ['', 'sec-1', 'sec-2', 'sec-3'])
  assert.ok(pageBlocks(page('a'))[2].html.startsWith('<details class="fold"><summary><h2 id="sec-2">'))
  assert.deepEqual(changedBlocks(page('a'), page('b')), ['sec-3'])
  assert.deepEqual(changedBlocks(page('a'), page('a')), [])
  assert.equal(changedBlocks(page('a'), page('a', '<h2 id="sec-4">Новый</h2>')), null, 'новый раздел — перезагрузка')
  assert.equal(changedBlocks('<p>без main</p>', page('a')), null)
  assert.deepEqual(pickBlocks(page('b'), ['sec-3', 'nope', '']).map((b) => b.id), ['sec-3'])
  assert.equal(docRevOf(page('b')), 'r-b')
})

test('настройки: локальная модель и полное ревью сохраняются и сбрасываются', () => {
  const next = mergePortalModels({ chat: { provider: 'a', model: 'b' } }, { local: { provider: 'requesty', model: 'h' }, review: { provider: 'review-agent', model: 'agent' } })
  assert.deepEqual(next, { chat: { provider: 'a', model: 'b' }, local: { provider: 'requesty', model: 'h' }, review: { provider: 'review-agent', model: 'agent' } })
  assert.deepEqual(mergePortalModels(next, { local: null }), { chat: { provider: 'a', model: 'b' }, review: { provider: 'review-agent', model: 'agent' } })
})

test('подключение к шлюзу агентов из настроек: ключ только на запись, null — отключить, без ключа — ошибка', async () => {
  const { reviewAgentFrom } = await import('../lib-test/review-agent.js')
  const set = mergePortalModels({}, { agent: { url: 'http://gw/p/x/v1/responses', key: 'k1', model: '' } })
  assert.deepEqual(set.agent, { url: 'http://gw/p/x/v1/responses', key: 'k1' })
  const kept = mergePortalModels(set, { agent: { url: 'http://gw/p/y/v1/responses', key: '', model: 'm' } })
  assert.deepEqual(kept.agent, { url: 'http://gw/p/y/v1/responses', key: 'k1', model: 'm' }, 'пустой ключ — прежний')
  assert.equal(mergePortalModels(kept, { agent: null }).agent, undefined)
  assert.throws(() => mergePortalModels({}, { agent: { url: 'http://gw', key: '' } }), /нужен адрес/)
  assert.throws(() => mergePortalModels({}, { agent: { url: 'ftp://gw', key: 'k' } }), /нужен адрес/)
  assert.equal(reviewAgentFrom(kept, {}).source, 'settings')
  assert.equal(reviewAgentFrom({}, { BFT_REVIEW_AGENT_URL: 'http://e/v1/responses', BFT_REVIEW_AGENT_KEY: 'k' }).source, 'env')
  assert.equal(reviewAgentFrom({}, {}), undefined)
})

test('вход администратора с ?to=settings — сразу «Настройки → Портал»', async () => {
  const { afterLogin } = await import('../lib-test/admin.js')
  assert.equal(afterLogin(new Request('http://p/bft/api/customer-form.admin?to=settings')), '../?settings=portal')
  assert.equal(afterLogin(new Request('http://p/bft/api/customer-form.admin')), '../')
})
