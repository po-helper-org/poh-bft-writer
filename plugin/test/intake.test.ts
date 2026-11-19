/**
 * Т7: интейк — чистая половина. Пути вложений, санитизация имён и слагов
 * (traversal — ошибка), ссылки без дубликатов, лимит ввода, имена диктовок.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  dictationFilename, MAX_UPLOAD_BYTES, parseLinks, sanitizeFilename, sanitizeSlug,
  uploadDir, validateIntake,
} from '../src/intake.js'

test('путь вложений: bft/uploads/<ts>-<slug>, слаг вычищен', () => {
  const now = new Date('2026-10-24T12:00:00Z')
  const ts = Math.floor(now.getTime() / 1000)
  assert.equal(uploadDir('Direct FAQ v2!', now), `bft/uploads/${ts}-direct-faq-v2`)
  assert.equal(uploadDir('Прямые Вопросы', now), `bft/uploads/${ts}-прямые-вопросы`)
})

test('пустой и мусорный слаг → intake', () => {
  assert.equal(sanitizeSlug('???'), 'intake')
  assert.equal(sanitizeSlug('---'), 'intake')
})

test('имя файла: без каталогов и управляющих, длинное режется, пустое — null', () => {
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd')
  assert.equal(sanitizeFilename('a/b\\c отчет.pdf'), 'c отчет.pdf')
  assert.equal((sanitizeFilename('x'.repeat(200)) ?? '').length, 96)
  assert.equal(sanitizeFilename(''), null)
  assert.equal(sanitizeFilename('/'), null)
})

test('ссылки: http/https, дубли сняты, хвост-пунктуация обрезана', () => {
  const text = 'смотри https://a.b/c, и http://d.e/f. снова https://a.b/c ftp://no'
  assert.deepEqual(parseLinks(text), ['https://a.b/c', 'http://d.e/f'])
  assert.deepEqual(parseLinks('без ссылок'), [])
})

test('валидация: пусто — ошибка; файл-транскрипт без слов — норма', () => {
  assert.equal(validateIntake('', []).ok, false)
  assert.equal(validateIntake('  ', []).ok, false)
  assert.equal(validateIntake('строка', []).ok, true)
  assert.equal(validateIntake('', ['bft/uploads/1-x/dictation-1.webm']).ok, true)
})

test('лимит вложения и имя диктовки стабильны', () => {
  assert.equal(MAX_UPLOAD_BYTES, 50 * 1024 * 1024)
  const n = dictationFilename(new Date('2026-10-24T12:00:00Z'))
  assert.equal(n, `dictation-${Math.floor(new Date('2026-10-24T12:00:00Z').getTime() / 1000)}.webm`)
})
