import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseDocumentHead } from '../src/head.js'

// Эталон шапки навыка — единственный источник правды о скелете документа
// (`document_assembly.md`). Разбор обязан читать его без единой поблажки.
const golden = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills', 'bft-fast', 'examples', 'golden_document.md'),
  'utf8',
)

test('golden-документ: SMART-таблица, шаги демо и заказчик читаются из шапки', () => {
  const head = parseDocumentHead(golden)
  assert.ok(head.smart, 'SMART-таблица не найдена')
  const rows = head.smart.split('\n')
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map(row => row[0]), ['S', 'M', 'A', 'R', 'T'])
  assert.match(rows[0], /^S \(Specific\): \S/)
  assert.ok(head.howToDemo.length >= 3, `шагов демо: ${head.howToDemo.length}`)
  assert.ok(head.howToDemo.every(step => !/^\d+\.\s/.test(step)), 'номер шага — не часть текста')
  assert.ok(head.customer, 'заказчик не найден')
})

const doc = (body: string) => `---\nstage: fast\nepic_slug: x\n---\n\n# [БФТ] x: Название\n\n## Шапка (сутевое описание запроса)\n\n${body}`

test('SMART: строки цели в порядке документа, заголовок и разделитель таблицы отброшены', () => {
  const head = parseDocumentHead(doc([
    '### Цель',
    '',
    '| SMART | Значение |',
    '|---|---|',
    '| S (Specific) | Вывод кино на афишу |',
    '| M (Measurable) | Кино видно; синхронизация \\| не более часа |',
    '| A (Achievable) | [УТОЧНИТЬ] |',
    '| R (Relevant) | Коммерция запросила |',
    '| T (Time-bound) | 31.10.2026 |',
    '',
    '### How to demo',
    '',
    '1. Первый шаг.',
    '2. Второй шаг',
    '   с продолжением на следующей строке.',
    '3. Третий (уточнение, не Y).',
    '',
    '### Ограничения и договоренности',
    '',
    '* Не шаг демо.',
  ].join('\n')))
  assert.equal(head.smart, [
    'S (Specific): Вывод кино на афишу',
    'M (Measurable): Кино видно; синхронизация | не более часа',
    'A (Achievable): [УТОЧНИТЬ]',
    'R (Relevant): Коммерция запросила',
    'T (Time-bound): 31.10.2026',
  ].join('\n'))
  assert.deepEqual(head.howToDemo, [
    'Первый шаг.',
    'Второй шаг с продолжением на следующей строке.',
    'Третий (уточнение, не Y).',
  ])
})

test('How to demo без нумерации — один абзац, не список; заголовки `##` тоже узнаются', () => {
  const head = parseDocumentHead(doc([
    '## Цель',
    '',
    '| SMART | Значение |',
    '|---|---|',
    '| S (Specific) | Рассылка |',
    '',
    '## How to demo',
    '',
    '[УТОЧНИТЬ] — сценарий демонстрации не обсуждался:',
    'в источнике только гипотеза.',
    '',
    '## Общая информация',
    '',
    '| Поле | Значение |',
    '| --- | --- |',
    '| Название проекта | Рассылка |',
    '| Ответственный за продукт | Иванова Мария (маркетинг) |',
  ].join('\n')))
  assert.equal(head.smart, 'S (Specific): Рассылка')
  assert.deepEqual(head.howToDemo, ['[УТОЧНИТЬ] — сценарий демонстрации не обсуждался: в источнике только гипотеза.'])
  assert.equal(head.customer, 'Иванова Мария (маркетинг)')
})

test('блоков нет — полей нет, а не пустые строки; frontmatter не мешает', () => {
  const head = parseDocumentHead('---\nstage: deep\n---\n\n# [БФТ] x: Без шапки\n\n## Проблема которую решаем\n\nТекст.\n')
  assert.deepEqual(head, { howToDemo: [] })
  assert.deepEqual(parseDocumentHead(''), { howToDemo: [] })
})

test('пустая ячейка SMART и пустое «Ответственный за продукт» не считаются значением', () => {
  const head = parseDocumentHead(doc([
    '### Цель',
    '',
    '| SMART | Значение |',
    '|---|---|',
    '| S (Specific) |  |',
    '| M (Measurable) | Измеримо |',
    '',
    '### Общая информация',
    '',
    '| Поле | Значение |',
    '|---|---|',
    '| Ответственный за продукт | |',
  ].join('\n')))
  assert.equal(head.smart, 'M (Measurable): Измеримо')
  assert.equal(head.customer, undefined)
})
