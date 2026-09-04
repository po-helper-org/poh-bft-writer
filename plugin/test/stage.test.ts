import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactsOf, stageFromArtifacts } from '../src/stage.js'

const deepDoc = (stage: string, pageId = 'pending') =>
  `---\npageId: ${pageId}\nepic_slug: epic\nstage: ${stage}\n---\n\n# [БФТ] epic: Название\n`

test('пустой каталог эпика — To Do', () => {
  assert.equal(stageFromArtifacts('epic', { entries: [] }), 'To Do')
})

test('только шапка fast — FAST-DONE', () => {
  assert.equal(stageFromArtifacts('epic', { entries: ['epic-fast.md', 'epic-fast.html'] }), 'FAST-DONE')
})

test('единый документ со stage deep, но без публикации — DEEP-REVIEW', () => {
  assert.equal(
    stageFromArtifacts('epic', { entries: ['epic.md', 'epic.html'], deepDocument: deepDoc('deep') }),
    'DEEP-REVIEW',
  )
})

test('опубликованный документ — DEEP-DONE', () => {
  assert.equal(
    stageFromArtifacts('epic', { entries: ['epic.md'], deepDocument: deepDoc('deep', '2272447498') }),
    'DEEP-DONE',
  )
})

test('единый документ, но stage ещё fast — deep не доработал, это FAST-DONE', () => {
  assert.equal(
    stageFromArtifacts('epic', { entries: ['epic.md'], deepDocument: deepDoc('fast') }),
    'FAST-DONE',
  )
})

test('состав артефактов читается без учёта регистра', () => {
  const a = artifactsOf('epic', ['Epic.MD', 'EPIC-FAST.md', 'epic.HTML'])
  assert.deepEqual(a, { fast: true, deep: true, html: true })
})
