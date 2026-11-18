// Разовая уборка при запуске: файлы OAuth-подключений прежних версий плагина
// (полный токен шлюза агентов) удаляются из тома; другие файлы не трогаются,
// в журнал не попадают ни имена, ни значения.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
process.env.DSH_HOME = home
const { removeLegacyConnections, legacyDir } = await import('../lib/legacy.js')
const { apply } = await import('../lib/index.js')

const SECRET = 'old-access-token-must-not-leak'

test('нет каталога — ничего не делает', async () => {
  assert.equal(await removeLegacyConnections(join(home, 'nope')), 0)
})

test('apply удаляет прежние подключения и пишет в журнал только число', async () => {
  const dir = legacyDir()
  assert.equal(dir, join(home, 'data-sources'))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'po-hq.json'), JSON.stringify({ accessToken: SECRET, refreshToken: SECRET }), { mode: 0o600 })
  await writeFile(join(dir, 'other.json'), '{}', { mode: 0o600 })
  await writeFile(join(dir, 'keep.txt'), 'x')
  const logged = []
  const warn = console.warn
  console.warn = (...args) => { logged.push(args.join(' ')) }
  try {
    const ctx = { get: () => undefined, effect: (fn) => { fn() }, inject: () => {}, provide: () => () => {} }
    apply(ctx)
    for (let i = 0; i < 50 && (await readdir(dir)).some((n) => n.endsWith('.json')); i++) await new Promise((r) => setTimeout(r, 10))
    for (let i = 0; i < 50 && !logged.length; i++) await new Promise((r) => setTimeout(r, 10))
  } finally {
    console.warn = warn
  }
  assert.deepEqual(await readdir(dir), ['keep.txt'])
  assert.equal(logged.length, 1)
  assert.match(logged[0], /удалены прежние OAuth-подключения из тома: 2/)
  assert.doesNotMatch(logged[0], new RegExp(SECRET))
  assert.doesNotMatch(logged[0], /po-hq/)
  await rm(home, { recursive: true, force: true })
})
