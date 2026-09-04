import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseDocument } from '../src/document-source.js'

test('канонический HTML побеждает всё остальное', () => {
  const choice = chooseDocument('epic', ['epic.md', 'epic-fast.md', 'epic.html', 'other.html'])
  assert.deepEqual(choice, { name: 'epic.html', kind: 'html' })
})

test('эпик назвали иначе — берётся любой HTML', () => {
  assert.deepEqual(chooseDocument('epic', ['epic.md', 'zz.html', 'aa.html']),
    { name: 'aa.html', kind: 'html' })
})

test('страницы нет — показывается единый markdown', () => {
  assert.deepEqual(chooseDocument('epic', ['epic.md', 'epic-fast.md']),
    { name: 'epic.md', kind: 'markdown' })
})

test('после одного /bft-fast документ тоже показывается', () => {
  assert.deepEqual(chooseDocument('epic', ['epic-fast.md']),
    { name: 'epic-fast.md', kind: 'markdown' })
})

test('показывать нечего — null, а не выдуманное имя', () => {
  assert.equal(chooseDocument('epic', ['personas.csv']), null)
})
