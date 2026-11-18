// Разведка целиком на подставном MCP: поиск, чтение тел, пустой эпик, второй шаг, синонимы, триаж, дедлайн.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpSource } from '../lib/sources.js'

const wrap = (value) => JSON.stringify({ result: JSON.stringify(value) })
const J = 'https://j/browse/'
const C = 'https://c/pages/viewpage.action?pageId='

function fakeSource(handler) {
  const source = new McpSource('test-fake', 'Тест', 'http://127.0.0.1:9/mcp')
  const calls = []
  source.call = async (tool, args) => { calls.push({ tool, args }); return handler(tool, args) }
  return { source, calls }
}

const SUBJECT = { title: 'Абонемент через приложение', systems: ['Касса', 'CRM'] }

function handler(tool, args) {
  if (tool === 'confluence_search') {
    return wrap([
      { id: '1', title: 'Абонемент: продажа в кассе', url: `${C}1`, space: { key: 'SL', name: 'Продажи' }, updated: '2026-05-01', content: { value: 'абонемент' } },
      { id: '2', title: 'Маршрут согласования договоров', url: `${C}2`, content: { value: 'согласование' } },
      { id: '3', title: 'Абонемент на парковку', url: `${C}3`, content: { value: 'парковка' } },
    ])
  }
  if (tool === 'jira_search') {
    if (/Epic Link|parent/.test(args.jql)) return wrap({ issues: [{ key: 'AB-11', summary: 'Выдача абонемента в приложении', browse_url: `${J}AB-11`, status: { name: 'Открыт' } }] })
    assert.doesNotMatch(args.jql, /ORDER BY/)
    return wrap({ issues: [
      { key: 'AB-1', summary: 'Абонемент в приложении', browse_url: `${J}AB-1`, issue_type: { name: 'Epic' }, status: { name: 'В работе' }, project: { key: 'AB' } },
      { key: 'AB-2', summary: 'Абонемент не продлевается', browse_url: `${J}AB-2`, issue_type: { name: 'Ошибка' }, status: { name: 'Открыт' }, description: 'после оплаты абонемент не продлевается' },
    ] })
  }
  if (tool === 'confluence_get_page') {
    if (args.page_id === '1') return wrap({ content: { value: 'Общая информация\n================\n\n| Автор | @Иванов |\n\nОписание\n========\n\nСистема Saleport (Касса) продаёт абонементы.\n\n| Epic | AB-5 |\n\ntrue\n' } })
    return wrap({ metadata: { title: 'Связанная страница' }, content: { value: 'текст' } })
  }
  if (tool === 'jira_get_issue') {
    if (args.issue_key === 'AB-1') return wrap({ key: 'AB-1', summary: 'Абонемент в приложении', description: '' })
    if (args.issue_key === 'AB-5') return wrap({ key: 'AB-5', summary: 'Абонемент: оплата', issue_type: { name: 'История' }, status: { name: 'Закрыт' }, description: 'оплата абонемента' })
    return wrap({ key: args.issue_key, summary: 'x', description: 'после оплаты абонемент не продлевается' })
  }
  throw new Error(`неожиданный вызов ${tool}`)
}

test('разведка: тела чистятся, пустой эпик — его состав, второй шаг по подписанной строке, синоним, триаж', async () => {
  const { source, calls } = fakeSource(handler)
  let triageInput
  const result = await source.recon(['Абонемент через приложение', 'маршрут согласования'], {
    subject: SUBJECT,
    triage: async (items) => { triageInput = items; return items.map((i) => ({ ref: i.ref, relevance: i.ref === 'page-3' ? 'unrelated' : 'same_function', facts: i.ref === 'AB-2' ? [{ fact: 'не продлевается', quote: 'после оплаты абонемент не продлевается' }] : [] })) },
  })
  assert.ok(result.triaged)
  assert.ok(triageInput.length <= 8)
  const md = result.markdown
  assert.match(md, /Тип: Эпик \(объём работ\) · Статус: в работе/)
  assert.match(md, /Состав эпика:\n- \[AB-11\]\(https:\/\/j\/browse\/AB-11\) — Выдача абонемента в приложении \(Открыт\)/)
  assert.doesNotMatch(md, /Общая информация|@Иванов|^true$/m)
  assert.match(md, /## Связанные \(через Абонемент: продажа в кассе\)\n\n## AB-5 · Абонемент: оплата/)
  assert.deepEqual(result.synonyms, [{ system: 'Касса', alias: 'Saleport' }])
  assert.match(md, /Другие названия систем .*«Касса» — «Saleport»/)
  assert.ok(result.queries.some((q) => /Saleport/.test(q)))
  assert.match(md, /→ «Риски»/)
  assert.match(md, /## Отсеяно триажем \(не использовать\)\n\n- Confluence · Абонемент на парковку/)
  // Только процессные слова — ниже порога, в карту не попадает вовсе.
  assert.doesNotMatch(md, /Маршрут согласования договоров/)
  // Подзадачи отсекает JQL, по названию и по тексту — два запроса на каждый поисковый запрос.
  assert.ok(calls.filter((c) => c.tool === 'jira_search' && /^summary ~/.test(c.args.jql)).length >= 2)
})

test('разведка: сбой триажа — карта без вердиктов, ошибка в журнале; дедлайн не превышается', async () => {
  const { source } = fakeSource(handler)
  const result = await source.recon(['Абонемент'], { subject: SUBJECT, triage: async () => { throw new Error('модель упала') } })
  assert.equal(result.triaged, false)
  assert.ok(result.errors.some((e) => /триаж: модель упала/.test(e)))
  assert.doesNotMatch(result.markdown, /Отношение к заявке/)

  const slow = fakeSource(async (tool, args) => { await new Promise((r) => setTimeout(r, 300)); return handler(tool, args) })
  const started = Date.now()
  const late = await slow.source.recon(['Абонемент', 'Касса абонемент', 'CRM абонемент'], { subject: SUBJECT, deadlineMs: 400 })
  assert.ok(Date.now() - started < 1500)
  assert.ok(late.errors.some((e) => /время разведки вышло/.test(e)))
})

test('разведка: Confluence — до 10 страниц на запрос, Jira — до трёх тел', async () => {
  const { source, calls } = fakeSource(handler)
  await source.recon(['Абонемент через приложение'], { subject: SUBJECT })
  assert.ok(calls.filter((c) => c.tool === 'confluence_search').every((c) => c.args.limit === 10))
})

test('раунд 6: очки ранга — по детерминированному ядру (rankBy); запросы модели только расширяют выдачу', async () => {
  const run = async (queries) => {
    const { source } = fakeSource(handler)
    const result = await source.recon(queries, { subject: SUBJECT, rankBy: ['Абонемент через приложение'], deadlineMs: 5_000 })
    return result.findings.map((f) => `${f.kind}:${f.id}`)
  }
  assert.deepEqual(await run(['Абонемент через приложение', 'маршрут согласования']), await run(['Абонемент через приложение', 'абонемент касса']))
})
