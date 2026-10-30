/**
 * Т5: чистое ядро — контакты верификации (contacts.ts).
 * Все случаи спеки US-16: три роли, email обязателен, пропуск — открытый
 * вопрос, мусорная строка не ломает разбор.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { parseContacts, questionFor, ROLE_TITLES } from '../src/contacts.js'

const DOC = `---
slug: 2026-10-23-direct-faq
stage: fast
contacts:
  - {role: customer, name: "И. Иванов", email: iivanov@corp.ru}
  - {role: po, name: "П. Петров", email: ppetrov@corp.ru}
  - {role: tech-lead, name: "С. Сидоров", email: }
sources:
  - https://confluence.corp.ru/x/AbCd
---
# Заголовок`

test('все три роли с email — вопросов нет', () => {
  const v = parseContacts(DOC.replace(/, email: \}/, ', email: ssidorov@corp.ru}'))
  assert.deepEqual(v.missing, [])
  assert.equal(v.contacts.length, 3)
})

test('роль без email и пропущенная роль — открытые вопросы, не заглушки', () => {
  const v = parseContacts(DOC)
  assert.deepEqual(v.missing, ['tech-lead'])
  assert.deepEqual(v.questions, [questionFor('tech-lead')])
})

test('пропущенная роль попадает в missing', () => {
  const v = parseContacts(`---
contacts:
  - {role: customer, email: a@b.ru}
---`)
  assert.deepEqual(v.missing, ['po', 'tech-lead'])
  assert.equal(v.contacts[0].name, undefined)
})

test('блока нет — все роли в missing, пустой список контактов', () => {
  const v = parseContacts('# Просто документ без frontmatter')
  assert.deepEqual(v.contacts, [])
  assert.deepEqual(v.missing, ['customer', 'po', 'tech-lead'])
})

test('мусорные строки и чужие роли пропускаются, разбор не падает', () => {
  const v = parseContacts(`---
contacts:
  - {role: intern, email: x@y.ru}
  - сломанная строка
  - {role: po, email: p@b.ru}
---`)
  assert.deepEqual(v.contacts.map((c) => c.role), ['po'])
  assert.ok(!v.missing.includes('po'))
})

test('кавычки имени снимаются, конец блока — следующий ключ', () => {
  const v = parseContacts(DOC.replace(/, email: \}/, ', email: ssidorov@corp.ru}'))
  assert.equal(v.contacts[0].name, 'И. Иванов')
  // Блок закончился на sources:, заголовок не разбирается как контакт.
  assert.equal(v.contacts.length, 3)
})

test('формулировки вопросов содержат человеческие названия ролей', () => {
  assert.match(questionFor('customer'), /Заказчик/)
  assert.match(questionFor('tech-lead'), /Техлид/)
  assert.equal(ROLE_TITLES.po, 'PO')
})
