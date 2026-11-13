// Разбор находок Jira/Confluence из ответов MCP штаба и карта для полного БФТ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { confluenceFindings, findingsMarkdown, jiraFindings, jqlFor, merge, unwrap } from '../lib/findings.js'
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

test('JQL: кавычки в запросе не ломают выражение', () => {
  assert.equal(jqlFor('план "отпусков"'), 'text ~ "план отпусков" ORDER BY updated DESC')
})

test('карта находок: якоря CF-n/JR-n и ссылки', () => {
  const findings = merge([...confluenceFindings(wrap(CF), 'q'), ...jiraFindings(wrap(JR), 'q')])
  const md = findingsMarkdown(findings, { source: 'MTS PO штаб', queries: ['q'], at: '2026-11-13 09:00' })
  assert.match(md, /## \[JR-1\] Заявление на отпуск в портале/)
  assert.match(md, /## \[CF-1\] Интеграция с КЕДО/)
  assert.match(md, /https:\/\/jira\.example\/browse\/HREDF-2/)
  assert.match(findingsMarkdown([], { source: 'S', queries: ['x'], at: '' }), /Ничего не найдено/)
})

test('MCP: ответ из потока событий и текст инструмента', () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"ok"}]}}\n\n'
  const message = parseRpcBody('text/event-stream', sse, 3)
  assert.equal(toolText(message.result), 'ok')
  assert.throws(() => toolText({ isError: true, content: [{ type: 'text', text: 'нет доступа' }] }), /нет доступа/)
})
