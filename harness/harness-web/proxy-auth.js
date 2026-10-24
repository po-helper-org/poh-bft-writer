#!/usr/bin/env node
/**
 * Приветственный прокси портала заказчика (ADR-0007 rev4): вход без кода.
 *
 * dsh web генерирует случайный launch-токен (browser-auth.ts) и штатного
 * «безтокенного» входа нет. Прокси стоит первым на :3080 и при открытии «/»
 * без токена молча редиректит на ссылку с актуальным токеном (entrypoint
 * парсит его из stdout dsh и передаёт в DSH_TOKEN). Остальное — прозрачный
 * прокси на dsh (:13080), включая WebSocket upgrade.
 */
const http = require('node:http')

const TARGET_HOST = '127.0.0.1'
const TARGET_PORT = Number(process.env.DSH_UPSTREAM_PORT ?? 13080)
const PORT = Number(process.env.DSH_PORT ?? 3080)
const TOKEN = process.env.DSH_TOKEN ?? ''

if (!TOKEN) {
  console.error('[proxy] DSH_TOKEN не передан — нечего подставлять')
  process.exit(1)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const hasToken = url.searchParams.has('token')
  const hasAuthCookie = /(?:^|;\s)dsh-auth-[^=]+=/i.test(req.headers.cookie ?? '')
  if (!hasToken && !hasAuthCookie && (url.pathname === '/' || url.pathname === '')) {
    url.searchParams.set('token', TOKEN)
    res.writeHead(302, { location: url.pathname + '?' + url.searchParams.toString() })
    res.end()
    return
  }
  const upstream = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, path: req.url, method: req.method, headers: req.headers },
    (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res) },
  )
  upstream.on('error', () => { res.writeHead(502); res.end('upstream down') })
  req.pipe(upstream)
})

// WebSocket: проксируем upgrade «в лоб» — оба сокета соединяются напрямую.
server.on('upgrade', (req, socket, head) => {
  const upstream = http.request({
    host: TARGET_HOST, port: TARGET_PORT, path: req.url, method: req.method, headers: req.headers,
  })
  upstream.on('upgrade', (res, upSocket, upHead) => {
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n',
    )
    if (upHead?.length) socket.write(upHead)
    if (head?.length) upSocket.write(head)
    upSocket.pipe(socket); socket.pipe(upSocket)
  })
  upstream.on('error', () => socket.destroy())
  upstream.end()
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] :${PORT} → :${TARGET_PORT}, вход без кода (подстановка токена)`)
})
