// Раунд 2 качества: существующее решение, происхождение рисков и статусов,
// R2/R3-якоря, покрытие сценария, утечки эталона, ASIS в «Проблеме».
// Нейтральный домен (не из заявок портала): прокат велосипедов.
// Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  anchorLine, anchorsFix, autoFix, check, checkContext, coverageChecklist, coverageGaps, dependenciesFix, existingSolutions,
  goldenLeakFix, goldenLeaks, nftThresholdFix, parseSources, portalProseFix, problemAsisFix, risksFix, unsurfacedExisting,
} from '../lib-test/canon-check.js'
import { qualityMetrics } from '../lib-test/quality-metrics.js'
import { deepPrompt, goldenCanon } from '../lib-test/bft-deep.js'
import { parseCanon } from '../lib-test/canon-table.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const golden = readFileSync(join(ROOT, 'skills/bft-deep-swarm/examples/golden_deep_document.md'), 'utf8')

const FAST = `---
stage: fast
---

# [БФТ] bike-1: Прокат велосипеда по QR

### Цель

| SMART | Значение |
|---|---|
| A (Achievable) | Команды: Команда приложения, Тарификатор · Согласования: Согласование тарифа с юристами |

### How to demo

1. Клиент сканирует QR на стойке → велосипед разблокирован, статус «В аренде»
2. Клиент возвращает велосипед → статус «Завершена», уведомление клиенту

### Критичные требования (скелет на цитатах)

| ID | ASIS (сейчас) | TOBE (после) | Связанные | Источник (цитата) |
|---|---|---|---|---|
| БТ-1 | [ASIS не озвучен] | Прокат без кассы | | Заказчик: «хотим прокат без кассы» |
| ПТ-1 | [ASIS не озвучен] | Клиент берёт велосипед по QR | БТ-1 | Заказчик: «сканирует QR и едет» |
`

const PRIMARY = {
  args: {
    title: 'Прокат велосипеда по QR',
    want: { what: 'Клиент берёт велосипед по QR без кассы', why: 'Сейчас очередь в кассу занимает до часа', quote: 'Заказчик: «Сейчас очередь в кассу занимает до часа. Хотим прокат без кассы, сканирует QR и едет»' },
    requirements: [{ kind: 'пользователю', text: 'Клиент берёт велосипед по QR', quote: 'Заказчик: «сканирует QR и едет»' }],
    achievable: { teams: ['Команда приложения', 'Тарификатор'], approvals: ['Согласование тарифа с юристами'], questions: ['Формат чека для клиента'] },
    openQuestions: ['Согласование тарифа с юристами не проведено'],
    people: [{ name: 'Орлова Нина', role: 'Заказчик' }],
  },
}

const SOURCES = `# Корпоративные источники

## Про ту же систему или функцию — факты (R2, со ссылкой)

## Аренда самокатов по QR в приложении
Confluence · RENT · page · 2025-04-01
Тип: Страница вики
Ссылка для БФТ: [Confluence: Аренда самокатов по QR](https://wiki.test/pages/viewpage.action?pageId=501)
Отношение к заявке: та же функция
Факты (цитаты сверены с текстом находки):
- Самокат разблокируется сканированием QR в приложении через сервис ДОКСТ. — «Разблокировка через ДОКСТ по QR»
- Аренда длится не более 3 часов. — «Аренда — не более 3 часов»

ДОКСТ отвечает за замки. ДОКСТ шлёт статус в приложение.

## RENT-12 · Перенос модуля аренды в новое приложение
Jira · RENT · Epic · Закрыт · 2025-02-01
Тип: Эпик (объём работ) · Статус: закрыт
Ссылка для БФТ: [Jira RENT-12](https://jira.test/browse/RENT-12)
Отношение к заявке: та же система
Факты (цитаты сверены с текстом находки):
- Модуль аренды переехал в новое приложение. — «Перенос модуля аренды в новое приложение»

## Смежные и без вердикта — только как указатель

## RENT-40 · Касса падает при оплате картой
Jira · RENT · Ошибка · Открыт · 2026-01-10
Тип: Ошибка (дефект) · Статус: открыт
Ссылка для БФТ: [Jira RENT-40](https://jira.test/browse/RENT-40)
Отношение к заявке: смежное
`

const CANON = `## Проблема которую решаем

| Срез | Содержание |
| --- | --- |
| **ASIS** | Очередь в кассу |
| **ПРОБЛЕМА** | Клиент ждёт в очереди; велосипеды сейчас не могут выдаваться без кассира. Эффект — [УТОЧНИТЬ у Орловой Нины: какой?] |

## План демонстрации

### Акторы

| Актор | Описание |
| --- | --- |
| Клиент | Берёт велосипед |

### Сценарий приёмки (happy path + alt)

\`\`\`plantuml
@startuml
actor "Клиент" as C
participant "Приложение" as App
C -> App: сканирует QR
alt Велосипед разблокирован
  App --> C: статус «В аренде»
else Замок не открылся
  App --> C: [УТОЧНИТЬ у Орловой Нины: что видит клиент?]
end
@enduml
\`\`\`

## Бизнес-Требования

## Ценность разрабатываемого функционала для бизнес-заказчиков*

| Идентификатор | Наименование требования | Ценность | Краткое описание | Связанные требования |
| --- | --- | --- | --- | --- |
| БТ-1 | Прокат без кассы | Нет очереди | QR | ПТ-1 |

## Пользовательские требования*

| Идентификатор | Наименование требования | Story | Комментарий | Связанные требования |
| --- | --- | --- | --- | --- |
| ПТ-1 | Аренда по QR | **Когда** я (клиент) у стойки **Я хочу** взять велосипед по QR | Статус «В аренде», «Завершена», уведомление | БТ-1 |

## Функциональные требования*

| Идентификатор | Наименование требования | Приоритет | Функциональные требования | Параметры, ограничения | Связанные требования |
| --- | --- | --- | --- | --- | --- |
| ФТ-1 | Разблокировка велосипеда | Высокий (предварительно) | Велосипед разблокируется после сканирования QR, статус «В аренде» | Максимальная длительность аренды — [УТОЧНИТЬ у Орловой Нины: сколько часов?] | ПТ-1 |

## Нефункциональные требования*

| Идентификатор | Наименование требования | Описание | Связанные требования |
| --- | --- | --- | --- |
| НФТ-1 | Время выдачи | Выдача велосипеда не должна превышать часа | ФТ-1 |

Других измеримых порогов на встрече не звучало — не выдумываются.

## Зависимости

| Команда / система | Тип зависимости | Статус согласования |
| --- | --- | --- |
| Команда приложения | Экран сканирования QR | В работе |
| Тарификатор | Расчёт стоимости | Ранее похожая работа: [Jira RENT-40](https://jira.test/browse/RENT-40) |

## Риски

PO подтвердил один организационный риск; неподтверждённые в таблицу не заводятся.

| Риск | Вероятность | Влияние | Митигация |
| --- | --- | --- | --- |
| Тариф не согласован с юристами | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | Согласовать до старта |
| Касса может упасть — [Jira RENT-40](https://jira.test/browse/RENT-40) | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | Сверить |
| Велосипеды угонят | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | Поставить трекеры |

## Якоря истины

| Факт в БФТ | Источник (якорь) | Ранг | Тип |
| --- | --- | --- | --- |
| Клиент берёт велосипед по QR (ПТ-1) | Заказчик Орлова Нина, согласовано 16.11.2026, заявка #9: «сканирует QR и едет» | R3 | Решение заказчика |
| Клиент берёт велосипед по QR (ПТ-1) | Заказчик Орлова Нина, согласовано 16.11.2026, заявка #9: «сканирует QR и едет» | R3 | Решение заказчика |
`

const anchor = anchorLine({ people: PRIMARY.args.people, approvedAt: '2026-11-16T09:00:00Z', taskId: 9 })
const ctxOf = (extra = {}) => checkContext({ fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY, anchor, golden: goldenCanon(golden), ...extra })
const section = (text, title) => { const s = text.indexOf(`## ${title}`); const e = text.indexOf('\n## ', s + 3); return text.slice(s, e < 0 ? undefined : e) }

test('sources.md: факты триажа разбираются; существующее решение — только «та же функция» (не «та же система»), без ошибок', () => {
  const findings = parseSources(SOURCES)
  assert.deepEqual(findings[0].facts.map((f) => f.quote), ['Разблокировка через ДОКСТ по QR', 'Аренда — не более 3 часов'])
  assert.deepEqual(existingSolutions(findings).map((f) => f.id), ['501'])
  assert.deepEqual(unsurfacedExisting(CANON, findings).map((f) => f.id), ['501'])
})

test('риски (раунд 6): код только чистит — строк пересечения и ошибок не сочиняет; согласование и риск без источника — вон, смежная ссылка снята, проза — вон', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [risksFix])
  const risks = section(fixed.canon, 'Риски')
  assert.ok(!risks.includes('Пересечение с решением'), 'строку пересечения пишет модель, не код')
  assert.ok(!risks.includes('RENT-12'), '«та же система» — не существующее решение того же действия')
  assert.ok(!risks.includes('PO подтвердил'), 'проза раздела удалена')
  assert.ok(!risks.includes('угонят'), 'риск без источника удалён')
  assert.ok(!risks.includes('RENT-40'), 'смежная ссылка — не основание риска')
  assert.ok(!risks.includes('Согласование тарифа'), 'пункт согласования — не риск')
  assert.ok(!section(fixed.canon, 'Зависимости').includes('| Согласование | Согласование тарифа с юристами |'), 'код строк в «Зависимости» не переносит')
  assert.deepEqual(autoFix(fixed.canon, ctx, [risksFix]).log, [], 'повторный проход ничего не меняет')
  // Пропуск решения того же действия — замечание модели с готовой формой строки.
  const ct004 = check(fixed.canon, ctx).warnings.find((w) => w.code === 'CT004')
  assert.ok(ct004 && ct004.message.includes('Пересечение с решением [Confluence: Аренда самокатов по QR]'), ct004?.message)
})

test('риски: ничего не осталось — ровно «Риски заказчиком не названы.»; без primary.json (навык) — проза и строки модели не трогаются', () => {
  const noFindings = ctxOf({ sourcesMd: '' })
  const fixed = autoFix(CANON, noFindings, [risksFix]).canon
  assert.equal(section(fixed, 'Риски').trim(), '## Риски\n\nРиски заказчиком не названы.')
  const skill = autoFix(CANON, checkContext({ fastMd: FAST }), [risksFix])
  assert.deepEqual(skill.log, [])
})

test('риски: митигация без источника → [УТОЧНИТЬ у PO]; строка со словами заказчика остаётся', () => {
  const said = CANON.replace('| Велосипеды угонят |', '| Очередь в кассу занимает до часа |')
  const fixed = autoFix(said, ctxOf({ sourcesMd: '' }), [risksFix]).canon
  assert.ok(fixed.includes('| Очередь в кассу занимает до часа | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO: как снижаем риск?] |'), fixed)
})

test('зависимости: «В работе» без источника → маркер команде; «ранее» у открытой задачи снято; строк код не добавляет (раунд 6)', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [dependenciesFix])
  const deps = section(fixed.canon, 'Зависимости')
  assert.ok(deps.includes('| Команда приложения | Экран сканирования QR | [УТОЧНИТЬ у команды приложения: статус?] |'), deps)
  assert.ok(deps.includes('| Похожая работа: [Jira RENT-40]'), 'RENT-40 открыта — «ранее» неверно')
  assert.ok(!deps.includes('ДОКСТ'), 'система существующего решения — не строка от кода')
  assert.deepEqual(autoFix(fixed.canon, ctx, [dependenciesFix]).log, [], 'повторный проход ничего не меняет')
})

test('якоря (раунд 6): R2 код не сочиняет — пропуск ловит WARN AN101; R3 без повторов ID, факт — наименование строки канона', () => {
  const ctx = ctxOf()
  const body = CANON.replace('| Расчёт стоимости |', '| Расчёт стоимости по [Confluence: Аренда самокатов по QR](https://wiki.test/pages/viewpage.action?pageId=501) и [Jira RENT-12](https://jira.test/browse/RENT-12) |')
  const fixed = autoFix(body, ctx, [anchorsFix])
  const anchors = section(fixed.canon, 'Якоря истины').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Факт') && !l.startsWith('| ---'))
  const r2 = anchors.filter((l) => l.includes('| R2 |'))
  assert.equal(r2.length, 0, 'строки R2 пишет модель')
  const an101 = check(fixed.canon, ctx).warnings.filter((w) => w.code === 'AN101')
  assert.ok(an101.some((w) => w.message.includes('pageId=501') && w.message.includes('R2 | Confluence')), an101.map((w) => w.message).join('\n'))
  assert.ok(!an101.some((w) => w.message.includes('RENT-40')), 'смежная RENT-40 — не обязательный якорь')
  const r3Ids = anchors.filter((l) => l.includes('| R3 |')).flatMap((l) => l.match(/\((?:БТ|ПТ|ИТ|ФТ|НФТ)-\d+\)/g) ?? [])
  assert.equal(new Set(r3Ids).size, r3Ids.length, 'ID в R3 не повторяются')
  assert.ok(anchors.some((l) => l.startsWith('| Аренда по QR (ПТ-1) |')), 'факт R3 — наименование из канона')
  assert.deepEqual(autoFix(fixed.canon, ctx, [anchorsFix]).log, [])
})

test('покрытие (раунд 4): код находит пробелы, а требований не пишет — чек-лист в первом промте, CV001/CV005 на повторе', () => {
  const ctx = ctxOf()
  // Статус «Завершена» и уведомление — только в комментарии ПТ; ветка «Замок не открылся» — без ФТ.
  const gaps = coverageGaps(parseCanon(CANON), FAST)
  assert.deepEqual(gaps.map((g) => `${g.kind}:${g.what}`), ['status:Завершена', 'notification:уведомление', 'branch:Замок не открылся'])
  // Цепочка автоправок ФТ не добавляет: ни строк, ни мета-текста «(шаг N сценария приёмки)», «в «Параметрах»».
  const fixed = autoFix(CANON, ctx).canon
  const ft = section(fixed, 'Функциональные требования')
  assert.equal(ft.split('\n').filter((l) => /^\| ФТ-\d+/.test(l)).length, 1, ft)
  assert.doesNotMatch(fixed, /сценария приёмки\)|— в «Параметрах»|что видит клиент и что происходит/)
  // Пробел How to demo и ветка без ФТ — ERROR (повтор модели, раунд 6 — и для ветки).
  const { errors } = check(fixed, ctx)
  assert.ok(errors.some((e) => e.code === 'CV001' && e.message.includes('«Завершена»') && e.message.includes('шаг 2')))
  assert.ok(errors.some((w) => w.code === 'CV005' && w.message.includes('Замок не открылся')))
  // Чек-лист из How to demo — только в первой попытке.
  const list = coverageChecklist(FAST)
  assert.ok(list.some((l) => l.includes('статус «Завершена»') && l.startsWith('Шаг 2')))
  assert.ok(list.some((l) => l.startsWith('Шаг 2: уведомление')))
  assert.ok(list.some((l) => l.includes('Тарификатор')), 'системы из «Команд» — участники сценария')
  assert.ok(list.some((l) => l.startsWith('Каждая ветка-отклонение')), 'ветки-отклонения — в чек-листе первой попытки')
  assert.ok(coverageChecklist('# [БФТ] x: Без демо\n').some((l) => l.startsWith('Каждая ветка-отклонение')), 'и без How to demo')
  const first = deepPrompt(golden, FAST, '').user
  assert.match(first, /Чек-лист покрытия/)
  assert.doesNotMatch(deepPrompt(golden, FAST, '', { canon: 'x', errors: 'ERROR CV001 …' }).user, /Чек-лист покрытия/)
  // Метрика покрытия осталась.
  assert.equal(qualityMetrics({ doc: CANON, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics.alt_covered, 0, 'строки «что если» и ПТ ветку не закрывают')
})

test('НФТ: порог из слов о текущем состоянии — не цель; проза под таблицей НФТ и «на встрече» — вон', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [portalProseFix, nftThresholdFix])
  const nft = section(fixed.canon, 'Нефункциональные требования')
  assert.ok(nft.includes('| НФТ-1 | Время выдачи | Целевое значение — [УТОЧНИТЬ у заказчика: какой порог считать достигнутым?] | ФТ-1 |'), nft)
  assert.ok(!nft.includes('встрече') && !nft.includes('Других измеримых'))
})

test('ПРОБЛЕМА без ASIS заказчика: «сейчас не могут» — догадка → [ASIS не озвучен]; ASIS озвучен — без правки', () => {
  const noAsis = { args: { ...PRIMARY.args, want: { what: 'Прокат по QR', why: 'Хотим прокат без кассы', quote: 'Заказчик: «хотим прокат без кассы»' } } }
  const fixed = autoFix(CANON, ctxOf({ primary: noAsis }), [problemAsisFix])
  assert.ok(fixed.canon.includes('| **ПРОБЛЕМА** | Клиент ждёт в очереди; `[ASIS не озвучен]`. Эффект — [УТОЧНИТЬ у Орловой Нины: какой?] |'), fixed.canon)
  assert.equal(qualityMetrics({ doc: CANON, fastMd: FAST, primary: noAsis }).metrics.invented_asis, 1)
  const known = { args: { ...PRIMARY.args, want: { ...PRIMARY.args.want, asis: 'очередь в кассу' } } }
  assert.deepEqual(autoFix(CANON, ctxOf({ primary: known }), [problemAsisFix]).log, [])
})

test('эталон: дословная проза из образца удаляется, метрика golden_ngram_leaks считает её', () => {
  const g = goldenCanon(golden)
  assert.equal(goldenLeaks(CANON, g).length, 1)
  const fixed = autoFix(CANON, ctxOf(), [goldenLeakFix])
  assert.ok(!fixed.canon.includes('PO подтвердил'))
  assert.equal(qualityMetrics({ doc: fixed.canon, fastMd: FAST, golden: g }).metrics.golden_ngram_leaks, 0)
})

test('FIXES целиком на документе портала: проверки RK003, PV001, CT005 молчат; метрики источников и якорей', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx)
  const { errors, warnings } = check(fixed.canon, ctx)
  assert.deepEqual(errors.filter((e) => ['RK003', 'PV001', 'CT005'].includes(e.code)), [])
  // Раунд 6: решение того же действия код в текст не вставляет — модели замечание CT004.
  assert.ok(warnings.some((w) => w.code === 'CT004'))
  const before = check(CANON, ctx).errors.map((e) => e.code)
  for (const code of ['RK003', 'PV001', 'CT005']) assert.ok(before.includes(code), `${code} ловит исходный канон`)
  const m = qualityMetrics({ doc: fixed.canon, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics
  assert.equal(m.existing_solution_unsurfaced, 1, 'код больше не вставляет существующее решение')
  assert.equal(m.R3_with_who_date, 1)
  assert.equal(m.R3_utochnit_share, 0)
  assert.deepEqual(autoFix(fixed.canon, ctx).log, [], 'вся цепочка идемпотентна')
})

test('R3_with_who_date: [УТОЧНИТЬ] вместо даты — не в счёт, доля маркеров отдельно', () => {
  const doc = CANON.replace(/согласовано 16\.11\.2026/g, 'согласовано [УТОЧНИТЬ: дата согласования]')
  const m = qualityMetrics({ doc, fastMd: FAST }).metrics
  assert.equal(m.R3_with_who_date, 0)
  assert.equal(m.R3_utochnit_share, 1)
})
