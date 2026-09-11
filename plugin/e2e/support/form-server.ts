/**
 * Демонстрационная форма сбора инициативы для прогона сценария 6.
 *
 * Локальный HTTP-сервер вместо настоящей Google Forms: прогон не зависит от сети и от
 * того, разрешает ли конкретная форма встраивание, а на скриншотах плейбука — узнаваемая
 * заявка, а не чужая страница. Слушает `127.0.0.1` на случайном порту — другой порт, чем у
 * харнесса, то есть для айфрейма это чужой источник, ровно как настоящая форма.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FormServer {
  url: string
  /** Что прислали формой — тест проверяет, что отправка внутри айфрейма дошла. */
  submissions: Array<Record<string, string>>
  close(): Promise<void>
}

const STYLE = `
  body { margin: 0; font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; background: #f0ebf8; color: #202124; }
  main { max-width: 640px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #dadce0; border-radius: 8px; padding: 24px; margin-bottom: 12px; }
  .card.head { border-top: 10px solid #673ab7; }
  h1 { margin: 0 0 8px; font-size: 28px; font-weight: 400; }
  p.sub { margin: 0; color: #5f6368; }
  label { display: block; font-weight: 500; margin-bottom: 8px; }
  input, textarea { width: 100%; box-sizing: border-box; border: 0; border-bottom: 1px solid #dadce0; padding: 8px 0; font: inherit; background: none; }
  input:focus, textarea:focus { outline: none; border-bottom: 2px solid #673ab7; }
  button { background: #673ab7; color: #fff; border: 0; border-radius: 4px; padding: 10px 24px; font: inherit; font-weight: 500; cursor: pointer; }
`

const FORM = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Заявка на инициативу</title><style>${STYLE}</style></head>
<body><main>
  <form method="post" action="/submit">
    <div class="card head"><h1>Заявка на инициативу</h1><p class="sub">PO team · заполните, что хотите получить и зачем</p></div>
    <div class="card"><label for="title">Название инициативы</label><input id="title" name="title" required></div>
    <div class="card"><label for="customer">Заказчик</label><input id="customer" name="customer"></div>
    <div class="card"><label for="problem">Проблема, которую решаем</label><textarea id="problem" name="problem" rows="3"></textarea></div>
    <div class="card"><label for="outcome">Ожидаемый результат</label><textarea id="outcome" name="outcome" rows="2"></textarea></div>
    <button type="submit">Отправить</button>
  </form>
</main></body></html>`

const THANKS = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ответ записан</title><style>${STYLE}</style></head>
<body><main><div class="card head"><h1>Ответ записан</h1><p class="sub">Спасибо! Инициатива попала в таблицу — дальше её разберёт агент.</p></div></main></body></html>`

export function startFormServer(): Promise<FormServer> {
  const submissions: Array<Record<string, string>> = []
  const server = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/submit') {
      let body = ''
      request.on('data', (chunk: Buffer) => { body += chunk.toString('utf8') })
      request.on('end', () => {
        submissions.push(Object.fromEntries(new URLSearchParams(body)))
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(THANKS)
      })
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(FORM)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}/`,
        submissions,
        close: () => new Promise((done) => { server.close(() => { done() }) }),
      })
    })
  })
}
