// Переход на служебный токен: прежнее OAuth-подключение (полный токен штаба)
// удаляется из тома и отзывается на сервере — пустая переменная окружения
// не возвращает портал к полному токену.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
process.env.DSH_HOME = home
const { saveConnection, loadConnection } = await import('../lib/oauth.js')
const { McpSource } = await import('../lib/sources.js')

test('служебный токен: старое OAuth-подключение удалено и отозвано', async () => {
  const revoked = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      if (req.url === '/revoke') revoked.push(new URLSearchParams(raw).get('token_type_hint'))
      res.writeHead(200).end('{}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await saveConnection('po-mig', {
      clientId: 'c', redirectUri: 'http://127.0.0.1:3081/callback', tokenEndpoint: `${base}/token`, revocationEndpoint: `${base}/revoke`,
      accessToken: 'old-access', refreshToken: 'old-refresh', connectedAt: '2026-11-01T00:00:00Z',
    })
    const source = new McpSource('po-mig', 'Штаб', `${base}/mcp`, 'staff', { serviceToken: 'svc' })
    const status = await source.status()
    assert.equal(status.mode, 'service')
    assert.equal(await loadConnection('po-mig'), undefined)
    await assert.rejects(access(join(home, 'data-sources', 'po-mig.json')))
    for (let i = 0; i < 50 && revoked.length < 2; i++) await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(revoked.sort(), ['access_token', 'refresh_token'])
    // Без служебного токена источник больше не подключён (не тихий возврат к OAuth).
    const plain = new McpSource('po-mig', 'Штаб', `${base}/mcp`, 'staff', { serviceToken: '' })
    assert.equal(await plain.connected(), false)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(home, { recursive: true, force: true })
  }
})
