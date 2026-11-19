// Раунд 4 качества: детекция покрытия вместо синтеза ФТ кодом, одна находка — одна
// ссылка, ASIS заказчика не переписывается находкой, зрелость решения — только из
// источника, граф «Связанных» после всех правок, валидный plantuml, базовое значение
// эффекта, метрики без ложных срабатываний. Нейтральный домен (не из заявок портала):
// подписка на прокат самокатов. Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIXES, alternativeBranches, autoFix, check, checkContext, citationOnceFix, customerAsisFix, linkGraphFix, maturityFix, maturityOf,
  missingBaseline, parseSources, plantumlFix, solutionPhrase, umlStatement, umlUnknown,
} from '../lib-test/canon-check.js'
import { parseCanon } from '../lib-test/canon-table.js'
import { qualityMetrics } from '../lib-test/quality-metrics.js'

const FAST = `---
stage: fast
---

# [БФТ] scoot-4: Подписка на прокат самокатов

### Цель

| SMART | Значение |
|---|---|
| A (Achievable) | Команды: Команда приложения, Биллинг · Специалисты: PO |

### How to demo

1. Приложение: экран подписки: Клиент оформляет подписку → Подписка активна, статус «Активна»
2. Приложение: Клиент берёт самокат → Поездка без оплаты по подписке
3. Приложение: Клиент без подписки открывает экран → Экран подписки без активной подписки, кнопки «Продлить» нет

### Критичные требования (скелет на цитатах)

| ID | ASIS (сейчас) | TOBE (после) | Связанные | Источник (цитата) |
|---|---|---|---|---|
| БТ-1 | Клиент платит за каждую поездку | Подписка вместо оплаты поездок | | Заказчик: «хотим подписку» |
`

const PRIMARY = {
  args: {
    title: 'Подписка на прокат самокатов',
    want: { what: 'Подписка', quote: 'Заказчик: «Сейчас клиент платит за каждую поездку, оплата занимает до двух минут. Хотим подписку.»' },
    people: [{ name: 'Орлова Нина', role: 'Заказчик' }],
  },
}

const SOURCES = `# Корпоративные источники

## Про ту же систему или функцию — факты (R2, со ссылкой)

## Требования к подписке
Confluence · RENT · page · 2025-04-01
Тип: Страница вики
Ссылка для БФТ: [Confluence: Требования к подписке](https://wiki.test/pages/viewpage.action?pageId=700)
Отношение к заявке: та же функция
Факты (цитаты сверены с текстом находки):
- Подписка должна списываться раз в месяц. — «Подписка должна списываться раз в месяц»

## Тарифы в эксплуатации
Confluence · RENT · page · 2025-02-01
Тип: Страница вики
Ссылка для БФТ: [Confluence: Тарифы в эксплуатации](https://wiki.test/pages/viewpage.action?pageId=701)
Отношение к заявке: та же функция
Факты (цитаты сверены с текстом находки):
- Тарифы внедрены в эксплуатацию 01.02.2025. — «Тарифы внедрены в эксплуатацию 01.02.2025»

## RENT-90 · Списание подписки
Jira · RENT · История · Закрыт · 2026-01-01
Тип: История · Статус: закрыт
Ссылка для БФТ: [Jira RENT-90](https://jira.test/browse/RENT-90)
Отношение к заявке: та же функция
`

const LINK = '[Confluence: Требования к подписке](https://wiki.test/pages/viewpage.action?pageId=700)'

const CANON = `## Проблема которую решаем

| Срез | Содержание |
| --- | --- |
| **ASIS** | Клиент платит за каждую поездку. По ${LINK} подписка уже работает |
| **ПРОБЛЕМА** | Оплата каждой поездки. Целевой показатель — [УТОЧНИТЬ у Орловой Нины: какой показатель эффекта?] |

## Изменение в UJM

| Точка демо | Было (As-Is) | Стало (To-Be) |
| --- | --- | --- |
| Экран подписки | Клиент платит за каждую поездку | Подписка активна (ПТ-1) |

## План демонстрации

### Сценарий приёмки (happy path + alt)

\`\`\`plantuml
@startuml
actor "Клиент" as C
participant "Приложение" as App
C -> App: оформляет подписку
alt Подписка оформлена
  App --> C: статус «Активна»
else Оплата подписки не прошла
  [УТОЧНИТЬ у Орловой Нины: что видит клиент?]
end
alt Подписки нет
  App --> C: экран подписки без активной подписки, кнопки «Продлить» нет
end
@enduml
\`\`\`

| What-if | Есть источник? | Результат |
| --- | --- | --- |
| Списание раз в месяц | Да — ${LINK} | Подписка списывается раз в месяц |

## Бизнес-Требования

## Ценность разрабатываемого функционала для бизнес-заказчиков*

| Идентификатор | Наименование требования | Ценность | Краткое описание | Связанные требования |
| --- | --- | --- | --- | --- |
| БТ-1 | Подписка вместо оплаты поездок | Меньше отказов | Подписка в приложении | ПТ-1 |

## Пользовательские требования*

| Идентификатор | Наименование требования | Story | Комментарий | Связанные требования |
| --- | --- | --- | --- | --- |
| ПТ-1 | Оформление подписки | **Когда** я (клиент) **Я хочу** оформить подписку | — | БТ-1 |

## Функциональные требования*

| Идентификатор | Наименование требования | Приоритет | Функциональные требования | Параметры, ограничения | Связанные требования |
| --- | --- | --- | --- | --- | --- |
| ФТ-1 | Активация подписки | Высокий (предварительно) | Подписка активируется после оплаты, статус «Активна»; правила — по ${LINK} | — | ПТ-1 |
| ФТ-2 | Поездка по подписке | Высокий (предварительно) | Поездка без оплаты по подписке | Существующая подписка (${LINK}) | ФТ-1 |

## Нефункциональные требования*

| Идентификатор | Наименование требования | Описание | Связанные требования |
| --- | --- | --- | --- |

## Зависимости

| Команда / система | Тип зависимости | Статус согласования |
| --- | --- | --- |
| Биллинг (существующая) | Списание подписки по ${LINK} | [УТОЧНИТЬ у команды биллинга: статус?] |

## Риски

Риски заказчиком не названы.

## Якоря истины

| Факт в БФТ | Источник (якорь) | Ранг | Тип |
| --- | --- | --- | --- |
| Списание раз в месяц | ${LINK}: «Подписка должна списываться раз в месяц» | R2 | Confluence |
`

const ctxOf = (extra = {}) => checkContext({ fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY, ...extra })
const section = (text, title) => { const s = text.indexOf(`## ${title}`); const e = text.indexOf('\n## ', s + 3); return text.slice(s, e < 0 ? undefined : e) }
const count = (text, needle) => text.split(needle).length - 1

test('зрелость решения — только из источника: страница требований «описана», «внедрено» в тексте и закрытая задача — работают', () => {
  const [req, live, done] = parseSources(SOURCES)
  assert.deepEqual(maturityOf(req), { operating: false, status: 'не указан' })
  assert.equal(maturityOf(live).operating, true)
  assert.equal(maturityOf(done).operating, true)
  assert.equal(solutionPhrase(req), `решение, описанное в ${req.citation} (статус в источнике: не указан)`)
  assert.equal(solutionPhrase(live), `существующее решение ${live.citation}`)
  // Отменённая задача — не сделанная работа.
  assert.equal(maturityOf({ ...done, status: 'Отменён' }).operating, false)
})

test('зрелость: «существующая»/«(существующая)» рядом со страницей требований — «описанная», скобки снимаются; MT001 ловит «уже работает»', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [maturityFix])
  const ft = section(fixed.canon, 'Функциональные требования')
  assert.ok(ft.includes(`| Описанная подписка (${LINK}) |`), ft)
  assert.ok(section(fixed.canon, 'Зависимости').includes('| Биллинг | Списание подписки'), 'пометка в скобках снята')
  assert.deepEqual(autoFix(fixed.canon, ctx, [maturityFix]).log, [])
  assert.ok(check(CANON, ctx).warnings.some((w) => w.code === 'MT001' && w.message.includes('статус в источнике: не указан')))
})

test('ASIS заказчика (R3) не переписывается утверждением находки; без ASIS заказчика — не трогаем', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [customerAsisFix])
  assert.ok(fixed.canon.includes('| **ASIS** | Клиент платит за каждую поездку. |'), section(fixed.canon, 'Проблема которую решаем'))
  assert.deepEqual(autoFix(fixed.canon, ctx, [customerAsisFix]).log, [])
  // Заказчик о текущем состоянии не говорил — ASIS-ячейка только из находки: правило её не трогает.
  const silent = { args: { ...PRIMARY.args, want: { what: 'Подписка', quote: 'Заказчик: «Хотим подписку»' } } }
  assert.deepEqual(autoFix(CANON, ctxOf({ primary: silent }), [customerAsisFix]).log, [])
})

test('одна находка — одна ссылка в разделе: первая в разделе, «Риски» и «Якоря» — с ссылкой, повторы — подписью; CT007 молчит', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [citationOnceFix])
  // Раунд 5: одна ссылка на находку в каждом разделе — требование не теряет ссылку из-за упоминания выше.
  for (const title of ['Проблема которую решаем', 'Изменение в UJM', 'План демонстрации', 'Функциональные требования', 'Зависимости']) {
    assert.ok(count(section(fixed.canon, title), LINK) <= 1, section(fixed.canon, title))
  }
  assert.ok(section(fixed.canon, 'Проблема которую решаем').includes(LINK), 'первое упоминание — ссылкой')
  assert.ok(section(fixed.canon, 'Функциональные требования').includes(LINK), 'раздел требований — со своей ссылкой')
  assert.ok(section(fixed.canon, 'Якоря истины').includes(LINK), 'якорь — ссылкой')
  assert.deepEqual(autoFix(fixed.canon, ctx, [citationOnceFix]).log, [])
  assert.ok(!check(fixed.canon, ctx).warnings.some((w) => w.code === 'CT007'), 'подпись находки с ссылкой выше — не «упомянута без ссылки»')
  // Вся цепочка: ссылка в теле одна (плюс строка пересечения в «Рисках»), цепочка идемпотентна.
  const all = autoFix(CANON, ctx)
  assert.deepEqual(autoFix(all.canon, ctx).log, [])
  for (const title of ['Проблема которую решаем', 'Функциональные требования']) assert.ok(count(section(all.canon, title), LINK) <= 1, section(all.canon, title))
})

test('граф: ПТ и ФТ ссылаются на БТ напрямую, «Связанные» БТ пересчитаны после всех правок', () => {
  const ctx = ctxOf()
  const fixed = autoFix(CANON, ctx, [linkGraphFix])
  assert.match(section(fixed.canon, 'Функциональные требования'), /\| ФТ-1 \| Активация подписки \|.*\| БТ-1, ПТ-1 \|/)
  assert.match(section(fixed.canon, 'Функциональные требования'), /\| ФТ-2 \| Поездка по подписке \|.*\| БТ-1, ФТ-1 \|/)
  assert.ok(fixed.canon.includes('| БТ-1 | Подписка вместо оплаты поездок | Меньше отказов | Подписка в приложении | ПТ-1, ФТ-1, ФТ-2 |'))
  // Порядок цепочки: граф — после правок, которые добавляют и удаляют строки.
  const names = FIXES.map((f) => f.name)
  for (const before of ['speculative-ft', 'risks', 'dependencies', 'anchors', 'citation-once']) assert.ok(names.indexOf(before) < names.indexOf('link-graph'), before)
  // Несколько БТ, пути нет — ближайший по словам.
  const two = CANON.replace('| БТ-1 | Подписка вместо оплаты поездок | Меньше отказов | Подписка в приложении | ПТ-1 |',
    '| БТ-1 | Подписка вместо оплаты поездок | Меньше отказов | Подписка в приложении | ПТ-1 |\n| БТ-2 | Поездки без оплаты | Удобство | Поездка без оплаты | |')
    .replace('| ФТ-2 | Поездка по подписке | Высокий (предварительно) | Поездка без оплаты по подписке | Существующая подписка (' + LINK + ') | ФТ-1 |',
      '| ФТ-2 | Поездка по подписке | Высокий (предварительно) | Поездка без оплаты | — | |')
  assert.match(section(autoFix(two, ctx, [linkGraphFix]).canon, 'Функциональные требования'), /\| ФТ-2 \| Поездка по подписке \|.*\| БТ-2 \|/)
})

test('plantuml: голая строка внутри alt/else — note over первого участника; UML001 ловит то, что осталось', () => {
  assert.ok(umlStatement('  App --> C: статус «Активна»'))
  assert.ok(umlStatement('else Оплата не прошла'))
  assert.ok(umlStatement("' комментарий"))
  assert.ok(umlStatement('note over C: текст'))
  assert.ok(umlStatement('== Этап ==') && umlStatement('...') && umlStatement('autonumber'))
  assert.ok(!umlStatement('[УТОЧНИТЬ у Орловой Нины: что видит клиент?]'))
  assert.ok(!umlStatement('Клиент видит ошибку'))
  const ctx = ctxOf()
  assert.ok(check(CANON, ctx).errors.some((e) => e.code === 'UML001' && e.message.includes('УТОЧНИТЬ')))
  const fixed = autoFix(CANON, ctx, [plantumlFix])
  assert.ok(fixed.canon.includes('  note over C: [УТОЧНИТЬ у Орловой Нины: что видит клиент?]'), fixed.canon)
  assert.deepEqual(umlUnknown(fixed.canon), [])
  assert.deepEqual(autoFix(fixed.canon, ctx, [plantumlFix]).log, [])
  // Многострочная заметка — свободный текст внутри note … end note.
  assert.deepEqual(umlUnknown('```plantuml\n@startuml\nactor A\nnote over A\nлюбой текст\nend note\n@enduml\n```'), [])
  // Участников нет — комментарий.
  assert.ok(autoFix('```plantuml\n@startuml\nголый текст\n@enduml\n```', ctx, [plantumlFix]).canon.includes("' голый текст"))
})

test('ветка, которая сама — шаг How to demo той же полярности, — не отклонение (ФТ под неё не нужен)', () => {
  const branches = alternativeBranches(parseCanon(CANON), FAST).map((b) => b.label)
  assert.deepEqual(branches, ['Оплата подписки не прошла'])
})

test('базовое значение эффекта: заказчик назвал «как сейчас» в общей реплике — EF001 и метрика, если канон его не называет', () => {
  const ctx = ctxOf()
  assert.equal(missingBaseline(CANON, PRIMARY), 'до двух минут')
  assert.ok(check(CANON, ctx).warnings.some((w) => w.code === 'EF001' && w.message.includes('до двух минут')))
  const said = CANON.replace('Оплата каждой поездки.', 'Оплата каждой поездки, сейчас — до двух минут.')
  assert.equal(missingBaseline(said, PRIMARY), undefined)
  assert.equal(qualityMetrics({ doc: CANON, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics.effect_baseline_missing, 1)
  assert.equal(qualityMetrics({ doc: said, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics.effect_baseline_missing, 0)
  assert.equal(qualityMetrics({ doc: CANON, fastMd: FAST, primary: { args: { want: { quote: 'Хотим подписку' } } } }).metrics.effect_baseline_missing, null)
})

test('метрики без ложных срабатываний: As-Is/To-Be и даты — не токены без источника; R3 с плейсхолдером — не «кто и когда»; R2 не про тело — нерелевантен', () => {
  const doc = CANON
    .replace('| Точка демо | Было (As-Is) | Стало (To-Be) |', '| Точка демо | Было (As-Is) | Стало (To-Be) |\n| To-Be итог | As-Is 16.11.2026 | 2026-11-16 |')
    .replace(`| Списание раз в месяц | ${LINK}:`, `| Подписка (БТ-1) | Заказчик Орлова Нина, согласовано 16.11.2026, заявка #4: «хотим подписку» | R3 | Решение заказчика |
| Оформление (ПТ-1) | Заказчик [УТОЧНИТЬ: ФИО заказчика], согласовано 16.11.2026 | R3 | Решение заказчика |
| Оплата (ФТ-1) | Заказчик Орлова Нина, согласовано [УТОЧНИТЬ: дата] 16.11.2026 | R3 | Решение заказчика |
| Тарифы | [Confluence: Тарифы в эксплуатации](https://wiki.test/pages/viewpage.action?pageId=701): «Тарифы внедрены» | R2 | Confluence |
| Списание раз в месяц | ${LINK}:`)
  const { metrics, details } = qualityMetrics({ doc, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY })
  assert.ok(!details.unsourced_tokens.some((t) => /^(?:As-Is|To-Be|16|11|2026|16\.11)$/.test(t)), details.unsourced_tokens.join())
  assert.equal(metrics.R3_with_who_date, 0.333)
  assert.equal(metrics.anchor_rows_irrelevant, 1, 'R2 на «Тарифы», которых в теле канона нет')
})
