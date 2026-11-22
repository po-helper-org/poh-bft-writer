// Раунд 3 качества: грамматика ID, ФТ-гипотезы из «что если», ветки сценария
// (happy path, полярность), строки «Пересечение», ссылки на смежные находки,
// существующее решение словами. Нейтральный домен (не из заявок портала):
// возврат велосипеда. Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alternativeBranches, autoFix, check, checkContext, citationOnceFix, coverageGaps, customerAsisFix, maturityFix, maturityOf, ftWithoutOrigin, normalizeIdsFix, risksFix,
  scrubIds, speculativeFtFix, speculativeFts, stripNonSameLinksFix, anchorsFix, linkGraphFix, uncoveredElse,
} from '../lib-test/canon-check.js'
import { CANON_ID, ID_RE, parseCanon } from '../lib-test/canon-table.js'
import { sourcesForModel } from '../lib-test/bft-deep.js'
import { qualityMetrics } from '../lib-test/quality-metrics.js'

const FAST = `---
stage: fast
---

# [БФТ] bike-2: Возврат велосипеда через приложение

### How to demo

1. Приложение: экран аренды: Клиент нажимает «Завершить аренду» у стойки → Велосипед принят стойкой, статус «Возвращён»
2. Приложение: история поездок: Клиент открывает историю → Поездка в истории с суммой оплаты

### Критичные требования (скелет на цитатах)

| ID | ASIS (сейчас) | TOBE (после) | Связанные | Источник (цитата) |
|---|---|---|---|---|
| БТ-1 | Клиент сдаёт велосипед кассиру | Возврат без кассира | | Заказчик: «хотим возврат без кассира» |
| ПТ-1 | Клиент сдаёт велосипед кассиру | Клиент завершает аренду в приложении | БТ-1 | Заказчик: «нажал кнопку и ушёл» |
`

const PRIMARY = {
  args: {
    title: 'Возврат велосипеда через приложение',
    want: { what: 'Возврат без кассира', asis: 'Клиент сдаёт велосипед кассиру', quote: 'Заказчик: «хотим возврат без кассира, нажал кнопку и ушёл»' },
    people: [{ name: 'Орлова Нина', role: 'Заказчик' }],
  },
}

const SOURCES = `# Корпоративные источники

## Про ту же систему или функцию — факты (R2, со ссылкой)

## Возврат самокатов в приложении
Confluence · RENT · page · 2025-04-01
Тип: Страница вики
Ссылка для БФТ: [Confluence: Возврат самокатов в приложении](https://wiki.test/pages/viewpage.action?pageId=501)
Отношение к заявке: та же функция
Факты (цитаты сверены с текстом находки):
- Аренда длится не более 3 часов. — «Аренда — не более 3 часов»
- Функция внедрена в эксплуатацию 01.03.2025. — «Внедрено в эксплуатацию 01.03.2025»

## Карта стоек
Confluence · RENT · page · 2025-02-01
Тип: Страница вики
Ссылка для БФТ: [Confluence: Карта стоек](https://wiki.test/pages/viewpage.action?pageId=600)
Отношение к заявке: та же система
Факты (цитаты сверены с текстом находки):
- Стойки стоят у метро. — «Стойки стоят у метро»

## RENT-50 · Возврат на любую стойку
Jira · RENT · История · В работе · 2026-01-01
Тип: История · Статус: в работе
Ссылка для БФТ: [Jira RENT-50](https://jira.test/browse/RENT-50)
Отношение к заявке: та же функция

## Смежные и без вердикта — только как указатель

## RENT-40 · Касса падает при оплате картой
Jira · RENT · Ошибка · Открыт · 2026-01-10
Тип: Ошибка (дефект) · Статус: открыт
Ссылка для БФТ: [Jira RENT-40](https://jira.test/browse/RENT-40)
Отношение к заявке: смежное

## RENT-77 · Возврат велосипедов на новые стойки
Jira · RENT · Эпик · В работе · 2026-02-01
Тип: Эпик (объём работ) · Статус: в работе
Ссылка для БФТ: [Jira RENT-77](https://jira.test/browse/RENT-77)
Отношение к заявке: смежное
`

const CANON = `## Проблема которую решаем

| Срез | Содержание |
| --- | --- |
| **ASIS** | Клиент сдаёт велосипед кассиру |
| **TOBE** | Клиент завершает аренду в приложении (ПТ-1, ИТ-0) |

## Изменение в UJM

| Точка демо | Было (As-Is) | Стало (To-Be) |
| --- | --- | --- |
| История поездок | \`[ASIS не озвучен]\` | Поездка видна в истории (ИТ-0) |

## План демонстрации

### Акторы

| Актор | Описание |
| --- | --- |
| Клиент | Возвращает велосипед |

### Сценарий приёмки (happy path + alt)

\`\`\`plantuml
@startuml
actor "Клиент" as C
participant "Приложение" as App
participant "Стойка" as Dock
C -> App: нажимает «Завершить аренду»
App -> Dock: запрос на приём
alt Стойка отклонила возврат
  App --> C: [УТОЧНИТЬ у Орловой Нины: что видит клиент, если стойка не приняла велосипед?]
else Велосипед принят стойкой
  App --> C: велосипед принят стойкой, статус «Возвращён»
  C -> App: открывает историю
  App --> C: поездка в истории с суммой оплаты
end
alt Оплата не прошла
  App --> C: оплата отклонена
end
@enduml
\`\`\`

**Расширенный сценарий приёмки (ось «что если»):**

| What-if | Есть источник? | Результат |
| --- | --- | --- |
| Клиент теряет велосипед | Нет | [УТОЧНИТЬ у Орловой Нины: какой штраф?] (см. ФТ-3) |
| Стойка занята | Нет | [УТОЧНИТЬ у Орловой Нины: куда вернуть?] (см. ФТ-1) |
| Касса недоступна | Нет | Касса — [Jira RENT-40](https://jira.test/browse/RENT-40) |

## Бизнес-Требования

## Ценность разрабатываемого функционала для бизнес-заказчиков*

| Идентификатор | Наименование требования | Ценность | Краткое описание | Связанные требования |
| --- | --- | --- | --- | --- |
| БТ-1 | Возврат без кассира | Нет очереди | Кнопка в приложении | ПТ-1, ФТ-1, ФТ-2, ФТ-3 |

## Пользовательские требования*

| Идентификатор | Наименование требования | Story | Комментарий | Связанные требования |
| --- | --- | --- | --- | --- |
| ПТ-1 | Возврат по кнопке | **Когда** я (клиент) у стойки **Я хочу** завершить аренду в приложении | — | БТ-1 |

## Требования к интерфейсам*

| Идентификатор | Наименование требования | Требование к пользовательскому интерфейсу | Предложения по элементам UI, механике и композиции | Связанные требования |
| --- | --- | --- | --- | --- |
| ИТ-1 | Экран аренды | Кнопка «Завершить аренду» | — | ПТ-1 |
| ИТ-0 | История поездок | Клиент видит поездку в истории с суммой оплаты | — | ПТ-1 |

## Функциональные требования*

| Идентификатор | Наименование требования | Приоритет | Функциональные требования | Параметры, ограничения | Связанные требования |
| --- | --- | --- | --- | --- | --- |
| ФТ-1 | Приём велосипеда стойкой | Высокий (предварительно) | Стойка принимает велосипед, статус аренды — «Возвращён» | Корпоративная находка указывает не более 3 часов; для заявки — [УТОЧНИТЬ у Орловой Нины: максимальная длительность?] | ПТ-1, ИТ-0 |
| ФТ-2 | Отказ в оплате | Средний (предварительно) | Если оплата не прошла, клиент видит причину отказа | [УТОЧНИТЬ у Орловой Нины: текст отказа?] | ПТ-1 |
| ФТ-3 | Штраф за потерю | Низкий (предварительно) | Система начисляет штраф за потерянный велосипед (см. ИТ-0) | [УТОЧНИТЬ у Орловой Нины: нужен ли штраф?] | БТ-1 |
| ФТ-4 | Оплата аренды | Средний (предварительно) | Клиент видит, что оплата прошла и чек отправлен | — | ПТ-1 |

## Нефункциональные требования*

| Идентификатор | Наименование требования | Описание | Связанные требования |
| --- | --- | --- | --- |

## Зависимости

| Команда / система | Тип зависимости | Статус согласования |
| --- | --- | --- |
| Стойки | Параллельно: [Jira RENT-77](https://jira.test/browse/RENT-77) | [УТОЧНИТЬ у PO: статус?] |

## Риски

| Риск | Вероятность | Влияние | Митигация |
| --- | --- | --- | --- |
| Пересечение с существующим решением [Confluence: Карта стоек](https://wiki.test/pages/viewpage.action?pageId=600): расширяем, заменяем или строим отдельно | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO: расширяем, заменяем или строим отдельно?] |
| Пересечение с существующим решением [Jira RENT-50](https://jira.test/browse/RENT-50): что уже сделано | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO: что уже сделано?] |
| Пересечение с существующим решением [Confluence: Возврат самокатов в приложении](https://wiki.test/pages/viewpage.action?pageId=501): расширяем | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO] | [УТОЧНИТЬ у PO: расширяем?] |

## Якоря истины

| Факт в БФТ | Источник (якорь) | Ранг | Тип |
| --- | --- | --- | --- |
| Касса падает при оплате картой | [Jira RENT-40](https://jira.test/browse/RENT-40) | R2 | Jira |
`

const ctxOf = (extra = {}) => checkContext({ fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY, ...extra })
const section = (text, title) => { const s = text.indexOf(`## ${title}`); const e = text.indexOf('\n## ', s + 3); return text.slice(s, e < 0 ? undefined : e) }
const rowsOf = (text, title) => section(text, title).split('\n').filter((l) => /^\| (?:БТ|ПТ|ИТ|ФТ|НФТ)-/.test(l))

/** Как TR001 bft-lint.py: ссылки «Связанные» и «(см. X-N)» ведут только на строки с каноническим ID. */
function danglingRefs(canon) {
  const parsed = parseCanon(canon)
  const defined = new Set(parsed.sections.flatMap((s) => s.tables.flatMap((t) => t.rows.map((r) => r.cells[0]))).filter((id) => CANON_ID.test(id ?? '')))
  const refs = [
    ...parsed.sections.flatMap((s) => s.tables.flatMap((t) => {
      const c = t.header.findIndex((h) => h.startsWith('Связанные'))
      return c < 0 ? [] : t.rows.filter((r) => CANON_ID.test(r.cells[0] ?? '')).flatMap((r) => r.cells[c]?.match(ID_RE) ?? [])
    })),
    ...[...canon.matchAll(/\(см\.\s*([^)]*)\)/g)].flatMap((m) => m[1].match(ID_RE) ?? []),
  ]
  return refs.filter((id) => !defined.has(id))
}

test('ID «ИТ-0»: свободный номер своего типа, все ссылки переписаны — TR001 не остаётся; повтор ID — следующий номер', () => {
  assert.deepEqual(danglingRefs(CANON).filter((id) => id === 'ИТ-0').length > 0, true, 'исходный канон ссылается на неопределённый ИТ-0')
  const dup = CANON.replace('| ФТ-4 | Оплата аренды |', '| ФТ-2 | Оплата аренды |')
  const fixed = autoFix(dup, ctxOf(), [normalizeIdsFix])
  assert.ok(!/ИТ-0(?!\d)/.test(fixed.canon), fixed.canon)
  assert.ok(fixed.canon.includes('| ИТ-2 | История поездок |'))
  assert.ok(fixed.canon.includes('(ПТ-1, ИТ-2)') && fixed.canon.includes('Поездка видна в истории (ИТ-2)') && fixed.canon.includes('(см. ИТ-2)'))
  assert.ok(fixed.canon.includes('| ФТ-4 | Оплата аренды |'), 'повтор ФТ-2 — следующий свободный номер')
  assert.ok(fixed.canon.includes('| ФТ-2 | Отказ в оплате |'), 'первая строка ID сохраняет')
  assert.deepEqual(danglingRefs(fixed.canon), [])
  assert.deepEqual(autoFix(fixed.canon, ctxOf(), [normalizeIdsFix]).log, [])
  // Вся цепочка: TR001 не остаётся.
  assert.deepEqual(danglingRefs(autoFix(CANON, ctxOf()).canon), [])
})

test('ФТ-гипотеза из «что если» с «Нет» — удаляется вместе со ссылками; ФТ шага демо и ветки — остаются', () => {
  const ctx = ctxOf()
  const parsed = parseCanon(CANON)
  assert.deepEqual(speculativeFts(parsed, ctx), ['ФТ-3'])
  assert.deepEqual(ftWithoutOrigin(parsed, ctx), ['ФТ-3', 'ФТ-4'])
  const fixed = autoFix(CANON, ctx, [speculativeFtFix])
  assert.ok(!fixed.canon.includes('Штраф за потерю'))
  assert.ok(!/ФТ-3(?!\d)/.test(fixed.canon), 'ссылки на удалённый ФТ сняты')
  assert.ok(fixed.canon.includes('| Клиент теряет велосипед | Нет | [УТОЧНИТЬ у Орловой Нины: какой штраф?] |'), 'вопрос остаётся маркером')
  assert.ok(fixed.canon.includes('| ПТ-1, ФТ-1, ФТ-2 |'))
  assert.ok(fixed.canon.includes('| ФТ-1 | Приём велосипеда стойкой |'), 'ФТ шага демо остаётся, хоть на него и ссылается «что если»')
  assert.deepEqual(autoFix(fixed.canon, ctx, [speculativeFtFix]).log, [])
  assert.deepEqual(autoFix(CANON, checkContext({ fastMd: FAST, sourcesMd: SOURCES }), [speculativeFtFix]).log, [], 'навык (без primary.json) — не трогаем')
  assert.equal(scrubIds('Покрыто (см. ФТ-3); связано: ПТ-1, ФТ-3, ФТ-30', new Set(['ФТ-3'])), 'Покрыто; связано: ПТ-1, ФТ-30')
})

test('ветки: happy path узнаётся по How to demo, а не по месту в alt; отказ закрывается ФТ той же полярности', () => {
  const parsed = parseCanon(CANON)
  assert.deepEqual(alternativeBranches(parsed, FAST).map((b) => b.label), ['Стойка отклонила возврат', 'Оплата не прошла'])
  // «Оплата аренды: оплата прошла» — не про отказ; «Отказ в оплате» — про него.
  assert.deepEqual(uncoveredElse(parsed, FAST), ['Стойка отклонила возврат'])
  const noRefusal = CANON.replace('| ФТ-2 | Отказ в оплате | Средний (предварительно) | Если оплата не прошла, клиент видит причину отказа |', '| ФТ-2 | Напоминание об оплате | Средний (предварительно) | Клиент получает напоминание, если оплата не прошла |')
  assert.deepEqual(uncoveredElse(parseCanon(noRefusal), FAST), ['Стойка отклонила возврат', 'Оплата не прошла'], 'общие слова и «не» без отказа — не покрытие')
  const ctx = ctxOf()
  // Раунд 4: код только находит непокрытую ветку (CV005 на повторе), ФТ под неё пишет модель.
  assert.deepEqual(coverageGaps(parsed, FAST).filter((g) => g.kind === 'branch').map((g) => g.what), ['Стойка отклонила возврат'])
  const fixed = autoFix(CANON, ctx)
  assert.ok(!/сценария приёмки\)/.test(fixed.canon), 'без пометок «(ветка «…» сценария приёмки)»')
  assert.ok(!/\| Стойка отклонила возврат \|/.test(section(fixed.canon, 'Функциональные требования')), 'ФТ по ветке код не пишет')
  assert.ok(check(fixed.canon, ctx).errors.some((w) => w.code === 'CV005' && w.message.includes('Стойка отклонила возврат')))
  // CV004: happy path стоит после ветки-отказа.
  assert.ok(check(CANON, ctx).warnings.some((w) => w.code === 'CV004' && w.message.includes('Велосипед принят стойкой')))
})

test('«Пересечение с решением» (раунд 6): код не сочиняет и не сводит строки — чистит ссылки; пропуск решения того же действия — CT004 модели', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [risksFix])
  const risks = section(fixed.canon, 'Риски').split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Риск') && !l.startsWith('| ---'))
  assert.ok(!risks.some((l) => l.includes('расширяем, заменяем или строим отдельно') && !CANON.includes(l)), 'код строк пересечения не пишет')
  assert.ok(!risks.join('\n').includes('](https://wiki.test/pages/viewpage.action?pageId=600)'), '«та же система» — не основание риска: ссылка снята')
  assert.ok(!section(fixed.canon, 'Зависимости').includes('Параллельная работа: сверить объём — [Jira RENT-50]'), 'строку «Зависимостей» пишет модель')
  assert.deepEqual(autoFix(fixed.canon, ctx, [risksFix]).log, [])
  assert.deepEqual(check(fixed.canon, ctx).errors.filter((e) => e.code === 'CT005'), [])
})

test('смежная находка: ссылка в тексте БФТ — текстом; строка R2 «Якорей» остаётся (раунд 6); смежный открытый эпик — ключом и в «Зависимостях»', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [stripNonSameLinksFix, anchorsFix])
  assert.ok(fixed.canon.includes('| Касса недоступна | Нет | Касса — `RENT-40` |'), section(fixed.canon, 'План демонстрации'))
  // Раунд 5: смежная открытая задача — не параллельная работа: в «Зависимостях» ключ без ссылки.
  assert.ok(section(fixed.canon, 'Зависимости').includes('`RENT-77`') && !section(fixed.canon, 'Зависимости').includes('](https://jira.test/browse/RENT-77)'), section(fixed.canon, 'Зависимости'))
  assert.ok(section(fixed.canon, 'Якоря истины').includes('| Касса падает при оплате картой | [Jira RENT-40](https://jira.test/browse/RENT-40) | R2 | Jira |'), 'смежная — не больше строки R2')
  assert.deepEqual(autoFix(fixed.canon, ctx, [stripNonSameLinksFix]).log, [])
  const before = qualityMetrics({ doc: CANON, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics
  assert.equal(before.anchor_rows_irrelevant, 0, 'R2 на смежную находку — законное место смежной')
})

test('существующее решение (раунд 6): находку словами код не превращает в ссылку — CT007 модели; ASIS заказчика не трогается', () => {
  const ctx = ctxOf()
  assert.ok(check(CANON, ctx).warnings.some((w) => w.code === 'CT007'))
  const fixed = autoFix(CANON, ctx)
  assert.ok(!fixed.canon.includes('| Находка [Confluence: Возврат самокатов в приложении]'), 'ссылку ставит модель')
  assert.ok(!/Уже есть:|Описано в \[/.test(fixed.canon), 'пометок «Уже есть»/«Описано в» код не пишет')
  assert.ok(fixed.canon.includes('| **ASIS** | Клиент сдаёт велосипед кассиру |'))
})

test('FIXES целиком: идемпотентно, ни TR001, ни CT005; метрики ft_without_origin и alt_covered', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx)
  assert.deepEqual(autoFix(fixed.canon, ctx).log, [], 'вся цепочка идемпотентна')
  assert.deepEqual(danglingRefs(fixed.canon), [])
  assert.deepEqual(check(fixed.canon, ctx).errors.map((e) => e.code).filter((c) => ['CT005', 'RK003', 'CT002'].includes(c)), [])
  const m = qualityMetrics({ doc: fixed.canon, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics
  assert.equal(m.alt_covered, 0.5, 'ветку «Стойка отклонила возврат» закрывает модель на повторе (CV005), не код')
  assert.equal(m.ft_without_origin, 1, 'ФТ-4 «Оплата аренды» — без происхождения (WARN, не удаляется: на него не ссылается «что если»)')
  assert.equal(m.anchor_rows_irrelevant, 0)
})

test('карта находок для модели: смежная (вердикт) — со «Ссылкой для БФТ» для R2, без вердикта и вторым шагом — без неё', () => {
  const md = sourcesForModel(SOURCES)
  assert.ok(md.includes('Ссылка для БФТ: [Confluence: Возврат самокатов в приложении]'))
  assert.ok(md.includes('Ссылка для БФТ: [Jira RENT-50]'))
  assert.ok(md.includes('Ссылка для БФТ: [Jira RENT-40]') && md.includes('Ссылка для БФТ: [Jira RENT-77]'), 'смежные — с вердиктом')
  const noVerdict = sourcesForModel(SOURCES.replace(/\nОтношение к заявке: смежное/g, ''))
  assert.ok(!noVerdict.includes('Ссылка для БФТ: [Jira RENT-40]'), 'без вердикта — только указатель')
  assert.ok(md.includes('## RENT-40 · Касса падает при оплате картой'), 'сама находка остаётся указателем')
})
