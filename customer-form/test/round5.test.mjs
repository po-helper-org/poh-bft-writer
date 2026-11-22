// Раунд 5 качества: находки сверяются с ASIS, UJM, «что если» и ветками сценария;
// пересечение — только решение про объект заявки, платформа — «Опирается на»;
// якоря подходят требованию; ID скелета не меняют смысл. Нейтральный домен
// (не из заявок портала): гостевой пропуск на парковку. Запуск: npm test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIXES, addresseeFormFix, altSourceFix, anchorLine, autoFix, check, checkContext, coversObject, dependencyRowsFix,
  forWhomFix, parseSources, risksFix, seeWhatIfFix, whatIfSourceFix,
} from '../lib-test/canon-check.js'
import { qualityMetrics } from '../lib-test/quality-metrics.js'

const FAST = `---
stage: fast
---

# [БФТ] park-5: Пропуск на парковку для гостя через ParkHub

### Цель

| SMART | Значение |
|---|---|
| S (Specific) | Сотрудник оформляет гостевой пропуск на парковку, шлагбаум ParkHub пропускает гостя |
| A (Achievable) | Видение заказчика: «Пропуск уходит в ParkHub, шлагбаум открывается по номеру машины» · Команды: Команда приложения, ParkHub · Проработать: срок действия пропуска |

ASIS (со слов заказчика): «Сейчас пропуск заказывают письмом охране, ждут день»

### How to demo

1. Приложение: раздел «Гости»: Сотрудник указывает номер машины гостя и дату → Пропуск создан, статус «Активен»
2. Шлагбаум ParkHub: Гость подъезжает к шлагбауму → Шлагбаум открыт, въезд отмечен в журнале

### Критичные требования (скелет на цитатах)

| ID | ASIS (сейчас) | TOBE (после) | Связанные | Источник (цитата) |
|---|---|---|---|---|
| БТ-1 | Сейчас пропуск заказывают письмом охране | Гость въезжает без письма охране |  | Заказчик: «пропуск письмом охране — ждут день» |
| ПТ-1 | Сейчас пропуск заказывают письмом охране | Сотрудник оформляет пропуск гостю по номеру машины | БТ-1 | Заказчик: «сотрудник сам вводит номер машины» |
| ФТ-1 | [ASIS не озвучен] | Номер машины уходит в журнал шлагбаума ParkHub | БТ-1 | Заказчик (ответ в форме): «номер уходит в журнал шлагбаума» |
`

const PRIMARY = {
  args: {
    title: 'Пропуск на парковку для гостя через ParkHub',
    want: { what: 'Пропуск', asis: 'Сейчас пропуск заказывают письмом охране, ждут день', quote: 'Заказчик: «Сейчас пропуск заказывают письмом охране, ждут день»' },
    people: [{ name: 'Соколов Пётр', role: 'Заказчик' }],
  },
}

const SOURCES = `# Корпоративные источники

## Про ту же систему или функцию — факты (R2, со ссылкой)

## Гостевые пропуска в приложении
Confluence · PARK · page · 2025-09-01
Тип: Страница вики
Ссылка для БФТ: [Confluence: Гостевые пропуска в приложении](https://wiki.test/pages/viewpage.action?pageId=900)
Отношение к заявке: та же функция
Факты (цитаты сверены с текстом находки):
- Гостевой пропуск оформляется в приложении и внедрён в эксплуатацию 01.09.2025. — «Гостевой пропуск оформляется в приложении, внедрено в эксплуатацию 01.09.2025»
- Охрана может отклонить пропуск с указанием причины. — «Охрана может отклонить пропуск, указав причину»

## Шлагбаумы ParkHub на въезде
Confluence · PARK · page · 2018-03-01
Тип: Страница вики
Ссылка для БФТ: [Confluence: Шлагбаумы ParkHub на въезде](https://wiki.test/pages/viewpage.action?pageId=901)
Отношение к заявке: та же функция
Факты (цитаты сверены с текстом находки):
- Шлагбаум ParkHub открывается по номеру машины из журнала въезда. — «Шлагбаум ParkHub открывается по номеру машины из журнала въезда»

## PARK-40 · Новый журнал въезда
Jira · PARK · Эпик · В работе · 2026-05-01
Тип: Эпик (объём работ) · Статус: в работе
Ссылка для БФТ: [Jira PARK-40](https://jira.test/browse/PARK-40)
Отношение к заявке: та же система
Факты (цитаты сверены с текстом находки):
- Журнал въезда переносится в новую базу. — «Журнал въезда переносится в новую базу»

## Смежные и без вердикта

## PARK-77 · Тарифы платной парковки
Jira · PARK · Эпик · Бэклог · 2026-04-01
Тип: Эпик (объём работ) · Статус: бэклог
Ссылка для БФТ: [Jira PARK-77](https://jira.test/browse/PARK-77)
Отношение к заявке: смежное
`

const CANON = `## Проблема которую решаем

| Срез | Содержание |
| --- | --- |
| **ASIS** | «Сейчас пропуск заказывают письмом охране, ждут день» (Заказчик) |

## Изменение в UJM

| Точка демо | Было (As-Is) | Стало (To-Be) |
| --- | --- | --- |
| Шлагбаум на въезде | \`[ASIS не озвучен]\` | Шлагбаум ParkHub открывается по номеру машины из журнала въезда (ФТ-1) |

## План демонстрации

### Сценарий приёмки (happy path + alt)

\`\`\`plantuml
@startuml
actor "Сотрудник" as Emp
participant "Приложение" as App
Emp -> App: указывает номер машины гостя
alt Пропуск создан
  App --> Emp: пропуск создан, статус «Активен»
else Номер машины не указан
  App --> Emp: красная рамка вокруг поля и подсказка с примером номера
end
@enduml
\`\`\`

**Расширенный сценарий приёмки (ось «что если»):**

| What-if | Есть источник? | Результат |
| --- | --- | --- |
| Охрана отклоняет пропуск | Нет | \`[УТОЧНИТЬ у Соколова Петра: что видит сотрудник?]\` |
| Номер не указан | Частично — alt сценария приёмки | Красная рамка вокруг поля (см. «что если») |

## Пользовательские требования*

| Идентификатор | Наименование требования | Story | Комментарий | Связанные требования |
| --- | --- | --- | --- | --- |
| ПТ-1 | Оформление пропуска гостю | **Когда** я (сотрудник) жду гостя **Я хочу** ввести номер машины **Чтобы** гость въехал | — | БТ-1 |

## Функциональные требования*

| Идентификатор | Наименование требования | Приоритет | Функциональные требования | Параметры, ограничения | Связанные требования |
| --- | --- | --- | --- | --- | --- |
| ФТ-1 | Цвет кнопки отправки | Высокий (предварительно) | Кнопка «Отправить» зелёная | Оттенок — [УТОЧНИТЬ у Соколова Петр] | БТ-1 |
| ФТ-2 | Статус пропуска | Высокий (предварительно) | Пропуск создан, статус «Активен» виден сотруднику | — | БТ-1 |

## Зависимости

| Команда / система | Тип зависимости | Статус согласования |
| --- | --- | --- |
| ParkHub | Журнал въезда | Параллельная работа: сверить объём с \`PARK-40\` \`PARK-40\` |
| Смежная задача тарифов | может влиять на въезд | [УТОЧНИТЬ у PO] |

## Риски

Риски заказчиком не названы.

## Якоря истины

| Факт в БФТ | Источник (якорь) | Ранг | Тип |
| --- | --- | --- | --- |
`

const anchor = anchorLine({ people: PRIMARY.args.people, approvedAt: '2026-11-16T09:00:00Z', taskId: 5 })
const ctxOf = (extra = {}) => checkContext({ fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY, anchor, ...extra })
const section = (text, title) => { const s = text.indexOf(`## ${title}`); const e = text.indexOf('\n## ', s + 3); return text.slice(s, e < 0 ? undefined : e) }

test('объект заявки: решение про объект — его находка; страница платформы без объекта — нет; код строк «Рисков» и «Зависимостей» не сочиняет (раунд 6)', () => {
  const findings = parseSources(SOURCES)
  const byId = (id) => findings.find((f) => f.id === id)
  assert.ok(coversObject(byId('900'), FAST), 'про пропуск')
  assert.ok(!coversObject(byId('901'), FAST), 'про шлагбаум ParkHub, без пропуска — платформа')
  const fixed = autoFix(CANON, ctxOf(), [risksFix, dependencyRowsFix])
  assert.ok(!section(fixed.canon, 'Риски').includes('Пересечение с'), 'строку пересечения пишет модель')
  assert.ok(!section(fixed.canon, 'Зависимости').includes('Опирается на'), 'строку предпосылки пишет модель')
  assert.deepEqual(autoFix(fixed.canon, ctxOf(), [risksFix, dependencyRowsFix]).log, [])
  // Модели — что дописать, с готовой формой строки.
  const ct004 = check(fixed.canon, ctxOf()).warnings.find((w) => w.code === 'CT004')
  assert.ok(ct004 && ct004.message.includes('pageId=900') && ct004.message.includes('Опирается на'), ct004?.message)
})

test('ASIS (раунд 6): код находку в ASIS и «Было» не вставляет — метрика asis_unreconciled остаётся модели', () => {
  const fixed = autoFix(CANON, ctxOf(), FIXES)
  const problem = section(fixed.canon, 'Проблема которую решаем')
  assert.ok(!problem.includes('ASIS актуален?'), problem)
  assert.ok(!section(fixed.canon, 'Изменение в UJM').includes('По [Confluence: Шлагбаумы ParkHub на въезде]'))
  assert.equal(qualityMetrics({ doc: fixed.canon, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics.asis_unreconciled, 1)
})

test('«ДЛЯ КОГО» (раунд 6): заказчик заявки — не персона; конечный пользователь (актор сценария) остаётся', () => {
  const withRow = (cell) => CANON.replace('| **ASIS** |', `| **ДЛЯ КОГО** | ${cell} |\n| **ASIS** |`)
  const doc = withRow('Заказчик (Соколов Пётр); сотрудник, оформляющий пропуск гостю')
  assert.ok(doc.includes('Заказчик (Соколов Пётр)'), 'в фикстуре есть строка «ДЛЯ КОГО»')
  const fixed = autoFix(doc, ctxOf(), [forWhomFix])
  assert.ok(fixed.canon.includes('| **ДЛЯ КОГО** | Сотрудник, оформляющий пропуск гостю |'), section(fixed.canon, 'Проблема которую решаем'))
  assert.deepEqual(autoFix(fixed.canon, ctxOf(), [forWhomFix]).log, [])
  const only = autoFix(withRow('Соколов Пётр'), ctxOf(), [forWhomFix]).canon
  assert.ok(only.includes('| **ДЛЯ КОГО** | [УТОЧНИТЬ у PO: кто пользуется результатом?] |'))
  // Заказчик — сам пользователь (актор заявки): остаётся.
  const user = { args: { ...PRIMARY.args, actors: [{ role: 'Заказчик', quote: 'q' }] } }
  assert.deepEqual(autoFix(doc, ctxOf({ primary: user }), [forWhomFix]).log, [])
})

test('«что если»: источник «alt сценария» — не источник; ответ находкой код не подбирает (раунд 6)', () => {
  const fixed = autoFix(CANON, ctxOf(), [whatIfSourceFix])
  const plan = section(fixed.canon, 'План демонстрации')
  assert.ok(!plan.includes('Частично — [Confluence: Гостевые пропуска'), plan)
  assert.ok(plan.includes('| Номер не указан | Нет | [УТОЧНИТЬ у PO: что происходит в этом случае?] (см. «что если») |'), plan)
  assert.deepEqual(autoFix(fixed.canon, ctxOf(), [whatIfSourceFix]).log, [])
  assert.equal(qualityMetrics({ doc: fixed.canon, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics.whatif_false_negative, 1)
  // «(см. «что если»)» — раздела нет: ссылка ведёт в «План демонстрации».
  assert.ok(autoFix(fixed.canon, ctxOf(), [seeWhatIfFix]).canon.includes('(см. «План демонстрации»)'))
})

test('ветка-отклонение: что видит актор без источника — [УТОЧНИТЬ]; happy path не трогается', () => {
  const fixed = autoFix(CANON, ctxOf(), [altSourceFix])
  const plan = section(fixed.canon, 'План демонстрации')
  assert.ok(plan.includes('  App --> Emp: [УТОЧНИТЬ у PO: что видит Сотрудник?]'), plan)
  assert.ok(plan.includes('  App --> Emp: пропуск создан, статус «Активен»'))
  assert.deepEqual(autoFix(fixed.canon, ctxOf(), [altSourceFix]).log, [])
})

test('«Зависимости»: повтор ключа — один; «смежная задача» без ссылки — вон; строк код не добавляет', () => {
  const deps = section(autoFix(CANON, ctxOf(), [dependencyRowsFix]).canon, 'Зависимости')
  assert.ok(deps.includes('сверить объём с `PARK-40` |'), deps)
  assert.ok(!deps.includes('Смежная задача тарифов'))
  assert.ok(!deps.includes('PARK-77'), 'смежная находка — не параллельная работа')
})

test('имя адресата в одной форме', () => {
  const fixed = autoFix(CANON, ctxOf(), [addresseeFormFix])
  assert.ok(fixed.canon.includes('[УТОЧНИТЬ у Соколова Петра]') && !fixed.canon.includes('Соколова Петр]'))
})

test('SK002: ID скелета в каноне про другое — ошибка с номером для нового требования; цитата не якорит чужое требование; строк «источник не назван» код не пишет', () => {
  const ctx = ctxOf()
  const errors = check(CANON, ctx).errors.filter((e) => e.code === 'SK002')
  assert.equal(errors.length, 1, JSON.stringify(errors))
  assert.match(errors[0].message, /^ФТ-1 /)
  assert.match(errors[0].message, /оставь ID ФТ-1 за требованием скелета.*следующий свободный номер \(ФТ-\d+\)/)
  const anchors = section(autoFix(CANON, ctx, FIXES).canon, 'Якоря истины')
  assert.ok(!anchors.includes('Цвет кнопки отправки (ФТ-1) | Заказчик'), 'цитата про журнал не якорит «цвет кнопки»')
  assert.ok(anchors.includes('| Номер машины уходит в журнал шлагбаума ParkHub | Заказчик Соколов Пётр'), anchors)
  assert.ok(!anchors.includes('Источник требования не назван'), anchors)
  assert.equal(qualityMetrics({ doc: CANON, fastMd: FAST, sourcesMd: SOURCES, primary: PRIMARY }).metrics.anchor_quote_mismatch, 1)
})

test('SK002 (раунд 6): строка канона с одним общим словом из длинной формулировки скелета — тоже дрейф', () => {
  const sk = '### Критичные требования (скелет на цитатах)\n\n| ID | ASIS | TOBE | Связанные | Источник |\n| --- | --- | --- | --- | --- |\n| ФТ-1 | [ASIS не озвучен] | Охрана видит номер машины гостя и время въезда в журнале шлагбаума | БТ-1 | Заказчик: «чтобы охрана видела номер и время» |\n'
  const fast = FAST.replace(/### Критичные требования[\s\S]*?(?=\n### |\n## |$)/, sk)
  const doc = CANON.replace(/\| ФТ-1 \|[^\n]*\n/, '| ФТ-1 | Цвет кнопки и номер версии | Высокий (предварительно) | Кнопка отправки синяя | — | БТ-1 |\n')
  const ctx = checkContext({ fastMd: fast, sourcesMd: SOURCES, primary: PRIMARY, anchor })
  assert.ok(check(doc, ctx).errors.some((e) => e.code === 'SK002' && e.message.startsWith('ФТ-1 ')))
})

test('FIXES целиком на документе раунда 5: идемпотентно', () => {
  const ctx = ctxOf()
  const once = autoFix(CANON, ctx)
  assert.deepEqual(autoFix(once.canon, ctx).log, [])
})
