import assert from 'node:assert/strict'
import { test } from 'node:test'
import { artifactsOf, stageFromArtifacts } from '../src/stage.js'

const deepDoc = (opts: { stage?: string; pageId?: string; jira?: string } = {}) =>
  `---\npageId: ${opts.pageId ?? 'pending'}\njira: "${opts.jira ?? '[СОЗДАТЬ эпик]'}"\n` +
  `epic_slug: epic\nstage: ${opts.stage ?? 'deep'}\n---\n\n# [БФТ] epic: Название\n`

const READY = { stage: 'deep', pageId: '2272447498', jira: 'GDSLV-1409' }

test('пустой каталог эпика — To Do, и сказано, чего нет', () => {
  assert.deepEqual(stageFromArtifacts('epic', { entries: [] }),
    { stage: 'To Do', missing: ['документ БФТ'] })
})

test('документ fast без страницы ревью в FAST-DONE не поднимается', () => {
  assert.deepEqual(stageFromArtifacts('epic', { entries: ['epic-fast.md'] }),
    { stage: 'To Do', missing: ['страница ревью'] })
})

test('документ fast и его страница — FAST-DONE', () => {
  assert.deepEqual(stageFromArtifacts('epic', { entries: ['epic-fast.md', 'epic-fast.html'] }),
    { stage: 'FAST-DONE', missing: [] })
})

test('страница от fast не засчитывается за страницу deep', () => {
  // Обе страницы разные файлы; общий флаг «html есть» здесь дал бы DEEP-DONE.
  const verdict = stageFromArtifacts('epic', {
    entries: ['epic.md', 'epic-fast.html'],
    deepDocument: deepDoc(READY),
  })
  assert.equal(verdict.stage, 'DEEP-REVIEW')
  assert.deepEqual(verdict.missing, ['страница ревью'])
})

test('полный набор deep — DEEP-DONE', () => {
  assert.deepEqual(
    stageFromArtifacts('epic', { entries: ['epic.md', 'epic.html'], deepDocument: deepDoc(READY) }),
    { stage: 'DEEP-DONE', missing: [] },
  )
})

test('нет ссылки на Confluence — возврат в DEEP-REVIEW', () => {
  const verdict = stageFromArtifacts('epic', {
    entries: ['epic.md', 'epic.html'],
    deepDocument: deepDoc({ ...READY, pageId: 'pending' }),
  })
  assert.equal(verdict.stage, 'DEEP-REVIEW')
  assert.deepEqual(verdict.missing, ['ссылка на страницу Confluence'])
})

test('нет ссылки на эпик — возврат в DEEP-REVIEW', () => {
  const verdict = stageFromArtifacts('epic', {
    entries: ['epic.md', 'epic.html'],
    deepDocument: deepDoc({ ...READY, jira: '[СОЗДАТЬ эпик]' }),
  })
  assert.equal(verdict.stage, 'DEEP-REVIEW')
  assert.deepEqual(verdict.missing, ['ссылка на эпик JIRA'])
})

test('не хватает нескольких — названы все, а не первое попавшееся', () => {
  const verdict = stageFromArtifacts('epic', { entries: ['epic.md'], deepDocument: deepDoc() })
  assert.equal(verdict.stage, 'DEEP-REVIEW')
  assert.deepEqual(verdict.missing,
    ['страница ревью', 'ссылка на страницу Confluence', 'ссылка на эпик JIRA'])
})

test('единый документ со stage fast меряется требованиями fast, а не deep', () => {
  assert.deepEqual(
    stageFromArtifacts('epic', {
      entries: ['epic.md', 'epic.html'],
      deepDocument: deepDoc({ stage: 'fast' }),
    }),
    { stage: 'FAST-DONE', missing: [] },
  )
})

test('состав артефактов читается без учёта регистра и различает две страницы', () => {
  assert.deepEqual(artifactsOf('epic', ['Epic.MD', 'EPIC-FAST.md', 'epic.HTML']),
    { fast: true, fastHtml: false, deep: true, deepHtml: true })
})
