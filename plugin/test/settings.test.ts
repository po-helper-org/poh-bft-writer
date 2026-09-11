import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS, DEFAULT_SYNC_PROMPT, buildSyncDraft, normalizeUrl, resolveSettings,
} from '../src/settings.js'

const SHEET = 'https://docs.google.com/spreadsheets/d/abc'

test('адрес известен — плейсхолдер заменяется', () => {
  assert.equal(buildSyncDraft('/bft-needed-list {sheet}', SHEET), `/bft-needed-list ${SHEET}`)
})

test('адрес известен — заменяются все вхождения', () => {
  assert.equal(buildSyncDraft('{sheet} и ещё раз {sheet}', SHEET), `${SHEET} и ещё раз ${SHEET}`)
})

test('адреса нет — плейсхолдер уезжает вместе с прилипшим пробелом', () => {
  assert.equal(buildSyncDraft('/bft-needed-list {sheet}', ''), '/bft-needed-list')
})

test('адреса нет — между двумя словами остаётся один пробел', () => {
  assert.equal(buildSyncDraft('Разбери {sheet} и заведи задачи', '   '), 'Разбери и заведи задачи')
})

test('адреса нет — перенос строки вокруг плейсхолдера сохраняется', () => {
  assert.equal(buildSyncDraft('/bft-needed-list\n  {sheet}\nи заведи', ''), '/bft-needed-list\n\nи заведи')
})

test('плейсхолдера нет — промт уходит как написан', () => {
  assert.equal(buildSyncDraft('/bft-needed-list', SHEET), '/bft-needed-list')
})

test('умолчание промта с пустым адресом даёт прежнюю команду синка', () => {
  assert.equal(buildSyncDraft(DEFAULT_SYNC_PROMPT, ''), '/bft-needed-list')
})

test('http и https принимаются как есть, без нормализации хвоста', () => {
  assert.equal(normalizeUrl(' https://forms.gle/abc '), 'https://forms.gle/abc')
  assert.equal(normalizeUrl('http://localhost:3000/form'), 'http://localhost:3000/form')
})

test('пустое поле — валидное значение «не задано»', () => {
  assert.equal(normalizeUrl('   '), '')
})

test('чужие схемы и мусор отбиваются', () => {
  assert.equal(normalizeUrl('javascript:alert(1)'), undefined)
  assert.equal(normalizeUrl('file:///etc/passwd'), undefined)
  assert.equal(normalizeUrl('docs.google.com/spreadsheets'), undefined)
})

test('секция без полей резолвится в умолчания', () => {
  assert.deepEqual(resolveSettings(undefined), DEFAULT_SETTINGS)
  assert.deepEqual(resolveSettings({}), DEFAULT_SETTINGS)
})

test('чужие типы в документе не роняют раздел', () => {
  assert.deepEqual(resolveSettings({ formUrl: 42, sheetUrl: null, syncPrompt: [] }), DEFAULT_SETTINGS)
})

test('пустой промт в документе возвращает умолчание, а не пустой черновик', () => {
  assert.equal(resolveSettings({ syncPrompt: '   ' }).syncPrompt, DEFAULT_SYNC_PROMPT)
})

test('многострочный промт сохраняется дословно', () => {
  const prompt = '/bft-needed-list {sheet}\n\nЗаводи задачи типом bft.'
  assert.equal(resolveSettings({ syncPrompt: prompt }).syncPrompt, prompt)
})
