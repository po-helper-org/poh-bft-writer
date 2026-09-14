import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigError, DEFAULT_DOCS_PATH, loadConfig } from '../src/config.js'

test('без корня воркспейса конфиг падает, а не угадывает', () => {
  assert.throws(() => loadConfig({}), ConfigError)
  assert.throws(() => loadConfig({ BFT_WORKSPACE_ROOT: '   ' }), ConfigError)
})

test('умолчание каталога документов — то же, что в bft-config.template.md', () => {
  const config = loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' })
  assert.equal(config.docsPath, DEFAULT_DOCS_PATH)
  assert.deepEqual([...config.docsPathFallbacks], ['bft/documentation'])
})

test('заданный каталог запасных не имеет — иначе можно молча показать не тот воркспейс', () => {
  const config = loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t', BFT_DOCS_PATH: 'custom/docs' })
  assert.equal(config.docsPath, 'custom/docs')
  assert.deepEqual([...config.docsPathFallbacks], [])
})

test('доска Backlog.md включена умолчанием: слой профиля заменяет конфиг пакета целиком', () => {
  const config = loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_BASE_URL: 'https://entire.io/t' })
  assert.equal(config.backlogBin, 'backlog')
})

test('Backlog.md не обязателен: доска отключается словом off', () => {
  const config = loadConfig({
    BFT_WORKSPACE_ROOT: '/ws',
    BFT_ENTIRE_BASE_URL: 'https://entire.io/t',
    BFT_BACKLOG_BIN: 'off',
  })
  assert.equal(config.backlogBin, undefined)
})

test('пустая настройка доску не гасит: отказ пишется словом, а не пробелами', () => {
  const config = loadConfig({
    BFT_WORKSPACE_ROOT: '/ws',
    BFT_ENTIRE_BASE_URL: 'https://entire.io/t',
    BFT_BACKLOG_BIN: '   ',
  })
  assert.equal(config.backlogBin, 'backlog')
})

// ── Рабочее пространство чатов ───────────────────────────────────────────────

test('sessionPath: не задан — умолчание, пустой — выключено, иначе путь без ведущего ./ и хвостового /', () => {
  const base = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }
  assert.equal(loadConfig(base).sessionPath, undefined)
  assert.equal(loadConfig({ ...base, BFT_SESSION_PATH: '' }).sessionPath, '')
  assert.equal(loadConfig({ ...base, BFT_SESSION_PATH: './chats/' }).sessionPath, 'chats')
})

test('sessionPath за пределами воркспейса отвергается', () => {
  const base = { BFT_WORKSPACE_ROOT: '/ws', BFT_ENTIRE_REQUIRED: '0' }
  for (const bad of ['../other', '/abs/path', 'a/../../b']) {
    assert.throws(() => loadConfig({ ...base, BFT_SESSION_PATH: bad }), ConfigError, `принят «${bad}»`)
  }
})
