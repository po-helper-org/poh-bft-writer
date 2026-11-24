// Пункт меню «Доступ для ИИ-агентов» ведёт на страницу токенов MCP портала (ADR-0023).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACCESS_PATH } from '../lib/model.js'

test('адрес пункта меню совпадает с маршрутом customer-form', () => {
  const portal = readFileSync(new URL('../../customer-form/src/index.ts', import.meta.url), 'utf8')
  const route = portal.match(/const ACCESS_ROUTE = '([^']+)'/)?.[1]
  assert.equal(`/${ACCESS_PATH}`, route)
})
