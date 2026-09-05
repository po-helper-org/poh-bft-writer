import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPublished, parseFrontmatter } from '../src/frontmatter.js'

const DOC = `---
source: "[УТОЧНИТЬ — не опубликовано]"
pageId: pending
version: 0.1
epic_slug: direct-faq
stage: fast
---

# [БФТ] direct-faq: Блок «Вопрос-ответ»
`

test('разбирает плоские ключи и снимает кавычки', () => {
  const fm = parseFrontmatter(DOC)
  assert.equal(fm.epic_slug, 'direct-faq')
  assert.equal(fm.stage, 'fast')
  assert.equal(fm.source, '[УТОЧНИТЬ — не опубликовано]')
})

test('документ без frontmatter — не ошибка, просто пусто', () => {
  assert.deepEqual(parseFrontmatter('# Заголовок\n\nтекст'), {})
})

test('тело документа во frontmatter не затекает', () => {
  const fm = parseFrontmatter(DOC)
  assert.equal(fm.epic_slug, 'direct-faq')
  assert.ok(!('# [БФТ] direct-faq' in fm))
})

test('опубликованным считается только реальный pageId', () => {
  assert.equal(isPublished({ pageId: 'pending' }), false)
  assert.equal(isPublished({ pageId: '[УТОЧНИТЬ]' }), false)
  assert.equal(isPublished({}), false)
  assert.equal(isPublished({ pageId: '2272447498' }), true)
})
