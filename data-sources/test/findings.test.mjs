// Разбор находок Jira/Confluence из ответов MCP штаба и карта для полного БФТ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confluenceFindings, findingsMarkdown, jiraBrowseBase, jiraFindings, jqlFor, linkKeys, merge, rank, stems, unwrap } from '../lib/findings.js'
import { parseRpcBody, toolText } from '../lib/mcp.js'

const wrap = (value) => JSON.stringify({ result: JSON.stringify(value) })

const CF = [
  { id: '1362734601', title: 'Интеграция с КЕДО', type: 'page', updated: '2025-07-01 17:35:14 MSK', url: 'https://confluence.example/pages/viewpage.action?pageId=1362734601', space: { key: 'ELEMENT' }, content: { value: 'формирования @@@hl@@@заявления@@@endhl@@@ на отпуск' } },
]
const JR = { total: 2, issues: [
  { key: 'HREDF-1', summary: 'Ошибка в модалке', browse_url: 'https://jira.example/browse/HREDF-1', description: 'h3. Шаги\r\n!a.png|thumbnail!', status: { name: 'Закрыт' }, issue_type: { name: 'Ошибка' }, project: { key: 'HREDF' }, updated: '2026-11-12 10:52:58 MSK' },
  { key: 'HREDF-2', summary: 'Заявление на отпуск в портале', browse_url: 'https://jira.example/browse/HREDF-2', status: { name: 'В работе' }, issue_type: { name: 'Эпик' }, project: { key: 'HREDF' }, updated: '2026-10-01 10:00:00 MSK' },
] }

test('ответ штаба разворачивается из {"result": "<json>"} и без обёртки', () => {
  assert.deepEqual(unwrap(wrap([1])), [1])
  assert.deepEqual(unwrap(JSON.stringify([2])), [2])
})

test('Confluence: страница, пространство, выдержка без подсветки', () => {
  const [page] = confluenceFindings(wrap(CF), 'заявление на отпуск')
  assert.equal(page.kind, 'confluence')
  assert.equal(page.container, 'ELEMENT')
  assert.equal(page.snippet, 'формирования заявления на отпуск')
  assert.deepEqual(page.queries, ['заявление на отпуск'])
})

test('Jira: эпик выше ошибки, повторная находка копит hits и запросы', () => {
  const merged = merge([...jiraFindings(wrap(JR), 'отпуск'), ...jiraFindings(wrap(JR), 'заявление')])
  assert.equal(merged[0].id, 'HREDF-2')
  assert.equal(merged[0].hits, 2)
  assert.deepEqual(merged[0].queries, ['отпуск', 'заявление'])
  assert.equal(merged[1].snippet, 'Шаги')
})

test('ранжирование: без совпадений и инциденты — вон, Confluence и Jira поровну', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'A-1', summary: 'Работы, напрямую не связанные с работой', browse_url: 'u1', issue_type: { name: 'Задача' } },
    { key: 'A-2', summary: 'FW: заявление на отпуск не уходит', browse_url: 'u2', issue_type: { name: 'INC (Remedy)' } },
    { key: 'A-3', summary: 'Переключение графика отпусков на КЭДО', browse_url: 'u3', issue_type: { name: 'Epic' } },
    { key: 'A-4', summary: 'Отпуска в портале: заявление', browse_url: 'u4', issue_type: { name: 'История' } },
  ] }), 'заявление на отпуск')
  const pages = confluenceFindings(wrap([
    { id: '1', title: 'Процесс согласования заявления на отпуск', url: 'c1', content: { value: '' } },
    { id: '2', title: 'Интеграция с КЕДО', url: 'c2', content: { value: 'заявления на отпуск' } },
  ]), 'заявление на отпуск')
  const ranked = rank([...jira, ...pages], ['заявление на отпуск', 'КЭДО отпуск'], 2)
  assert.deepEqual(ranked.map((f) => f.id).sort(), ['1', '2', 'A-3', 'A-4'])
  assert.deepEqual(stems(['Заявление на отпуск']), ['заявл', 'отпус'])
})

test('ранжирование: эпик с одним словом запроса выше бага с двумя', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'B-1', summary: 'Не формируется документ в модалке подписи заявления на отпуск', browse_url: 'b1', issue_type: { name: 'Ошибка' } },
    { key: 'E-1', summary: 'Переключение графика отпусков на КЭДО', browse_url: 'e1', issue_type: { name: 'Epic' } },
  ] }), 'заявление на отпуск')
  assert.deepEqual(rank(jira, ['заявление на отпуск']).map((f) => f.id), ['E-1', 'B-1'])
})

test('ключи задач в тексте находок — ссылками, уже оформленные не трогаем', () => {
  const base = jiraBrowseBase(jiraFindings(wrap(JR), 'q'))
  assert.equal(base, 'https://jira.example/browse/')
  assert.equal(linkKeys('см. ELEMENT-3301 и [HREDF-1](u)', base), 'см. [ELEMENT-3301](https://jira.example/browse/ELEMENT-3301) и [HREDF-1](u)')
  assert.equal(linkKeys('ELEMENT-3301', undefined), 'ELEMENT-3301')
})

test('JQL: кавычки в запросе не ломают выражение', () => {
  assert.equal(jqlFor('план "отпусков"'), 'text ~ "план отпусков" ORDER BY updated DESC')
})

test('карта находок: готовые markdown-ссылки для БФТ, без голых ключей', () => {
  const findings = merge([...confluenceFindings(wrap(CF), 'q'), ...jiraFindings(wrap(JR), 'q')])
  const md = findingsMarkdown(findings, { source: 'MTS PO штаб', queries: ['q'], at: '2026-11-13 09:00' })
  assert.match(md, /## HREDF-2 · Заявление на отпуск в портале/)
  assert.match(md, /Ссылка для БФТ: \[Jira HREDF-2\]\(https:\/\/jira\.example\/browse\/HREDF-2\)/)
  assert.match(md, /Ссылка для БФТ: \[Confluence: Интеграция с КЕДО\]\(https:\/\/confluence\.example\/pages\/viewpage\.action\?pageId=1362734601\)/)
  assert.doesNotMatch(md, /\[(CF|JR)-\d+\]/)
  assert.match(findingsMarkdown([], { source: 'S', queries: ['x'], at: '' }), /Ничего не найдено/)
})

test('MCP: ответ из потока событий и текст инструмента', () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"ok"}]}}\n\n'
  const message = parseRpcBody('text/event-stream', sse, 3)
  assert.equal(toolText(message.result), 'ok')
  assert.throws(() => toolText({ isError: true, content: [{ type: 'text', text: 'нет доступа' }] }), /нет доступа/)
})
