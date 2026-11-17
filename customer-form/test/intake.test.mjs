// Слова заказчика доходят до fast и deep; полнота приёма (план качества, C1 и C11).
// Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { measurable, primaryErrors, toFastInput, validQuote } from '../lib-test/primary.js'
import { customerWordsContext, demoIntake, glossaryOf, mergeIntake } from '../lib-test/intake.js'
import { buildFast, fastDocument } from '../lib-test/bft-fast.js'
import { baselineOf, presentState } from '../lib-test/present.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SKILLS = join(ROOT, 'skills')

// Нейтральный домен: заявки на ремонт оборудования в цехе.
const QUOTE = 'Заказчик: «Сейчас мастер звонит диспетчеру, тот пишет заявку в журнал — ремонт ждут по два дня. Нужно: мастер оформляет заявку с планшета, диспетчер видит её сразу.»'
const args = () => ({
  title: 'Заявка на ремонт с планшета',
  want: { what: 'Оформлять заявку на ремонт с планшета', why: 'Ремонт ждут по два дня', quote: QUOTE },
  requirements: [
    { kind: 'пользователю', text: 'Мастер оформляет заявку с планшета', quote: 'Заказчик: «мастер оформляет заявку с планшета»' },
    { kind: 'зачем', text: 'Сократить ожидание ремонта', quote: 'Заказчик: «ремонт ждут по два дня»', asis: 'ремонт ждут по два дня' },
    { kind: 'на экране', text: 'Диспетчер видит заявку сразу', quote: 'Заказчик: «диспетчер видит её сразу»', asis: 'заявки теряются в журнале' },
  ],
  people: [{ name: 'Петров Пётр', role: 'Заказчик', about: 'Email: p@example.com' }],
  openQuestions: ['Кто назначает исполнителя ремонта'],
})

test('validQuote: подстрока цитаты после нормализации; пересказ — нет', () => {
  assert.ok(validQuote('мастер звонит диспетчеру, тот пишет заявку в журнал', [QUOTE]))
  assert.ok(validQuote('  Мастер  звонит диспетчеру ', [QUOTE]))
  assert.ok(!validQuote('мастер пишет диспетчеру письмо', [QUOTE]))
  assert.ok(!validQuote('', [QUOTE]))
})

test('C1 toFastInput: ASIS только дословный, слова заказчика в R, M — не чек-лист', () => {
  const a = { ...args(), want: { ...args().want, asis: 'мастер звонит диспетчеру, тот пишет заявку в журнал' } }
  const input = toFastInput(a)
  assert.equal(input.asis, 'мастер звонит диспетчеру, тот пишет заявку в журнал')
  const byId = Object.fromEntries(input.requirements.map((r) => [r.id, r]))
  assert.equal(byId['БТ-1'].asis, 'ремонт ждут по два дня')
  assert.notEqual(byId['ИТ-1'].asis, 'заявки теряются в журнале', 'asis не из цитаты — отброшен')
  // Раунд 4: цитата строки — из той же реплики, где заказчик описал «как сейчас», — ASIS этой реплики, а не пробел.
  assert.equal(byId['ИТ-1'].asis, 'мастер звонит диспетчеру, тот пишет заявку в журнал')
  assert.equal(byId['ПТ-1'].asis, 'мастер звонит диспетчеру, тот пишет заявку в журнал')
  assert.match(input.smart.r, /Слова заказчика \(R3\): Заказчик: «Сейчас мастер звонит/)
  // Раунд 4: базовое значение из слов заказчика о том, как сейчас («ремонт ждут по два дня»), — «сейчас» в M.
  assert.equal(input.smart.m, 'сейчас два дня (со слов заказчика) → [УТОЧНИТЬ: целевое значение]')
  assert.equal(toFastInput({ ...args(), want: { ...args().want, quote: 'Заказчик: «Нужно: мастер оформляет заявку с планшета»' } }).smart.m, '[УТОЧНИТЬ: показатель эффекта]; приёмка — см. How to demo')
  assert.equal(input.smart.t, undefined)
  // Контакт вместо зоны влияния в шапку не идёт.
  assert.equal(input.personas[0].influence, undefined)
  const invented = toFastInput({ ...args(), want: { ...args().want, asis: 'заявки ведутся в Excel' } })
  assert.notEqual(invented.asis, 'заявки ведутся в Excel', 'пересказ не проходит')
  assert.equal(toFastInput({ ...args(), want: { ...args().want, asis: 'заявки ведутся в Excel', quote: 'Заказчик: «Нужно: мастер оформляет заявку»' } }).asis, undefined)
})

test('раунд 4: «как сейчас» только в общей реплике — ASIS дословно из неё, без ложного пробела в скелете; базовое значение — в M', () => {
  const input = toFastInput(args())
  assert.equal(input.asis, 'Сейчас мастер звонит диспетчеру, тот пишет заявку в журнал — ремонт ждут по два дня')
  assert.ok(validQuote(input.asis, [QUOTE]), 'ASIS — подстрока реплики')
  const bt = input.requirements.find((r) => r.id === 'БТ-1')
  assert.equal(bt.asis, 'ремонт ждут по два дня', 'свой asis строки важнее')
  // Строка на той же реплике без своего asis получает ASIS из неё, только если слова о текущем процессе — про неё (раунд 6).
  const shared = toFastInput({ ...args(), requirements: [
    { kind: 'пользователю', text: 'Мастер подаёт заявку на ремонт без звонка диспетчеру', quote: QUOTE },
    { kind: 'зачем', text: 'Сократить ожидание', quote: QUOTE },
  ] })
  assert.equal(shared.requirements.find((r) => r.tobe.startsWith('Мастер')).asis, input.asis)
  assert.equal(shared.requirements.find((r) => r.tobe === 'Сократить ожидание').asis, undefined, 'процесс целиком в чужую строку скелета не копируется')
  assert.equal(presentState('Заказчик: «Хочу, чтобы всё работало сразу»'), undefined)
  assert.equal(baselineOf('уходит до недели, бумаги теряются'), 'до недели')
  assert.equal(baselineOf('занимает два-три дня'), 'два-три дня')
  assert.equal(baselineOf('ответ ждём 40 минут'), '40 минут')
  assert.equal(baselineOf('в первый день'), undefined)
  // Контекст deep: ASIS и базовое значение — строками «Слов заказчика».
  const context = customerWordsContext({ args: args() }, undefined)
  assert.match(context, /Как сейчас \(ASIS, из той же реплики\): «Сейчас мастер звонит/)
  assert.match(context, /Эффект: сейчас — два дня/)
})

test('C11: эффект, срок, границы и договорённости', () => {
  assert.equal(measurable({ now: 'два дня', target: 'два часа', quote: 'q' }), 'два дня → два часа')
  assert.equal(measurable({ now: 'два дня', quote: 'q' }), 'два дня → [УТОЧНИТЬ: целевое значение]')
  const input = toFastInput({
    ...args(),
    deadline: { when: 'к началу сезона', why: 'пик нагрузки', quote: 'Заказчик: «к сезону»' },
    outOfScope: [{ text: 'учёт запчастей', quote: 'Заказчик: «запчасти не трогаем»' }, 'Не входит: старый формат'],
    agreements: [{ text: 'работа только во внутренней сети', quote: 'Заказчик: «только внутри сети»' }],
  })
  assert.equal(input.smart.t, 'к началу сезона — пик нагрузки')
  assert.deepEqual(input.boundaries, ['Не входит: учёт запчастей', 'Не входит: старый формат', 'Договорённость: работа только во внутренней сети'])
})

test('C11 primaryErrors: «Не входит» без цитаты и нерешённое — ошибка повторного вызова', () => {
  assert.deepEqual(primaryErrors(args()), [])
  const errors = primaryErrors({
    ...args(),
    outOfScope: [
      { text: 'учёт запчастей' },
      { text: 'Порядок назначения исполнителя не согласован — уточняется', quote: 'Заказчик: «пока не решили»' },
      { text: 'Кто назначает исполнителя ремонта', quote: 'Заказчик: «это потом»' },
      { text: 'учёт запчастей', quote: 'Заказчик: «запчасти не трогаем»' },
    ],
    agreements: [{ text: 'только внутренняя сеть' }],
  })
  assert.equal(errors.length, 4)
  assert.match(errors[0], /нет цитаты/)
  assert.match(errors[1], /открытый вопрос/)
  assert.match(errors[2], /открытый вопрос/)
  assert.match(errors[3], /agreements/)
})

test('C1 fast: ASIS заказчика под SMART-таблицей, цитата в R; bft-lint пропускает', { skip: !existsSync(join(SKILLS, 'bft-fast/resources/open_field.md')) }, async () => {
  const a = { ...args(), want: { ...args().want, asis: 'мастер звонит диспетчеру, тот пишет заявку в журнал' } }
  const md = fastDocument(toFastInput(a), { slug: 'zayavka-1', howToDemo: ['Планшет: открыть форму → видна форма'], source: 'тест', skillsPath: SKILLS, date: '2026-01-01' }, 'промт')
  assert.match(md, /\| R \(Relevant\) \| .*Слова заказчика \(R3\): Заказчик: «Сейчас мастер звонит/)
  assert.match(md, /^ASIS \(со слов заказчика\): «мастер звонит диспетчеру, тот пишет заявку в журнал»$/m)
  assert.match(md, /\| БТ-1 \| ремонт ждут по два дня \|/)
  let python = true
  try { execFileSync('python3', ['--version']) } catch { python = false }
  if (!python) return
  const dir = mkdtempSync(join(tmpdir(), 'fast-'))
  try {
    const built = await buildFast(toFastInput(a), { slug: 'zayavka-1', howToDemo: ['Планшет: открыть форму → видна форма'], source: 'тест', skillsPath: SKILLS, date: '2026-01-01' }, dir)
    assert.ok(built.ok, built.ok ? '' : built.errors)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('C1 deep: блок «Слова заказчика» — из цитат primary.json и intake.json; без intake — из primary.json', async () => {
  const a = { ...args(), want: { ...args().want, asis: 'мастер звонит диспетчеру' }, glossary: [{ term: 'ТОиР', meaning: 'техобслуживание и ремонт' }],
    actors: [{ role: 'Мастер участка', count: 'около 40', quote: 'Заказчик: «мастеров человек сорок»' }] }
  const old = customerWordsContext({ args: a }, undefined)
  assert.ok(old.startsWith('Слова заказчика (дословно, R3)'))
  assert.match(old, /Что хочет и зачем: Заказчик: «Сейчас мастер/)
  assert.match(old, /Как сейчас \(ASIS\): «мастер звонит диспетчеру»/)
  assert.match(old, /Акторы \(со слов заказчика\)[\s\S]*Мастер участка — около 40/)
  assert.match(old, /ТОиР — техобслуживание и ремонт/)
  assert.match(old, /Открытые вопросы приёма[\s\S]*Кто назначает исполнителя ремонта/)
  const dir = mkdtempSync(join(tmpdir(), 'intake-'))
  try {
    await mergeIntake(dir, { asis: 'пересказ модели о текущем процессе', glossary: glossaryOf([{ term: 'АРМ', expansion: 'рабочее место' }]), openQuestions: ['Нужен ли офлайн-режим'] })
    await mergeIntake(dir, demoIntake({ asis: 'черновик', unclear: ['Верно ли, что диспетчер получает уведомление?'] }))
    const intake = JSON.parse(readFileSync(join(dir, 'intake.json'), 'utf8'))
    assert.equal(intake.asis, 'пересказ модели о текущем процессе')
    assert.deepEqual(intake.demo, { asis: 'черновик' })
    const words = customerWordsContext({ args: a }, intake)
    assert.ok(!words.includes('пересказ модели'), 'свободный asis тикета — не R3')
    assert.match(words, /АРМ — рабочее место/)
    assert.match(words, /Допущения ассистента[\s\S]*Верно ли, что диспетчер получает уведомление\?/)
    assert.match(words, /Нужен ли офлайн-режим/)
    assert.equal(customerWordsContext(undefined, undefined), '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('C11 старые primary.json: нерешённое из outOfScope не выводится «Не входит», уходит в открытые вопросы', () => {
  const legacy = { ...args(), outOfScope: ['Порядок назначения исполнителя не согласован — уточняется', 'учёт запчастей'] }
  const input = toFastInput(legacy)
  assert.deepEqual(input.boundaries, ['Не входит: учёт запчастей'])
  assert.ok(input.openQuestions.includes('Порядок назначения исполнителя не согласован — уточняется'))
  assert.match(customerWordsContext({ args: legacy }, undefined), /Открытые вопросы приёма[\s\S]*не согласован — уточняется/)
})
