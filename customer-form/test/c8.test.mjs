// Список вопросов, хвост «Продолжить» портала, status и дата (план качества, C8).
// Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANON_SECTIONS, continueBlock, deepHead, splitCanon, statusLine, stripOpenQuestions } from '../lib-test/bft-deep.js'
import { isLoopbackUrl, isoToday, openFieldPrompt, publicPortalUrl, requestRef } from '../lib-test/bft-fast.js'
import { check, checkContext, LEAKS } from '../lib-test/canon-check.js'
import { canonQuestions, collectQuestions, groupQuestions, QUESTIONS_MAX, questionsHtml, questionsMarkdown, realQuestion, UNASSIGNED } from '../lib-test/questions.js'
import { customerMarkdown } from '../lib-test/export.js'
import { canonOf, qualityMetrics } from '../lib-test/quality-metrics.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const GOLDEN = join(ROOT, 'skills/bft-deep-swarm/examples/golden_deep_document.md')
const OPEN_FIELD = join(ROOT, 'skills/bft-fast/resources/open_field.md')
const LINT = join(ROOT, 'skills/bft-writer/scripts/bft-lint.py')
const golden = readFileSync(GOLDEN, 'utf8')
const goldenHead = golden.slice(0, golden.indexOf('## Проблема которую решаем'))

const withEnv = (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v
  try { return fn() } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v
  }
}

test('isLoopbackUrl и publicPortalUrl: loopback и пустой адрес — без ссылки', () => {
  for (const url of ['http://127.0.0.1:3080', 'http://localhost/bft', 'http://[::1]:8080', 'http://127.1.2.3']) assert.ok(isLoopbackUrl(url), url)
  for (const url of ['https://portal.example.org/bft', 'http://10.0.0.5', 'не адрес']) assert.ok(!isLoopbackUrl(url), url)
  withEnv({ PORTAL_PUBLIC_URL: undefined }, () => assert.equal(publicPortalUrl('/api/x'), undefined))
  withEnv({ PORTAL_PUBLIC_URL: 'http://127.0.0.1:3080' }, () => assert.equal(publicPortalUrl('/api/x'), undefined))
  // Префикс /bft/ сохраняется: адрес строится от базы PORTAL_PUBLIC_URL.
  withEnv({ PORTAL_PUBLIC_URL: 'https://portal.example.org/bft/' }, () => assert.equal(publicPortalUrl('/api/x?s=1'), 'https://portal.example.org/bft/api/x?s=1'))
  assert.equal(requestRef('заявка #7', undefined), 'заявка #7')
  assert.equal(requestRef('заявка #7', 'https://p.example.org/a'), '[заявка #7](https://p.example.org/a)')
})

test('isoToday: ISO по Москве', () => {
  assert.match(isoToday(), /^\d{4}-\d{2}-\d{2}$/)
  // 22:30 UTC 31 декабря — в Москве уже 1 января.
  assert.equal(isoToday(new Date('2026-12-31T22:30:00Z')), '2027-01-01')
})

test('continueBlock: без loopback, путей навыка, «границы», /bft-deep и «в чат»; разделы — из CANON_SECTIONS', () => {
  const tail = continueBlock('заявка #7', '2026-11-17')
  assert.ok(tail.startsWith('## Продолжить / уточнить БФТ\n'))
  for (const bad of [/127\.0\.0\.1|localhost|\[::1\]/, /\.claude\//, /\/opt\/bft-skills/, /границ/i, /\/bft-deep/, /в чат/, /одиннадцат/]) assert.doesNotMatch(tail, bad)
  for (const title of CANON_SECTIONS) assert.ok(tail.includes(title.replace(/\*$/, '')), title)
  assert.ok(tail.includes('«Что нужно для согласования»'))
  assert.ok(tail.includes('2026-11-17'))
  for (const leak of LEAKS) assert.doesNotMatch(tail, leak.re)
})

test('документ портала: шапка эталона + канон + хвост портала — LK001 нет, bft-lint без ERROR', () => {
  const doc = `${goldenHead}${canonOf(golden)}\n\n${continueBlock('[заявка #7](https://portal.example.org/bft/api/customer-form.bftFast?session=s1)', '2026-11-17')}\n`
  const ctx = checkContext({ fastMd: goldenHead })
  assert.deepEqual(check(doc, ctx).errors.filter((f) => f.code === 'LK001'), [])
  assert.equal(qualityMetrics({ doc, fastMd: goldenHead }).metrics.leak_count, 0)
  if (!existsSync(LINT)) return
  const dir = mkdtempSync(join(tmpdir(), 'c8-'))
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
    const errors = Object.values(JSON.parse(out)).flat().filter((f) => f.level === 'ERROR')
    assert.deepEqual(errors, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('LK001: хвост эталона навыка (промт Claude Code) — утечка', () => {
  const found = check(golden, checkContext({ fastMd: goldenHead })).errors.filter((f) => f.code === 'LK001')
  assert.ok(found.some((f) => /\.claude/.test(f.message)))
  assert.ok(found.some((f) => /ответом в чат/.test(f.message)))
  const loop = check('## Риски\n\nсм. http://127.0.0.1:3456/tasks/1\n\n```text\npython3 /opt/bft-skills/x.py\n```\n', checkContext({ fastMd: '' })).errors
  assert.deepEqual(loop.map((f) => f.code), ['LK001', 'LK001'], 'и в тексте, и в fenced-блоке')
})

test('statusLine и deepHead: строка status по факту разведки', () => {
  const fast = '---\nversion: 0.1\nsynced: 2026-11-01\nstatus: Черновик 0.1 (fast — шапка; deep не запускался)\nstage: fast\n---\n\n# [БФТ] lib-1: Бронь\n'
  const fresh = deepHead(fast, '2026-11-17', { mode: 'fresh', source: 'Jira и Confluence', count: 4 })
  assert.match(fresh, /^status: Черновик 0\.2 \(deep — собран в портале; источники: Jira и Confluence, находок 4 — указатель, не фактбаза; git не подключался\)$/m)
  assert.match(fresh, /^synced: 2026-11-17$/m)
  assert.match(fresh, /^stage: deep$/m)
  assert.match(statusLine({ mode: 'previous', source: 'Jira и Confluence', count: 3 }), /прошлая карта находок \(3\), Jira и Confluence в этот раз недоступен/)
  assert.match(statusLine({ mode: 'none', source: 'Jira и Confluence', count: 0 }), /Jira и Confluence опрошены, находок нет; git не подключался/)
  assert.match(statusLine({ mode: 'unavailable', source: '', count: 0 }), /Confluence, JIRA и git не подключались/)
  assert.match(deepHead(fast, '2026-11-17'), /Confluence, JIRA и git не подключались/)
})

const CANON = `## Проблема которую решаем

Текст.

## Функциональные требования*

| ID | Функциональные требования | Приоритет | Параметры, ограничения |
|---|---|---|---|
| ФТ-1 | Читатель видит бронь в личном кабинете | Высокий (предварительно) | Срок брони — [УТОЧНИТЬ у PO: сколько дней держится бронь?] |
| ФТ-2 | Уведомление о конце брони | Средний (предварительно) | [УТОЧНИТЬ] канал уведомления |
| ФТ-3 | Отмена брони | [УТОЧНИТЬ у PO] | — |

## Зависимости

| Команда | Что нужно |
|---|---|
| Каталог | [УТОЧНИТЬ у команды Каталог: формат выдачи статуса книги?] |

## Риски

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Книгу забрали без брони | [УТОЧНИТЬ у PO: сколько дней держится бронь?] | — | — |

\`\`\`text
| ФТ-9 | [УТОЧНИТЬ у никого] |
\`\`\`
`

test('canonQuestions (раунд 4): только адресные маркеры с настоящим вопросом; голый, без вопроса и fenced — нет', () => {
  const qs = canonQuestions(CANON)
  assert.deepEqual(qs.map((q) => q.text), ['Сколько дней держится бронь?', 'Формат выдачи статуса книги?', 'Сколько дней держится бронь?'])
  const [a, b] = qs
  assert.deepEqual(a, { text: 'Сколько дней держится бронь?', addressee: 'PO', refs: [{ id: 'ФТ-1', section: 'Функциональные требования' }] })
  assert.deepEqual(b, { text: 'Формат выдачи статуса книги?', addressee: 'команды Каталог', refs: [{ id: 'Каталог', section: 'Зависимости' }] })
  assert.equal(qs[2].refs[0].id, 'Книгу забрали без брони')
})

test('collectQuestions (раунд 4): обрывки и пересказ риска — вон; близкие дубли — один пункт со всеми ссылками; группы по адресату; не больше десяти', () => {
  const noisy = `${CANON}
## Нефункциональные требования*

| ID | Описание |
|---|---|
| НФТ-1 | Срок — ; [УТОЧНИТЬ у PO: срок — ;] |
| НФТ-2 | [УТОЧНИТЬ у PO: статус?] |
| НФТ-3 | [УТОЧНИТЬ у PO: сколько дней держится бронь] |
| НФТ-4 | [УТОЧНИТЬ у PO: как долго держится бронь книги, сколько дней?] |

Макеты — [УТОЧНИТЬ у дизайнера — готовы ли макеты карточки?]
`
  const list = collectQuestions({ canon: noisy })
  const stay = list.filter((q) => /держится бронь/.test(q.text))
  assert.equal(stay.length, 1, list.map((q) => q.text).join(' | '))
  assert.deepEqual(stay[0].refs.map((r) => r.id), ['ФТ-1', 'Книгу забрали без брони', 'НФТ-3', 'НФТ-4'])
  assert.ok(!list.some((q) => /^Срок|^Статус/.test(q.text)), 'обрывок и служебное слово — не вопросы')
  assert.ok(list.some((q) => q.addressee === 'дизайнера' && q.text === 'Готовы ли макеты карточки?'), 'маркер в прозе, адресат через «—»')
  assert.ok(!list.some((q) => q.addressee === UNASSIGNED))
  assert.equal(realQuestion('Один промокод на одну покупку — ; размер скидки'), false)
  assert.equal(realQuestion('Открытая ошибка: при переходе на страницу оплаты скидка сбрасывается, приоритет высокий, в бэклоге с прошлого года, исправление не запланировано ни в одном спринте, команда не назначена, оценки нет'), false)
  const topics = ['цвет обложки', 'размер штрафа', 'часы работы', 'лимит книг', 'возраст читателя', 'формат билета', 'язык интерфейса', 'канал рассылки', 'срок продления', 'место выдачи', 'правило очереди', 'тип залога', 'период отчёта', 'порог напоминания']
  const many = topics.map((t, i) => `| ФТ-${i + 10} | x | y | [УТОЧНИТЬ у PO: какой ${t}?] |`).join('\n')
  assert.equal(collectQuestions({ canon: `## Функциональные требования*\n\n| ID | a | b | Параметры |\n|---|---|---|---|\n${many}\n` }).length, QUESTIONS_MAX)
  const groups = groupQuestions(list)
  assert.equal(groups[0].addressee, 'PO')
})

test('splitCanon: хвост «Открытые вопросы» не попадает в канон и возвращается списком', () => {
  const answer = `${CANON}\n---\n\n**Открытые вопросы (в чат, не в документ):**\n1. Кто продлевает бронь?\n- Нужна ли очередь?\n`
  const { canon, extraQuestions } = splitCanon(answer)
  assert.doesNotMatch(canon, /Открытые вопросы/)
  assert.deepEqual(extraQuestions, ['Кто продлевает бронь?', 'Нужна ли очередь?'])
  assert.deepEqual(splitCanon(CANON).extraQuestions, [])
})

test('раунд 4 stripOpenQuestions: абзац, жирный, заголовок любого уровня, с пояснением и без двоеточия, в середине и в конце', () => {
  const tail = '## Якоря истины\n\n| Факт | Источник | Ранг | Тип |\n| --- | --- | --- | --- |\n| x | y | R3 | Решение заказчика |'
  const variants = [
    `${tail}\n\n---\n\nОткрытые вопросы для согласования (выведены в ответ сессии, не в документ):\n1. Кто продлевает бронь?\n2. Нужна ли очередь?\n`,
    `${tail}\n\n**Открытые вопросы**\n\n- Кто продлевает бронь?\n- Нужна ли очередь?\n`,
    `${tail}\n\n#### Открытые вопросы (в чат)\n\n- Кто продлевает бронь?\n- Нужна ли очередь?\n`,
    `${tail}\n\nОткрытые вопросы: Кто продлевает бронь?\n- Нужна ли очередь?\n`,
    `${tail}\n\n__Открытые вопросы — сводка:__\n* Кто продлевает бронь?\n* Нужна ли очередь?`,
  ]
  for (const v of variants) {
    const { text, items } = stripOpenQuestions(v)
    assert.equal(text.trimEnd(), tail, v)
    assert.deepEqual(items.map((i) => i.replace(/^.*?(Кто|Нужна)/, '$1')), ['Кто продлевает бронь?', 'Нужна ли очередь?'], v)
  }
  // В середине канона: блок уходит, следующий раздел остаётся целиком.
  const mid = `## Риски\n\nРиски заказчиком не названы.\n\n### Открытые вопросы\n\n1. Кто продлевает бронь?\n\n${tail}\n`
  const out = stripOpenQuestions(mid).text
  assert.ok(out.includes('Риски заказчиком не названы.\n\n## Якоря истины'), out)
  assert.doesNotMatch(out, /Открытые вопросы|продлевает/)
  // Через splitCanon (вариант раунда 3: абзац без жирного перед хвостом «Продолжить»).
  const canon = splitCanon(`## Проблема которую решаем\n\nТекст.\n\n${variants[0]}\n## Продолжить / уточнить БФТ\n\nхвост`).canon
  assert.doesNotMatch(canon, /Открытые вопросы|продлевает|^---$/m)
  // Ячейка таблицы со словами «Открытые вопросы приёма» — не блок.
  const cell = '| Размер | Открытые вопросы приёма | — | [УТОЧНИТЬ у PO] |'
  assert.equal(stripOpenQuestions(cell).text, cell)
})

test('блок «Что нужно для согласования»: группы, пустой список, выгрузка — перед каноном', () => {
  const list = collectQuestions({ canon: CANON })
  const md = questionsMarkdown(list)
  assert.ok(md.startsWith('## Что нужно для согласования\n'))
  assert.ok(md.includes('**Спросить у PO**'))
  assert.ok(!md.includes(`**${UNASSIGNED}**`), 'без адресата — не вопрос списка')
  assert.ok(md.includes('- Сколько дней держится бронь? — ФТ-1 (Функциональные требования), Книгу забрали без брони (Риски)'))
  assert.match(questionsMarkdown([]), /Открытых вопросов нет/)
  assert.match(questionsHtml([]), /Открытых вопросов нет/)
  assert.doesNotMatch(questionsHtml([{ text: '<b>x</b>', addressee: 'PO', refs: [] }]), /<b>x/)
  const doc = `---\nstage: deep\n---\n\n# [БФТ] lib-1\n\n## Шапка\n\nтекст\n\n${CANON}\n${continueBlock('заявка #7', '2026-11-17')}\n`
  const out = customerMarkdown(doc, list)
  assert.ok(out.indexOf('## Что нужно для согласования') < out.indexOf('## Проблема которую решаем'))
  assert.ok(out.indexOf('## Шапка') < out.indexOf('## Что нужно для согласования'))
  assert.doesNotMatch(out, /Продолжить \/ уточнить/)
  assert.doesNotMatch(customerMarkdown(doc), /Что нужно для согласования/)
})

test('открытое поле fast в портале: путь навыка PO, без /opt/bft-skills и «в чат»', { skip: !existsSync(OPEN_FIELD) }, () => {
  const prompt = openFieldPrompt(readFileSync(OPEN_FIELD, 'utf8'), { slug: 'lib-1', howToDemo: [], source: 'заявка #7', skillsPath: '/opt/bft-skills' })
  assert.doesNotMatch(prompt, /\/opt\/bft-skills/)
  assert.doesNotMatch(prompt, /в чат/)
  assert.doesNotMatch(prompt, /<skills_path>/)
  assert.match(prompt, /python3 \.claude\/skills\/bft-writer\/scripts\/bft-lint\.py/)
  assert.match(prompt, /- Источник Summary: заявка #7$/m)
})
