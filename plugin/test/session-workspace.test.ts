import assert from 'node:assert/strict'
import { test } from 'node:test'
import { relativeConfigPaths, rewriteConfigPaths, sessionDirectory } from '../src/session-workspace.js'

test('каталог чатов — заданный явно, иначе родитель каталога документов', () => {
  assert.equal(sessionDirectory(undefined, 'bft/documentation'), 'bft')
  assert.equal(sessionDirectory(undefined, '.bft/documentation'), '.bft')
  assert.equal(sessionDirectory(undefined, 'documentation'), '')
  assert.equal(sessionDirectory('chats', 'bft/documentation'), 'chats')
})

test('пути конфига считаются от каталога чатов', () => {
  assert.deepEqual(relativeConfigPaths('bft', 'bft/documentation', 'bft/index', 'agent/skills'), {
    docs_path: 'documentation', index_path: 'index', skills_path: '../agent/skills',
  })
  assert.deepEqual(relativeConfigPaths('', 'bft/documentation', 'bft/index', undefined), {
    docs_path: 'bft/documentation', index_path: 'bft/index', skills_path: undefined,
  })
})

test('секции путей переписываются, остальные секции остаются как были', () => {
  const root = `# bft-config

## gds_sheet_url
https://docs.google.com/spreadsheets/d/x

Комментарий к таблице.

## docs_path
bft/documentation

## team_name
GDS/Платформа

## index_path
bft/index
`
  const out = rewriteConfigPaths(root, { docs_path: 'documentation', index_path: 'index', skills_path: '../agent/skills' })
  assert.match(out, /## docs_path\ndocumentation\n/)
  assert.match(out, /## index_path\nindex\n/)
  assert.match(out, /## skills_path\n\.\.\/agent\/skills\n$/, 'отсутствующая секция дописана в конец')
  assert.match(out, /## team_name\nGDS\/Платформа/)
  assert.match(out, /## gds_sheet_url\nhttps:\/\/docs\.google\.com\/spreadsheets\/d\/x\n\nКомментарий к таблице\./)
  assert.ok(!out.includes('bft/documentation'), 'старое значение секции стёрто')
})

test('без skill-root секция skills_path не пишется и чужая не трогается', () => {
  const out = rewriteConfigPaths('# x\n\n## skills_path\nagent/skills\n', { docs_path: 'documentation', index_path: 'index' })
  assert.match(out, /## skills_path\nagent\/skills/)
  assert.match(out, /## docs_path\ndocumentation/)
})
