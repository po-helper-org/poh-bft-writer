import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigError, DEFAULT_DOCS_PATH, loadConfig } from '../src/config.js'

test('без корня воркспейса конфиг падает, а не угадывает', () => {
  assert.throws(() => loadConfig({}), ConfigError)
  assert.throws(() => loadConfig({ BFT_WORKSPACE_ROOT: '   ' }), ConfigError)
})

test('умолчание каталога документов — то же, что в bft-config.template.md', () => {
  const config = loadConfig({ BFT_WORKSPACE_ROOT: '/ws' })
  assert.equal(config.docsPath, DEFAULT_DOCS_PATH)
  assert.deepEqual([...config.docsPathFallbacks], ['bft/documentation'])
})

test('заданный каталог запасных не имеет — иначе можно молча показать не тот воркспейс', () => {
  const config = loadConfig({ BFT_WORKSPACE_ROOT: '/ws', BFT_DOCS_PATH: 'custom/docs' })
  assert.equal(config.docsPath, 'custom/docs')
  assert.deepEqual([...config.docsPathFallbacks], [])
})

test('Backlog.md не обязателен: без него раздел работает по артефактам', () => {
  const config = loadConfig({ BFT_WORKSPACE_ROOT: '/ws' })
  assert.equal(config.backlogBin, undefined)
})
