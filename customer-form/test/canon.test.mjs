// Разбор канона, каркас проверок и метрики качества (план качества, C0).
// Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCanon, renderCanon, renderTable, sectionOf, columnOf, splitRow } from '../lib-test/canon-table.js'
import { asisPlaceholderFix, autoFix, check, checkContext, parseSkeleton, parseSources, RULES } from '../lib-test/canon-check.js'
import { canonOf, demoResults, qualityMetrics } from '../lib-test/quality-metrics.js'
import { cleanCanon } from '../lib-test/bft-deep.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GOLDEN = join(ROOT, 'skills/bft-deep-swarm/examples/golden_deep_document.md')
const LINT = join(ROOT, 'skills/bft-writer/scripts/bft-lint.py')
const golden = readFileSync(GOLDEN, 'utf8')

test('эталон: разбор → сборка даёт тот же текст байт-в-байт', () => {
  assert.equal(renderCanon(parseCanon(golden)), golden)
  const canon = canonOf(golden)
  assert.ok(canon.startsWith('## Проблема которую решаем'))
  assert.equal(renderCanon(parseCanon(canon)), canon)
})

test('эталон: разделы и таблицы', () => {
  const parsed = parseCanon(golden)
  const ft = sectionOf(parsed, 'Функциональные требования')
  assert.ok(ft, 'раздел ФТ найден без «*»')
  assert.equal(ft.tables.length, 1)
  assert.equal(columnOf(ft.tables[0], 'Приоритет'), 2)
  assert.deepEqual(ft.tables[0].rows.map((r) => r.cells[0]), ['ФТ-1', 'ФТ-2', 'ФТ-3', 'ФТ-4'])
  const actors = sectionOf(parsed, 'План демонстрации').tables.find((t) => t.subsection === 'Акторы')
  assert.equal(actors.header[0], 'Актор')
  // Таблиц внутри ```plantuml нет, а «что если» под тем же разделом — есть.
  assert.ok(sectionOf(parsed, 'План демонстрации').tables.some((t) => t.header[0] === 'What-if'))
})

test('правка ячейки меняет только свою строку; удаление строки сдвигает текст', () => {
  const parsed = parseCanon(golden)
  const table = sectionOf(parsed, 'Функциональные требования').tables[0]
  table.rows[0].cells[2] = 'Средний'
  const out = renderCanon(parsed).split('\n')
  const before = golden.split('\n')
  const changed = out.map((l, i) => (l === before[i] ? -1 : i)).filter((i) => i >= 0)
  assert.deepEqual(changed, [table.rows[0].line])
  table.rows.splice(1, 1)
  assert.equal(renderCanon(parsed).split('\n').length, before.length - 1)
})

test('ячейки: экранированная черта — не разделитель; пустые ячейки сохраняются', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a \\| b', 'c'])
  assert.deepEqual(splitRow('|  |  |'), ['', ''])
  assert.deepEqual(renderTable({ header: ['A', 'B'], separator: '|---|---|', rows: [{ cells: ['', 'x'], line: 0 }] }), ['| A | B |', '|---|---|', '|  | x |'])
})

test('таблица внутри ``` не разбирается', () => {
  const md = '## Раздел\n\n```text\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n'
  assert.equal(parseCanon(md).sections[0].tables.length, 0)
  assert.equal(renderCanon(parseCanon(md)), md)
})

const FAST = `### How to demo

1. Экран А: открыть раздел → видна форма
2. Нажать «Отправить» → статус «Отправлено»

### Критичные требования (скелет на цитатах)

Требования:

| ID | ASIS (сейчас) | TOBE (после) | Связанные | Источник (цитата) |
|---|---|---|---|---|
| БТ-1 | [ASIS не озвучен] | Быстрее оформлять |  | Заказчик: «быстрее» |
| ПТ-1 | [ASIS не озвучен] | Пользователь отправляет форму | БТ-1 | Заказчик: «отправляю» |

### Общая информация
`

test('скелет fast: ID → TOBE → цитата, связи', () => {
  const rows = parseSkeleton(FAST)
  assert.deepEqual(rows.map((r) => r.id), ['БТ-1', 'ПТ-1'])
  assert.equal(rows[1].tobe, 'Пользователь отправляет форму')
  assert.equal(rows[1].quote, 'Заказчик: «отправляю»')
  assert.deepEqual(rows[1].related, ['БТ-1'])
  assert.deepEqual(demoResults(FAST), ['видна форма', 'статус «Отправлено»'])
})

const SOURCES = `# Корпоративные источники

Источник: тест · 2026-01-01 10:00. Запросы: «форма».
Это указатель.

## ABC-12 · Форма заявки
Jira · ABC · Эпик · В работе · 2025-03-01
Ссылка для БФТ: [Jira ABC-12](https://jira.example/browse/ABC-12)

> выдержка

## Страница формы
Confluence · SPACE · page · 2024-01-02
Ссылка для БФТ: [Confluence: Страница формы](https://wiki.example/pages/viewpage.action?pageId=42)

Тело страницы.
`

test('sources.md (формат findingsMarkdown) → находки', () => {
  const [jira, page] = parseSources(SOURCES)
  assert.equal(jira.kind, 'jira')
  assert.equal(jira.id, 'ABC-12')
  assert.equal(jira.title, 'Форма заявки')
  assert.equal(jira.type, 'Эпик')
  assert.equal(jira.status, 'В работе')
  assert.equal(jira.updated, '2025-03-01')
  assert.equal(jira.citation, '[Jira ABC-12](https://jira.example/browse/ABC-12)')
  assert.equal(page.kind, 'confluence')
  assert.equal(page.id, '42')
  assert.equal(page.container, 'SPACE')
  assert.equal(page.body, 'Тело страницы.')
})

test('autoFix без правок — тот же текст; правка пишет в лог; check делит ERROR и WARN', () => {
  const ctx = checkContext({ fastMd: FAST, sourcesMd: SOURCES })
  assert.equal(ctx.skeleton.length, 2)
  assert.equal(ctx.findings.length, 2)
  const canon = canonOf(golden)
  assert.deepEqual(autoFix(canon, ctx, []), { canon, log: [] })
  const upper = { name: 'upper', apply(parsed, _ctx, log) { sectionOf(parsed, 'Риски').tables[0].rows[0].cells[1] = 'Низкая'; log.push('риск') } }
  const fixed = autoFix(canon, ctx, [upper])
  assert.deepEqual(fixed.log, ['риск'])
  assert.notEqual(fixed.canon, canon)
  const broken = { name: 'broken', apply() { throw new Error('boom') } }
  assert.equal(autoFix(canon, ctx, [broken]).canon, canon)
  const rules = [
    { code: 'T1', level: 'ERROR', run: () => [{ message: 'e' }] },
    { code: 'T2', level: 'WARN', run: () => [{ message: 'w', line: 3 }] },
  ]
  const result = check(golden, ctx, rules)
  assert.deepEqual(result.errors.map((f) => f.code), ['T1'])
  assert.deepEqual(result.warnings, [{ code: 'T2', level: 'WARN', message: 'w', line: 3 }])
  // Эталон со своей шапкой проходит все проверки портала без замечаний — кроме LK001:
  // хвост эталона — промт Claude Code навыка (пути .claude/, «ушёл ответом в чат»), в портале его нет.
  const goldenCtx = checkContext({ fastMd: golden.slice(0, golden.indexOf('## Проблема которую решаем')) })
  const portalRules = RULES.filter((r) => r.code !== 'LK001')
  assert.deepEqual(check(golden, goldenCtx, portalRules), { errors: [], warnings: [] })
  assert.ok(check(golden, goldenCtx).errors.every((f) => f.code === 'LK001'))
})

test('метрики на эталоне: висящий ID ловится, Summary в каноне считается', () => {
  const fast = golden.slice(0, golden.indexOf('## Проблема которую решаем'))
  const { metrics, details } = qualityMetrics({ doc: golden, fastMd: fast, quality: { attempts: 1, lintErrorsByAttempt: [0], checkErrorsByAttempt: [0], warnings: [] }, stage: 'ready' })
  // Эталон после C2: висящих ссылок нет («(см. НФТ-2)» → «(см. ФТ-4)»).
  assert.deepEqual(details.dangling_ids, [])
  assert.equal(metrics.dangling_ids, 0)
  assert.equal(metrics.lint_first_pass, true)
  assert.ok(metrics.forbidden_mentions > 0)
  assert.equal(metrics.FT_count, 4)
  assert.equal(metrics.IT_without_PT, 0)
  assert.equal(metrics.asis_known, false)
  assert.equal(metrics.asis_false_gap, 0)
  assert.equal(metrics.risk_ratings_unconfirmed, 0, 'строка риска эталона подтверждена PO')
  assert.equal(typeof metrics.coverage_demo, 'number')
  // Утечки считаются по всему документу: у эталона они в хвосте «Продолжить» (пути .claude/), в каноне их нет.
  assert.ok(metrics.leak_count > 0)
  assert.equal(qualityMetrics({ doc: canonOf(golden), fastMd: fast }).metrics.leak_count, 0)
})

test('регрессия: bft-lint.py пропускает эталон без ERROR', { skip: !existsSync(LINT) }, () => {
  let out
  try {
    out = execFileSync('python3', [LINT, '--format', 'json', GOLDEN], { encoding: 'utf8' })
  } catch (e) {
    if (e.code === 'ENOENT') return // python3 нет — проверка в образе портала
    out = e.stdout
  }
  const findings = Object.values(JSON.parse(out)).flat()
  assert.deepEqual(findings.filter((f) => f.level === 'ERROR'), [])
})

test('cleanCanon: ```plantuml внутри канона не теряет закрывающую черту', () => {
  const canon = canonOf(golden).trim()
  assert.equal(cleanCanon(golden), canon)
  assert.equal(cleanCanon('```markdown\n' + canon + '\n```'), canon)
  assert.ok(cleanCanon(canon + '\n\n```text\nхвост\n```\n').includes('@enduml\n```'))
  assert.equal((cleanCanon('```markdown\n' + canon + '\n```').match(/```/g) ?? []).length, 2)
})

test('C1 autoFix: «[ASIS не озвучен] — пояснение» без ссылки → голый плейсхолдер; со ссылкой — без правки', () => {
  const ctx = checkContext({ fastMd: FAST })
  const canon = canonOf(golden)
  const fixed = autoFix(canon, ctx, [asisPlaceholderFix])
  // В эталоне ровно одна такая ячейка — ASIS в «Проблеме».
  assert.equal(fixed.log.length, 1)
  assert.match(fixed.canon, /\| \*\*ASIS\*\* \| `\[ASIS не озвучен\]` \|/)
  assert.deepEqual(autoFix(fixed.canon, ctx, [asisPlaceholderFix]).log, [])
  const linked = canon.replace('`[ASIS не озвучен]` — текущее поведение карточек и страниц на встрече не обсуждалось',
    '[ASIS не озвучен заказчиком; по [Jira ABC-12](https://jira.example/browse/ABC-12), 2020: форма уже есть]')
  assert.equal(autoFix(linked, ctx, [asisPlaceholderFix]).log.length, 0)
})
