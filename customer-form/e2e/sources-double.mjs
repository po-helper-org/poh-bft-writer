/**
 * Шлюз источников-ДВОЙНИК для E2E (ADR-0015/0019): MCP по Streamable HTTP с
 * теми же инструментами чтения Confluence, что у настоящего шлюза, и
 * вымышленными страницами. Нужен, чтобы поиск документов в чате заказчика
 * проверялся без корпоративного Confluence и токена.
 *
 * Запрос со словом «недоступ» — шлюз «лежит» (503): так проверяется честное
 * «поиск сейчас недоступен». Токен — e2e-double (llm-double.patch.yml).
 *
 *   node e2e/sources-double.mjs          # порт SOURCES_DOUBLE_PORT (8798)
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.SOURCES_DOUBLE_PORT ?? 8798)
const WIKI = 'https://wiki.example.test'
const PAGES = [
  {
    id: '700101', title: 'Регламент заявок на ремонт оборудования', space: { key: 'SRV', name: 'Сервисная служба' }, updated: '2026-10-02',
    text: '## Порядок подачи\n\nЗаявку на ремонт подаёт мастер смены в журнале. Диспетчер назначает исполнителя в течение 2 часов.\n\n## Сроки\n\nСрочный ремонт — в тот же день.',
  },
  {
    id: '700102', title: 'Справочник оборудования цеха', space: { key: 'SRV', name: 'Сервисная служба' }, updated: '2025-04-11',
    text: 'Станки, прессы и конвейеры цеха с инвентарными номерами.',
  },
]
const urlOf = (page) => `${WIKI}/pages/viewpage.action?pageId=${page.id}`
const wrap = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })

function call(name, args) {
  if (name === 'confluence_search') {
    const words = String(args.query ?? '').toLowerCase().split(/\s+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5))
    const found = PAGES.filter((p) => words.some((w) => `${p.title} ${p.text}`.toLowerCase().includes(w)))
    return wrap(found.map((p) => ({ id: p.id, title: p.title, url: urlOf(p), type: 'page', space: p.space, updated: p.updated, content: { value: p.text.slice(0, 120) } })))
  }
  if (name === 'confluence_get_page') {
    const page = PAGES.find((p) => p.id === String(args.page_id))
    if (!page) return { isError: true, content: [{ type: 'text', text: 'page not found' }] }
    return wrap({ metadata: { title: page.title, url: urlOf(page), space: page.space, version: { when: page.updated } }, content: { value: page.text } })
  }
  return { isError: true, content: [{ type: 'text', text: `tool ${name} is not allowed` }] }
}

createServer((req, res) => {
  let raw = ''
  req.on('data', (d) => { raw += d })
  req.on('end', () => {
    if (req.method !== 'POST' || req.headers.authorization !== 'Bearer e2e-double') { res.writeHead(401).end(); return }
    const message = JSON.parse(raw || '{}')
    const reply = (result) => {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'e2e' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
    }
    if (message.method === 'initialize') return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'sources-double', version: '0' } })
    if (message.id === undefined) { res.writeHead(202).end(); return }
    if (message.method !== 'tools/call') return reply({})
    const { name, arguments: args = {} } = message.params ?? {}
    console.log(`[sources-double] ${name} ${JSON.stringify(args)}`)
    if (/недоступ/i.test(String(args.query ?? ''))) { res.writeHead(503, { 'content-type': 'text/plain' }).end('gateway down'); return }
    reply(call(name, args))
  })
}).listen(PORT, '0.0.0.0', () => console.log(`[sources-double] :${PORT}`))
