import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BftReader } from '../src/bft-reader.js'
import { dispatch } from '../src/channel.js'
import { loadConfig } from '../src/config.js'
import type { BftPorts } from '../src/ports.js'

const ENV = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' }
const DOC = `---\npageId: pending\njira: "[СОЗДАТЬ эпик]"\nepic_slug: alpha\nstage: deep\n---\n\n# [БФТ] alpha: Альфа\n`

function reader(): BftReader {
  const tree: Record<string, string[] | string> = {
    '/ws/.bft/documentation': ['alpha'],
    '/ws/.bft/documentation/alpha': ['alpha.md', 'alpha.html'],
    '/ws/.bft/documentation/alpha/alpha.md': DOC,
    '/ws/.bft/documentation/alpha/alpha.html': '<h1>Альфа</h1>',
  }
  const ports: BftPorts = {
    async listDirectory(p) { const e = tree[p]; return Array.isArray(e) ? e : [] },
    async readTextFile(p) { const e = tree[p]; return typeof e === 'string' ? e : null },
    async writeTextFile(p, c) { tree[p] = c },
    async realPath(p) { return p },
    async runCommand() { return { stdout: '', code: -1 } },
  }
  return new BftReader(loadConfig(ENV), ports)
}

test('список требований уходит наружу значением', async () => {
  const result = await dispatch(reader(), 'list', {})
  assert.equal(result.ok, true)
  assert.equal((result as { value: unknown[] }).value.length, 1)
})

test('неизвестная подкоманда — ответ с кодом, а не исключение', async () => {
  const result = await dispatch(reader(), 'нетакой', {})
  assert.deepEqual(result, { ok: false, error: { code: 'bad-request', message: 'неизвестная подкоманда «нетакой»', details: {} } })
})

test('пустой обязательный параметр ловится до чтения диска', async () => {
  for (const endpoint of ['task', 'document', 'findDocument', 'handoff']) {
    const result = await dispatch(reader(), endpoint, {})
    assert.equal(result.ok, false, endpoint)
    assert.equal((result as { error: { code: string } }).error.code, 'bad-request', endpoint)
  }
})

test('ошибка предметной области едет кодом, а не «internal»', async () => {
  // Слаг эпика по стандарту — [\w-]+, поэтому «не найден» проверяется допустимым
  // идентификатором: недопустимый честно отвергается раньше и другим кодом.
  const notFound = await dispatch(reader(), 'task', { id: 'no-such-epic' })
  assert.equal((notFound as { error: { code: string } }).error.code, 'task-not-found')

  const escaped = await dispatch(reader(), 'document', { path: '../../etc/passwd' })
  assert.equal((escaped as { error: { code: string } }).error.code, 'document-outside-workspace')

  for (const bad of ['../etc', 'a/b', 'кириллица']) {
    const badId = await dispatch(reader(), 'task', { id: bad })
    assert.equal((badId as { error: { code: string } }).error.code, 'invalid-task-id', bad)
  }
})

test('исключение неизвестной формы не роняет канал', async () => {
  const broken = {
    listTasks: () => { throw { get message() { throw new Error('и это тоже') } } },
  } as unknown as BftReader
  const result = await dispatch(broken, 'list', {})
  assert.equal(result.ok, false)
  assert.equal((result as { error: { code: string } }).error.code, 'internal')
})

test('закрытие отрезка требует итог, а не только идентификатор', async () => {
  const r = reader()
  await r.startWork({ epic: 'alpha', stage: 'DEEP-REVIEW', startedAt: '2026-09-04T10:00:00Z' })
  assert.equal((await dispatch(r, 'finishWork', { id: 'alpha' })).ok, false)
  assert.equal((await dispatch(r, 'finishWork', { id: 'alpha', summary: 'готово', contextRef: 'br' })).ok, true)
})
