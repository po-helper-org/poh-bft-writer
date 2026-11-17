// Автоправки и проверки канона: граф трассировки, якоря, ссылки, риски,
// адресаты, приоритет (план качества C2, C5, C6, C9, C10).
// Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  anchorLine, anchorRows, anchorsFix, autoFix, check, checkContext, citationDedupFix, cortexIdsFix, dedupLinks,
  dependencyAddresseeFix, linkGraphFix, priorityFix, REPORT_ONLY, riskRatingFix, RULES,
} from '../lib-test/canon-check.js'
import { canonOf } from '../lib-test/quality-metrics.js'
import { deepPrompt, SOFT_ON_LAST } from '../lib-test/bft-deep.js'
import { toFastInput } from '../lib-test/primary.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GOLDEN = join(ROOT, 'skills/bft-deep-swarm/examples/golden_deep_document.md')
const LINT = join(ROOT, 'skills/bft-writer/scripts/bft-lint.py')
const golden = readFileSync(GOLDEN, 'utf8')
const goldenHead = golden.slice(0, golden.indexOf('## Проблема которую решаем'))

// Нейтральный домен (не из заявок портала): библиотека, бронь книги.
const FAST = `---
stage: fast
---

# [БФТ] lib-1: Бронь книги в библиотеке

### Цель

| SMART | Значение |
|---|---|
| A (Achievable) | Команды: Каталог, Команда уведомлений, Юр отдел · Проработать: сроки брони |

### How to demo

1. Читатель открывает карточку книги → кнопка «Забронировать»
2. Нажимает «Забронировать» → статус «Забронирована», уведомление читателю

### Критичные требования (скелет на цитатах)

| ID | ASIS (сейчас) | TOBE (после) | Связанные | Источник (цитата) |
|---|---|---|---|---|
| БТ-1 | [ASIS не озвучен] | Читатель бронирует книгу без звонка |  | Заказчик: «хотим бронь без звонка» |
| ПТ-1 | [ASIS не озвучен] | Читатель бронирует книгу на карточке | БТ-1 | Заказчик: «хотим бронь без звонка» |
| ФТ-1 | [ASIS не озвучен] | Книга получает статус «Забронирована» | БТ-1 | Сценарий приёмки (согласован): «статус Забронирована» |

### Общая информация
`

const CANON = `## Проблема которую решаем

| Срез | Содержание |
| --- | --- |
| **ASIS** | \`[ASIS не озвучен]\` |

## Изменение в UJM

| Точка демо | Было (As-Is) | Стало (To-Be) |
| --- | --- | --- |
| Карточка книги | [ASIS не озвучен] | Кнопка «Забронировать» (ПТ-1) |

## План демонстрации

### Акторы

| Актор | Описание |
| --- | --- |
| Читатель | Бронирует книгу |
| Библиотекарь | Выдаёт книгу |

### Сценарий приёмки (happy path + alt)

\`\`\`plantuml
@startuml
actor "Читатель" as R
actor "Библиотекарь" as L
participant "Каталог" as C
R -> C: бронирует
alt Книга уже выдана
  C --> R: бронь недоступна
end
@enduml
\`\`\`

| What-if | Есть источник? | Результат |
| --- | --- | --- |
| Книга уже выдана | Нет | [УТОЧНИТЬ] |

## Бизнес-Требования

## Ценность разрабатываемого функционала для бизнес-заказчиков*

| Идентификатор | Наименование требования | Ценность | Краткое описание | Связанные требования |
| --- | --- | --- | --- | --- |
| БТ-1 | Бронь без звонка | Меньше звонков | Кнопка брони | ПТ-1 |

## Пользовательские требования*

| Идентификатор | Наименование требования | Story | Комментарий | Связанные требования |
| --- | --- | --- | --- | --- |
| ПТ-1 | Бронь на карточке | **Когда** я (читатель) … | — | БТ-1, ФТ-9 |

## Требования к интерфейсам*

| Идентификатор | Наименование требования | Требование к пользовательскому интерфейсу | Предложения | Связанные требования |
| --- | --- | --- | --- | --- |
| ИТ-1 | Кнопка брони | Кнопка «Забронировать» на карточке | [УТОЧНИТЬ] |  |

## Функциональные требования*

| Идентификатор | Наименование требования | Приоритет | Функциональные требования | Параметры, ограничения | Связанные требования |
| --- | --- | --- | --- | --- | --- |
| ФТ-1 | Статус брони | Высокий | Книга получает статус «Забронирована» | [УТОЧНИТЬ у Каталога] | ПТ-1 |
| ФТ-2 | Дефект брони | Средний (предварительно) | Учесть дефект [Jira LIB-7](https://jira.test/browse/LIB-7), см. [Jira LIB-7](https://jira.test/browse/LIB-7) и [Wiki](https://wiki.test/pages/viewpage.action?pageId=99): [Jira LIB-7](https://jira.test/browse/LIB-7) | Срок брони — [УТОЧНИТЬ у PO: сколько дней?] | НФТ-3 |

## Нефункциональные требования*

| Идентификатор | Наименование требования | Описание | Связанные требования |
| --- | --- | --- | --- |

## Зависимости

| Команда / система | Тип зависимости | Статус согласования |
| --- | --- | --- |
| Каталог | Хранение брони | [УТОЧНИТЬ] |
| Юристы | Правила | [УТОЧНИТЬ] |

## Риски

| Риск | Вероятность | Влияние | Митигация |
| --- | --- | --- | --- |
| Книги не возвращают вовремя | Высокая | Среднее | Напоминания |
| Пересечение с [Jira LIB-7](https://jira.test/browse/LIB-7) | Средняя | Высокое | Сверить объём |

## Якоря истины

| Факт в БФТ | Источник (якорь) | Ранг | Тип |
| --- | --- | --- | --- |
| Бронь без звонка | Шапка bft-fast, Критичные требования | R3 | Озвучено заказчиком |
| Похожая система | \`sys-catalog\` — Карта контекста | R2 | Корпоративный источник |
| Старая бронь | [Jira LIB-7](https://jira.test/browse/LIB-7) | R2 | Корпоративный источник (указатель) |
| Чужая интеграция | [Jira LIB-8](https://jira.test/browse/LIB-8) | — | Не релевантно |
| Сроки брони | не обсуждалось | — | [УТОЧНИТЬ у PO] |
`

const SOURCES = `# Корпоративные источники

## LIB-7 · Бронь книг падает
Jira · LIB · Задача · Открыт · 2025-03-01
Тип: Задача · Статус: открыт
Отношение к заявке: та же функция
Ссылка для БФТ: [Jira LIB-7](https://jira.test/browse/LIB-7)

> бронь не сохраняется
`

const ctxOf = (extra = {}) => checkContext({ fastMd: FAST, sourcesMd: SOURCES, anchor: anchorLine({ people: [{ name: 'Петров Пётр', role: 'Заказчик' }], approvedAt: '2026-11-05T10:00:00Z', taskId: 7 }), ...extra })

test('C6 anchorLine: ФИО заказчика, дата по Москве, номер заявки; чего нет — [УТОЧНИТЬ]', () => {
  assert.equal(anchorLine({ people: [{ name: 'Сидоров', role: 'PO' }, { name: 'Петров Пётр', role: 'Заказчик' }], approvedAt: '2026-11-04T22:30:00Z', taskId: 7 }),
    'Заказчик Петров Пётр, согласовано 05.11.2026, заявка #7')
  assert.equal(anchorLine({ people: [{ name: 'Сидоров' }] }), 'Заказчик Сидоров, согласовано [УТОЧНИТЬ: дата согласования], заявка [УТОЧНИТЬ: номер заявки]')
  assert.match(anchorLine({}), /^Заказчик \[УТОЧНИТЬ: ФИО заказчика\]/)
})

test('C6 anchorRows: одна цитата — одна строка, «Заказчик:» снимается; плюс сценарий приёмки', () => {
  const rows = anchorRows(ctxOf())
  assert.equal(rows.length, 3)
  assert.equal(rows[0].fact, 'Читатель бронирует книгу без звонка (БТ-1); Читатель бронирует книгу на карточке (ПТ-1)')
  assert.equal(rows[0].source, 'Заказчик Петров Пётр, согласовано 05.11.2026, заявка #7: «хотим бронь без звонка»')
  assert.equal(rows[1].source, 'Заказчик Петров Пётр, согласовано 05.11.2026, заявка #7: Сценарий приёмки (согласован): «статус Забронирована»')
  assert.equal(rows[2].fact, 'Сценарий приёмки (How to demo)')
})

test('C6 autoFix «Якоря»: R3 — кодом, мусорные строки удалены, тип R2 по ссылке; повторный проход ничего не меняет', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [cortexIdsFix, anchorsFix])
  const anchors = fixed.canon.slice(fixed.canon.indexOf('## Якоря истины'))
  assert.ok(!anchors.includes('Шапка bft-fast'), 'R3 модели удалён')
  assert.ok(!anchors.includes('Похожая система'), 'карта контекста без ссылки удалена')
  assert.ok(!anchors.includes('Чужая интеграция'), 'нерелевантное удалено')
  assert.ok(anchors.includes('| Сроки брони | не обсуждалось | — | [УТОЧНИТЬ у PO] |'))
  assert.ok(anchors.includes('| Старая бронь | [Jira LIB-7](https://jira.test/browse/LIB-7) | R2 | Jira |'))
  const lines = anchors.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Факт') && !l.startsWith('| ---'))
  assert.match(lines[0], /\| R3 \| Решение заказчика \|$/)
  // Раунд 6: код собирает R3 только по ID скелета (и сценарий приёмки); строк по словам и «источник не назван» не сочиняет.
  assert.equal(lines.filter((l) => l.includes('| R3 |')).length, 3)
  assert.ok(!anchors.includes('Источник требования не назван'), anchors)
  assert.ok(!lines.some((l) => l.startsWith('| Кнопка брони (ИТ-1) |')), anchors)
  assert.deepEqual(autoFix(fixed.canon, ctx, [cortexIdsFix, anchorsFix]).log, [])
})

test('C6 autoFix «Якоря»: таблицы нет — добавляется; без якоря строки R3 не трогаются', () => {
  const bare = '## Риски\n\nРиски заказчиком не названы.\n\n## Якоря истины\n\nЯкорей нет.\n'
  const fixed = autoFix(bare, ctxOf(), [anchorsFix])
  assert.match(fixed.canon, /Якорей нет\.\n\n\| Факт в БФТ \| Источник \(якорь\) \| Ранг \| Тип \|\n\| --- \| --- \| --- \| --- \|\n\| Читатель/)
  const noAnchor = checkContext({ fastMd: FAST })
  const plain = autoFix(CANON.replace('Шапка bft-fast, Критичные требования', 'Петров, 01.11.2026, письмо'), noAnchor, [anchorsFix]).canon
  assert.ok(plain.includes('| Бронь без звонка | Петров, 01.11.2026, письмо | R3 |'), 'без R3-якоря строки R3 модели остаются')
  assert.ok(!plain.includes('Сценарий приёмки (How to demo)'))
})

test('C5 dedupLinks: повтор — ключом в `код`, хвост «: [ссылка]» убирается', () => {
  assert.equal(dedupLinks('Учесть [Jira AB-1](https://j.test/browse/AB-1), см. [Jira AB-1](https://j.test/browse/AB-1) и [W](https://w.test/pages/x?pageId=1): [Jira AB-1](https://j.test/browse/AB-1)'),
    'Учесть [Jira AB-1](https://j.test/browse/AB-1), см. `AB-1` и [W](https://w.test/pages/x?pageId=1)')
  assert.equal(dedupLinks('[W](https://w.test/a) и снова [W2](https://w.test/a) тут'), '[W](https://w.test/a) и снова W2 тут')
  const fixed = autoFix(CANON, ctxOf(), [citationDedupFix])
  assert.equal(fixed.log.length, 1)
  assert.ok(fixed.canon.includes('см. `LIB-7` и [Wiki]'))
})

test('C5 autoFix рисков: оценка без «подтверждено» и без ссылки → [УТОЧНИТЬ у PO]', () => {
  const fixed = autoFix(CANON, ctxOf(), [riskRatingFix])
  assert.ok(fixed.canon.includes('| Книги не возвращают вовремя | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | Напоминания |'))
  assert.ok(fixed.canon.includes('| Средняя | Высокое | Сверить объём |'), 'со ссылкой на находку — оценка остаётся')
  assert.equal(fixed.log.length, 2)
})

test('C2 linkGraph: висящие ID убраны, путь к БТ, в БТ — все ссылающиеся', () => {
  const fixed = autoFix(CANON, ctxOf(), [linkGraphFix])
  assert.ok(fixed.canon.includes('| ПТ-1 | Бронь на карточке | **Когда** я (читатель) … | — | БТ-1 |'), 'ФТ-9 убран')
  // Раунд 5: ИТ без ПТ получает ПТ (каскад вверх, TR002).
  assert.match(fixed.canon, /\| ИТ-1 \| Кнопка брони \|.*\| БТ-1, ПТ-1 \|/, 'ИТ без пути к БТ получил БТ-1, без ПТ — ПТ-1')
  assert.match(fixed.canon, /\| ФТ-2 \| Дефект брони \|.*\| БТ-1 \|/, 'НФТ-3 нет — убран, затем БТ-1')
  // Раунд 4: ПТ и ФТ ссылаются на БТ напрямую (ФТ-1 шёл к БТ через ПТ-1); «Связанные» БТ — все, кто ссылается.
  assert.match(fixed.canon, /\| ФТ-1 \| Статус брони \|.*\| БТ-1, ПТ-1 \|/)
  assert.ok(fixed.canon.includes('| БТ-1 | Бронь без звонка | Меньше звонков | Кнопка брони | ПТ-1, ИТ-1, ФТ-1, ФТ-2 |'))
  assert.deepEqual(autoFix(fixed.canon, ctxOf(), [linkGraphFix]).log, [])
})

test('C9 адресат «Зависимостей»: команда из «Команд» шапки; чужая строка — без правки', () => {
  const fixed = autoFix(CANON, ctxOf(), [dependencyAddresseeFix])
  assert.ok(fixed.canon.includes('| Каталог | Хранение брони | [УТОЧНИТЬ у команды «Каталог»] |'))
  assert.ok(fixed.canon.includes('| Юристы | Правила | [УТОЧНИТЬ] |'))
  const named = autoFix(CANON.replace('| Каталог | Хранение брони |', '| Команда уведомлений | Письмо |'), ctxOf(), [dependencyAddresseeFix])
  assert.ok(named.canon.includes('| Команда уведомлений | Письмо | [УТОЧНИТЬ у команды уведомлений] |'))
})

test('C10 приоритет: голый — «(предварительно)», если в fast его нет; с пометкой — без правки', () => {
  const fixed = autoFix(CANON, ctxOf(), [priorityFix])
  assert.ok(fixed.canon.includes('| ФТ-1 | Статус брони | Высокий (предварительно) |'))
  assert.equal(fixed.log.length, 1)
  assert.deepEqual(autoFix(CANON, checkContext({ fastMd: `${FAST}\n| Приоритет | Высокий |` }), [priorityFix]).log, [])
})

test('проверки портала: SK001, CT001, CT002, CV001 — ERROR; CV002, UT001, FT002 — WARN', () => {
  const doc = CANON.replace('| ФТ-1 | Статус брони |', '| ФТ-5 | Статус брони |')
    .replace('| Сроки брони | не обсуждалось |', '| Внешнее | [Jira ZZZ-1](https://jira.test/browse/ZZZ-1) | R2 | Jira |\n| Сроки брони | не обсуждалось |')
  const { errors, warnings } = check(doc, ctxOf())
  const codes = (list) => [...new Set(list.map((f) => f.code))].sort()
  // CT005: LIB-7 — открытая «Задача» той же функции: параллельная работа («Зависимости»), не риск.
  // CV001 (раунд 4) — ERROR: пробел покрытия How to demo закрывает модель на повторе, код ФТ не дописывает.
  // CV005 (раунд 6) — ERROR: ветка-отклонение без ФТ уходит модели на повтор.
  assert.deepEqual(codes(errors), ['CT001', 'CT002', 'CT005', 'CV001', 'CV005', 'SK001'])
  assert.ok(errors.find((e) => e.code === 'SK001').message.startsWith('ФТ-1'))
  assert.ok(errors.some((e) => e.code === 'CT002' && e.message.includes('ZZZ-1')))
  assert.ok(errors.some((e) => e.code === 'CT002' && e.message.includes('pageId=99')), 'страница не из карты находок')
  assert.ok(!errors.some((e) => e.code === 'CT002' && e.message.includes('LIB-7')), 'ссылка из карты находок')
  assert.ok(errors.find((e) => e.code === 'CT001').message.includes('LIB-7'))
  assert.deepEqual(codes(warnings), ['CV002', 'FT002', 'UT001'])
  assert.ok(errors.some((e) => e.code === 'CV005' && e.message.includes('Книга уже выдана')), 'ветка-отклонение без ФТ — ERROR, ФТ код не пишет')
  // CV002: у библиотекаря нет ПТ; CV001: уведомления нет ни в одном требовании.
  assert.ok(warnings.some((w) => w.code === 'CV002' && w.message.includes('Библиотекарь')))
  assert.ok(errors.some((e) => e.code === 'CV001' && e.message.includes('уведомление')))
})

test('CT003: открытая «Ошибка» той же функции не в «Рисках» — ERROR с готовой строкой (мягкая на последней попытке); DUP001 — только отчёт', () => {
  const bug = SOURCES.replace('Тип: Задача', 'Тип: Ошибка (дефект)')
  const doc = CANON.replace('| Пересечение с [Jira LIB-7](https://jira.test/browse/LIB-7) |', '| Пересечение |')
  const err = check(doc, ctxOf({ sourcesMd: bug })).errors.find((w) => w.code === 'CT003')
  assert.ok(err && err.message.includes('[Jira LIB-7](https://jira.test/browse/LIB-7)'), 'сообщение говорит модели, какую строку дописать')
  assert.ok(SOFT_ON_LAST.has('CT003') && SOFT_ON_LAST.has('CV005'))
  assert.ok(!check(CANON, ctxOf({ sourcesMd: bug })).errors.some((w) => w.code === 'CT003'))
  assert.ok(REPORT_ONLY.has('DUP001'))
})

test('FIXES целиком: эталон со своей шапкой — меняется только ASIS-пояснение; проверки без замечаний', () => {
  const ctx = checkContext({ fastMd: goldenHead })
  const fixed = autoFix(canonOf(golden), ctx)
  assert.equal(fixed.log.length, 1, fixed.log.join('\n'))
  assert.match(fixed.log[0], /ASIS/)
  // LK001 — хвост эталона (промт Claude Code навыка), см. c8.test.mjs.
  assert.deepEqual(check(golden, ctx, RULES.filter((r) => r.code !== 'LK001')), { errors: [], warnings: [] })
})

test('эталон: в каноне нет сущностей из чужого проекта (возвраты, PartnerX)', () => {
  const canon = canonOf(golden)
  for (const word of ['PartnerX', 'возврат', 'Вернуть', 'Невозвратн']) assert.ok(!canon.includes(word), word)
  assert.ok(!golden.includes('у Анне'), 'падеж: «у Анны»')
})

test('C2 toFastInput: нет строки «зачем» — БТ-1 из want.why; остальные ссылаются на БТ-1', () => {
  const input = toFastInput({
    title: 'Бронь книги',
    want: { what: 'Бронь книги онлайн', why: 'Меньше звонков в библиотеку', quote: 'Заказчик: «хотим меньше звонков»' },
    requirements: [{ kind: 'пользователю', text: 'Читатель бронирует книгу', quote: 'Заказчик: «бронировать сам»' }],
  })
  assert.deepEqual(input.requirements.map((r) => [r.id, r.tobe, r.related ?? []]), [
    ['БТ-1', 'Меньше звонков в библиотеку', []],
    ['ПТ-1', 'Читатель бронирует книгу', ['БТ-1']],
  ])
  assert.equal(input.requirements[0].source, 'Заказчик: «хотим меньше звонков»')
})

test('C6 deepPrompt: R3-якорь отдельной строкой; «Критичные требования» — только вход', () => {
  const { user, system } = deepPrompt(golden, FAST, '', undefined, 'Заказчик Петров Пётр, согласовано 05.11.2026, заявка #7')
  assert.ok(user.includes('R3-якорь: Заказчик Петров Пётр, согласовано 05.11.2026, заявка #7'))
  assert.ok(user.includes('«Критичные требования» — только вход'))
  assert.ok(system.includes('строки R3 по ID «Критичных требований» добавит система'))
  assert.ok(system.includes('Отношение к заявке'), 'правила говорят, как использовать вердикт триажа')
})

test('bft-lint: канон после автоправок проходит якоря, риски и граф без ERROR', { skip: !existsSync(LINT) }, () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx).canon
  const doc = `${goldenHead}\n${fixed}\n\n## Продолжить / уточнить БФТ\n\nхвост\n`
  const dir = mkdtempSync(join(tmpdir(), 'canon-rules-'))
  try {
    const path = join(dir, 'doc.md')
    writeFileSync(path, doc)
    let out
    try {
      out = execFileSync('python3', [LINT, '--format', 'json', path], { encoding: 'utf8' })
    } catch (e) {
      if (e.code === 'ENOENT') return
      out = e.stdout
    }
    const codes = Object.values(JSON.parse(out)).flat().filter((f) => f.level === 'ERROR').map((f) => f.code)
    for (const code of ['TR001', 'RK002', 'AN001', 'AN002', 'AN003']) assert.ok(!codes.includes(code), `${code}: ${out}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
