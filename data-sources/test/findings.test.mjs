// Разбор находок Jira/Confluence из ответов MCP-шлюза и карта для полного БФТ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTriage, cleanBody, confluenceFindings, epicChildren, extractLeads, findingsMarkdown, jiraBrowseBase, jiraFindings, jqlsFor, linkKeys, merge, rank, staleness, stems, synonymsIn, triageItems, typeLabel, statusLabel, unwrap } from '../lib/findings.js'
import { pool } from '../lib/pool.js'
import { parseRpcBody, toolText } from '../lib/mcp.js'

const wrap = (value) => JSON.stringify({ result: JSON.stringify(value) })

const CF = [
  { id: '1000000001', title: 'Интеграция с КЕДО', type: 'page', updated: '2025-07-01 17:35:14 MSK', url: 'https://confluence.example/pages/viewpage.action?pageId=1000000001', space: { key: 'PORTAL' }, content: { value: 'формирования @@@hl@@@заявления@@@endhl@@@ на отпуск' } },
]
const JR = { total: 2, issues: [
  { key: 'HRDOC-1', summary: 'Ошибка в модалке', browse_url: 'https://jira.example/browse/HRDOC-1', description: 'h3. Шаги\r\n!a.png|thumbnail!', status: { name: 'Закрыт' }, issue_type: { name: 'Ошибка' }, project: { key: 'HRDOC' }, updated: '2026-11-12 10:52:58 MSK' },
  { key: 'HRDOC-2', summary: 'Заявление на отпуск в портале', browse_url: 'https://jira.example/browse/HRDOC-2', status: { name: 'В работе' }, issue_type: { name: 'Эпик' }, project: { key: 'HRDOC' }, updated: '2026-10-01 10:00:00 MSK' },
] }

test('ответ шлюза разворачивается из {"result": "<json>"} и без обёртки', () => {
  assert.deepEqual(unwrap(wrap([1])), [1])
  assert.deepEqual(unwrap(JSON.stringify([2])), [2])
})

test('Confluence: страница, пространство, выдержка без подсветки', () => {
  const [page] = confluenceFindings(wrap(CF), 'заявление на отпуск')
  assert.equal(page.kind, 'confluence')
  assert.equal(page.container, 'PORTAL')
  assert.equal(page.snippet, 'формирования заявления на отпуск')
  assert.deepEqual(page.queries, ['заявление на отпуск'])
})

test('Jira: эпик выше ошибки, повторная находка копит hits и запросы', () => {
  const merged = merge([...jiraFindings(wrap(JR), 'отпуск'), ...jiraFindings(wrap(JR), 'заявление')])
  assert.equal(merged[0].id, 'HRDOC-2')
  assert.equal(merged[0].hits, 2)
  assert.deepEqual(merged[0].queries, ['отпуск', 'заявление'])
  assert.equal(merged[1].snippet, 'Шаги')
})

test('ранжирование: без совпадений и инциденты — вон, Confluence и Jira поровну', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'A-1', summary: 'Работы, напрямую не связанные с работой', browse_url: 'u1', issue_type: { name: 'Задача' } },
    { key: 'A-2', summary: 'FW: заявление на отпуск не уходит', browse_url: 'u2', issue_type: { name: 'INC (Remedy)' } },
    { key: 'A-3', summary: 'Переключение графика отпусков на КЭДО', browse_url: 'u3', issue_type: { name: 'Epic' } },
    { key: 'A-4', summary: 'Отпуска в портале: заявление', browse_url: 'u4', issue_type: { name: 'История' } },
  ] }), 'заявление на отпуск')
  const pages = confluenceFindings(wrap([
    { id: '1', title: 'Процесс согласования заявления на отпуск', url: 'c1', content: { value: '' } },
    { id: '2', title: 'Интеграция с КЕДО', url: 'c2', content: { value: 'заявления на отпуск' } },
  ]), 'заявление на отпуск')
  const ranked = rank([...jira, ...pages], ['заявление на отпуск', 'КЭДО отпуск'], 2)
  assert.deepEqual(ranked.map((f) => f.id).sort(), ['1', '2', 'A-3', 'A-4'])
  assert.deepEqual(stems(['Заявление на отпуск']), ['заявл', 'отпус'])
})

test('ранжирование: при равном покрытии эпик выше бага, баг по предмету с полным покрытием не штрафуется', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'B-1', summary: 'Не формируется документ в модалке подписи заявления на отпуск', browse_url: 'b1', issue_type: { name: 'Ошибка' } },
    { key: 'E-1', summary: 'Переключение графика отпусков на КЭДО', browse_url: 'e1', issue_type: { name: 'Epic' } },
    { key: 'B-2', summary: 'Отпуск не отображается в графике', browse_url: 'b2', issue_type: { name: 'Ошибка' } },
  ] }), 'заявление на отпуск')
  const ranked = rank(jira, ['заявление на отпуск'], 5, { subject: ['Заявление на отпуск'] }).map((f) => f.id)
  assert.equal(ranked[0], 'B-1')
  assert.ok(ranked.indexOf('E-1') < ranked.indexOf('B-2'))
})

test('ключи задач в тексте находок — ссылками, уже оформленные не трогаем', () => {
  const base = jiraBrowseBase(jiraFindings(wrap(JR), 'q'))
  assert.equal(base, 'https://jira.example/browse/')
  assert.equal(linkKeys('см. PORTAL-101 и [HRDOC-1](u)', base), 'см. [PORTAL-101](https://jira.example/browse/PORTAL-101) и [HRDOC-1](u)')
  assert.equal(linkKeys('PORTAL-101', undefined), 'PORTAL-101')
  assert.equal(linkKeys('[Jira PORTAL-101](u) и HRDOC-2', base), '[Jira PORTAL-101](u) и [HRDOC-2](https://jira.example/browse/HRDOC-2)')
})

test('JQL: по названию и по тексту, без подзадач и без ORDER BY; кавычки не ломают выражение', () => {
  const jqls = jqlsFor('план "отпусков"')
  assert.deepEqual(jqls.map((j) => j.jql), [
    'summary ~ "план отпусков" AND issuetype not in subTaskIssueTypes()',
    'text ~ "план отпусков" AND issuetype not in subTaskIssueTypes()',
  ])
  assert.deepEqual(jqls.map((j) => j.titleMatch), [true, false])
  for (const { jql } of jqls) assert.doesNotMatch(jql, /ORDER BY/)
})

test('карта находок: готовые markdown-ссылки для БФТ, без голых ключей', () => {
  const findings = merge([...confluenceFindings(wrap(CF), 'q'), ...jiraFindings(wrap(JR), 'q')])
  const md = findingsMarkdown(findings, { source: 'Шлюз агентов', queries: ['q'], at: '2026-11-13 09:00' })
  assert.match(md, /## HRDOC-2 · Заявление на отпуск в портале/)
  assert.match(md, /Ссылка для БФТ: \[Jira HRDOC-2\]\(https:\/\/jira\.example\/browse\/HRDOC-2\)/)
  assert.match(md, /Ссылка для БФТ: \[Confluence: Интеграция с КЕДО\]\(https:\/\/confluence\.example\/pages\/viewpage\.action\?pageId=1000000001\)/)
  assert.doesNotMatch(md, /\[(CF|JR)-\d+\]/)
  assert.match(findingsMarkdown([], { source: 'S', queries: ['x'], at: '' }), /Ничего не найдено/)
})

test('MCP: ответ из потока событий и текст инструмента', () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"ok"}]}}\n\n'
  const message = parseRpcBody('text/event-stream', sse, 3)
  assert.equal(toolText(message.result), 'ok')
  assert.throws(() => toolText({ isError: true, content: [{ type: 'text', text: 'нет доступа' }] }), /нет доступа/)
})

test('токенизация: латиница и CamelCase целиком, «:» и «/» режут, аббревиатуры целиком', () => {
  const [a, b] = [stems(['MarketA']), stems(['MarketsHub'])]
  assert.deepEqual(a, ['marketa'])
  assert.deepEqual(b, ['marketshub'])
  assert.notDeepEqual(a, b)
  assert.deepEqual(stems(['1С:ЗУП']), ['1с', 'зуп'])
  assert.deepEqual(stems(['КЭДО/ЛК портал']), ['кэдо', 'лк', 'порта'])
  assert.deepEqual(stems(['MarketA BE']), ['marketa'])
})

test('аббревиатура совпадает только целым словом', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'L-1', summary: 'ЛКБ2Б: выгрузка счетов', browse_url: 'l1', issue_type: { name: 'Задача' } },
    { key: 'L-2', summary: 'Заказы в ЛК покупателя', browse_url: 'l2', issue_type: { name: 'Задача' } },
  ] }), 'ЛК')
  assert.deepEqual(rank(jira, ['ЛК']).map((f) => f.id), ['L-2'])
})

test('ранжирование: MarketA и MarketsHub не сливаются в одну основу', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'T-1', summary: 'MarketA: партнёрство', browse_url: 't1', issue_type: { name: 'Задача' } },
    { key: 'T-2', summary: 'Виджет MarketsHub', browse_url: 't2', issue_type: { name: 'Задача' } },
  ] }), 'MarketsHub')
  assert.deepEqual(rank(jira, ['виджет MarketsHub']).map((f) => f.id), ['T-2'])
})

test('ранжирование: находка только с процессными словами — без очков, ниже порога', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'G-1', summary: 'Маршрут согласования корректировки плана руководителем', browse_url: 'g1', issue_type: { name: 'Epic' } },
    { key: 'G-2', summary: 'Согласование заявления на отпуск', browse_url: 'g2', issue_type: { name: 'История' } },
    { key: 'G-3', summary: 'Отпуск: календарь', browse_url: 'g3', issue_type: { name: 'История' }, description: 'просто описание' },
  ] }), 'маршрут согласования руководитель')
  const ranked = rank(jira, ['маршрут согласования руководитель', 'заявление на отпуск'], 5).map((f) => f.id)
  assert.ok(!ranked.includes('G-1'))
  assert.equal(ranked[0], 'G-2')
})

test('ранжирование: порог относительный — слабая находка своего вида отсекается, perKind — граница, не квота', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'S-1', summary: 'Промокод за покупку через виджет', browse_url: 's1', issue_type: { name: 'Epic' } },
    { key: 'S-2', summary: 'Перенос изображений', browse_url: 's2', issue_type: { name: 'Задача' }, description: 'виджет' },
  ] }), 'промокод за покупку через виджет')
  assert.deepEqual(rank(jira, ['промокод за покупку через виджет'], 5).map((f) => f.id), ['S-1'])
})

test('ранжирование: предметный фильтр понижает чужое, а без якорных совпадений карта не пустеет', () => {
  const jira = jiraFindings(wrap({ issues: [
    { key: 'P-1', summary: 'Стрим заказов виджета', browse_url: 'p1', issue_type: { name: 'Задача' } },
    { key: 'P-2', summary: 'Промокод за заказ через виджет', browse_url: 'p2', issue_type: { name: 'Задача' } },
    { key: 'P-3', summary: 'Заказы виджета в кабинете', browse_url: 'p3', issue_type: { name: 'Задача' } },
    { key: 'P-4', summary: 'Промокод на скидку', browse_url: 'p4', issue_type: { name: 'Задача' } },
  ] }), 'q')
  const filtered = rank(jira, ['стрим заказов виджета', 'промокод'], 5, { subject: ['Промокод за покупку'] }).map((f) => f.id)
  assert.deepEqual(filtered.slice(0, 2).sort(), ['P-2', 'P-4'])
  assert.equal(filtered.length, 3)
  // Ни одна находка не про предмет — фильтр снимается, карта не пустая.
  const fallback = rank(jira, ['стрим заказов виджета'], 5, { subject: ['Абонемент фитнес'] }).map((f) => f.id)
  assert.ok(fallback.length >= 2)
})

test('ранжирование: совпадение в названии по JQL summary~ — добавка', () => {
  const a = jiraFindings(wrap({ issues: [{ key: 'M-1', summary: 'Промокод виджета', browse_url: 'm1', issue_type: { name: 'Задача' } }] }), 'промокод').map((f) => ({ ...f, titleMatch: true }))
  const b = jiraFindings(wrap({ issues: [{ key: 'M-2', summary: 'Промокод виджета', browse_url: 'm2', issue_type: { name: 'Задача' } }] }), 'промокод')
  assert.deepEqual(rank([...b, ...a], ['промокод виджета']).map((f) => f.id), ['M-1', 'M-2'])
})

test('карта: строка «Тип · Статус», название пространства, давность от метки разведки', () => {
  const pages = confluenceFindings(wrap([{ id: '7', title: 'Старый процесс', url: 'https://c/pages/viewpage.action?pageId=7', space: { key: 'MK', name: 'Маркетинг' }, updated: '2020-01-15 10:00:00', content: { value: 'x' } }]), 'q')
  const issues = jiraFindings(wrap({ issues: [
    { key: 'J-1', summary: 'Эпик', browse_url: 'https://j/browse/J-1', issue_type: { name: 'Epic' }, status: { name: 'В работе' }, updated: '2026-11-01' },
    { key: 'J-2', summary: 'Баг', browse_url: 'https://j/browse/J-2', issue_type: { name: 'Bug' }, status: { name: 'Закрыт' }, updated: '2019-01-01' },
  ] }), 'q')
  const md = findingsMarkdown([...pages, ...issues], { source: 'S', queries: ['q'], at: '2026-11-17 09:00' })
  assert.match(md, /Confluence · MK \(Маркетинг\) · page · 2020-01-15 · давность: 6 лет, актуальность не подтверждена/)
  assert.match(md, /Тип: Страница вики/)
  assert.match(md, /Тип: Эпик \(объём работ\) · Статус: в работе/)
  assert.match(md, /Тип: Ошибка \(дефект\) · Статус: закрыт/)
  // Закрытая задача Jira — без пометки давности.
  assert.doesNotMatch(md, /2019-01-01 · давность/)
  assert.equal(typeLabel({ kind: 'jira', type: 'Подзадача' }), 'Подзадача')
  assert.equal(typeLabel({ kind: 'jira', type: 'Идея' }), '(Идея)')
  assert.equal(statusLabel('Code review'), 'в работе (Code review)')
  assert.equal(staleness({ kind: 'confluence', updated: '2025-01-01' }, '2026-11-17'), undefined)
})

test('тело: без шаблонных разделов, макросов, картинок, повторов; заголовки не ломают карту; режется по строке', () => {
  const raw = [
    'Описание', '========', '', 'Страница описывает сохранение заказа виджета.', '',
    'Общая информация', '================', '', '| Название | ЛК |', '| --- | --- |', '| Ответственный | @Иванов |', '',
    'История изменений', '-----------------', '', 'История изменений', '', '| 1 | 2026-06-05 | @Иванов | Вынес |', '',
    'Архитектура', '===========', '', 'Диаграмма', '---------', '', 'true', '',
    '## Обработка событий', '', 'Сервис потребляет события создания заказов из топика.', '![x](http://img/a.png) [макет](https://www.figma.com/file/abc)', '',
    '| 1 | @Петров | 2026-01-02 |', '| 2 | Kafka | топик заказов |',
  ].join('\n')
  const seen = new Set()
  const body = cleanBody(raw, 4000, seen)
  assert.doesNotMatch(body, /Общая информация|История изменений|@Иванов|^true$|figma|png|Диаграмма/m)
  assert.match(body, /^### Описание$/m)
  assert.match(body, /^#### Обработка событий$/m)
  assert.doesNotMatch(body, /^## /m)
  assert.match(body, /\| 2 \| Kafka \| топик заказов \|/)
  assert.doesNotMatch(body, /@Петров/)
  // Повтор абзаца в следующей находке — вырезается.
  const again = cleanBody('Сервис потребляет события создания заказов из топика.\n\nНовое: промокод списывается при оплате.', 4000, seen)
  assert.doesNotMatch(again, /потребляет/)
  assert.match(again, /промокод/)
  const cut = cleanBody(Array.from({ length: 50 }, (_, i) => `| ${i} | строка таблицы номер ${i} |`).join('\n'), 200)
  assert.ok(cut.length <= 200)
  assert.match(cut, /\|\n…$/)
})

test('пустой эпик — его состав; без детей — явно «описание пустое»', () => {
  const children = jiraFindings(wrap({ issues: [{ key: 'E-2', summary: 'Выдача промокода', browse_url: 'x', status: { name: 'Открыт' } }] }), '')
  assert.equal(epicChildren('E-1', children), 'Состав эпика:\n- E-2 — Выдача промокода (Открыт)')
  assert.equal(epicChildren('E-1', []), '(описание пустое)')
})

test('второй шаг: только подписанные строки и ссылки с предметом в подписи', () => {
  const body = [
    '| Epic | TEAMA-10 |',
    '| Аналитика | [Разбор](https://c/pages/viewpage.action?pageId=55) |',
    'См. также OTHER-1 в тексте без подписи.',
    '* [Промокоды в кассе](https://c/pages/viewpage.action?pageId=77)',
    '* [Посторонняя страница](https://c/pages/viewpage.action?pageId=88)',
  ].join('\n')
  assert.deepEqual(extractLeads('| Решения | * [[DOC\\_1] Промокод: выдача](https://c/pages/viewpage.action?pageId=99) |', ['Промокод'], new Set()).map((l) => [l.id, l.label]), [['99', 'DOC_1 Промокод: выдача']])
  const leads = extractLeads(body, ['Промокод за покупку'], new Set(['jira:KNOWN-1']))
  assert.deepEqual(leads.map((l) => l.id), ['TEAMA-10', '55', '77'])
  assert.deepEqual(extractLeads('| Epic | KNOWN-1 |', ['x'], new Set(['jira:KNOWN-1'])), [])
})

test('синонимы систем: «Имя (Синоним)», одна сторона — система из заявки', () => {
  assert.deepEqual(synonymsIn(['Участники: Система Saleport (Опора), BFF (слой)'], ['ОПОРА', 'Витрина']), [{ system: 'ОПОРА', alias: 'Saleport' }])
  assert.deepEqual(synonymsIn(['Витрина (Storefront)'], ['Витрина']), [{ system: 'Витрина', alias: 'Storefront' }])
  assert.deepEqual(synonymsIn(['Касса (POS)'], ['Витрина']), [])
})

test('триаж: цитата сверяется с текстом, отсеянное — в хвост без ссылки, открытая ошибка той же функции — к рискам', () => {
  const issues = jiraFindings(wrap({ issues: [
    { key: 'R-1', summary: 'Подпись заявления не формируется', browse_url: 'https://j/browse/R-1', issue_type: { name: 'Ошибка' }, status: { name: 'Открыт' }, description: 'При подписании документ \\*не\\* формируется | модалка' },
    { key: 'R-2', summary: 'Чужой продукт', browse_url: 'https://j/browse/R-2', issue_type: { name: 'Задача' }, description: 'что-то' },
    { key: 'R-3', summary: 'Смежное', browse_url: 'https://j/browse/R-3', issue_type: { name: 'Задача' }, description: 'рядом' },
  ] }), 'q')
  const items = triageItems(issues)
  assert.deepEqual(items.map((i) => i.ref), ['R-1', 'R-2', 'R-3'])
  const triaged = applyTriage(issues, [
    { ref: 'R-1', relevance: 'same_function', facts: [{ fact: 'документ не формируется', quote: 'при подписании документ *не* формируется' }, { fact: 'выдумка', quote: 'этого текста в находке нет' }] },
    { ref: 'R-2', relevance: 'unrelated' },
    { ref: 'R-3', relevance: 'adjacent' },
    { ref: 'R-9', relevance: 'same_system' },
    { ref: 'R-3', relevance: 'bogus' },
  ])
  assert.equal(triaged[0].facts.length, 1)
  const md = findingsMarkdown(triaged, { source: 'S', queries: ['q'], at: '2026-11-17' })
  assert.match(md, /## Про ту же систему или функцию[\s\S]*## R-1 · [\s\S]*→ «Риски»[\s\S]*## Смежные и без вердикта[\s\S]*## R-3 · /)
  assert.match(md, /- документ не формируется — «при подписании документ \*не\* формируется»/)
  assert.doesNotMatch(md, /выдумка/)
  const tail = md.slice(md.indexOf('## Отсеяно триажем'))
  assert.match(tail, /- R-2 · Чужой продукт/)
  assert.doesNotMatch(tail, /Ссылка для БФТ|https:/)
  assert.doesNotMatch(md, /Ссылка для БФТ: \[Jira R-2\]/)
})

test('связанные вторым шагом — отдельным блоком «через родителя»', () => {
  const [a] = jiraFindings(wrap({ issues: [{ key: 'V-1', summary: 'Родитель', browse_url: 'https://j/browse/V-1' }] }), 'q')
  const md = findingsMarkdown([a, { ...a, id: 'V-2', title: 'Ребёнок', url: 'https://j/browse/V-2', via: 'V-1' }], { source: 'S', queries: ['q'], at: '' })
  assert.match(md, /## Связанные \(через V-1\)\n\n## V-2 · Ребёнок\nJira/)
})

test('пул: не больше N одновременно, после дедлайна новые не начинаются', async () => {
  let running = 0
  let peak = 0
  const task = () => async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 10)); running--; return 1 }
  const out = await pool(Array.from({ length: 7 }, task), 3, Date.now() + 10_000)
  assert.equal(peak, 3)
  assert.ok(out.every((r) => r?.status === 'fulfilled'))
  const late = await pool([task()], 3, Date.now() - 1)
  assert.equal(late[0], undefined)
})

test('ранжирование: старая страница ровно о предмете не теряется среди шести свежих частных случаев', () => {
  const titles = [
    'Заявление об отпуске по уходу за ребенком до 3 лет',
    'Заявление о предоставлении отпуска по беременности и родам',
    'Заявление о переносе отпуска сотрудника',
    'Заявление на отпуск без сохранения заработной платы',
    'Отзыв из отпуска: заявление работника',
    'Заявление о дополнительном отпуске донора',
  ]
  const pages = confluenceFindings(wrap([
    ...titles.map((title, i) => ({ id: String(10 + i), title, url: `p${i}`, updated: `2025-0${i + 1}-01 10:00:00 MSK`, content: { value: 'заявление на отпуск' } })),
    { id: '1', title: 'Процесс согласования заявления на отпуск', url: 'old', updated: '2020-01-15 10:00:00 MSK', content: { value: 'заявление на отпуск' } },
  ]), 'заявление на отпуск')
  const ranked = rank(pages, ['заявление на отпуск'], 5, { subject: ['Электронное заявление на отпуск в портале'] }).map((f) => f.id)
  assert.ok(ranked.includes('1'), `точная по предмету страница в top-5: ${ranked}`)
  assert.equal(ranked[0], '1')
})

test('статус «Завершено» — закрыт; подпись ссылки не режется посреди слова', () => {
  assert.equal(statusLabel('Завершено'), 'закрыт (Завершено)')
  const title = 'TC-001 [СТ] Отображение виджета PartnerX на мероприятиях PartnerX на витрине MarketA'
  const md = findingsMarkdown([{ kind: 'confluence', id: '1000000002', title, url: 'https://c/pages/viewpage.action?pageId=1000000002', snippet: '', hits: 1, queries: [] }], { source: 's', queries: ['q'], at: '2026-11-17' })
  assert.ok(md.includes('Ссылка для БФТ: [Confluence: TC-001 СТ Отображение виджета PartnerX на мероприятиях PartnerX на витрине MarketA]('), md)
  const long = `${'Очень длинное название страницы '.repeat(8)}конец`
  const label = /Ссылка для БФТ: \[Confluence: ([^\]]+)\]/.exec(findingsMarkdown([{ kind: 'confluence', id: '1', title: long, url: 'u', snippet: '', hits: 1, queries: [] }], { source: 's', queries: ['q'], at: '2026-11-17' }))[1]
  assert.ok(label.endsWith('…') && /(?:страницы|название|длинное|Очень)…$/.test(label), label)
})

test('синонимы: обстоятельство в скобках («из OrdersDB», «Этапе 1») — не другое имя системы', () => {
  assert.deepEqual(synonymsIn(['Заказы виджета PartnerX (из OrdersDB) и PartnerX (Этапе 1)'], ['PartnerX']), [])
  assert.deepEqual(synonymsIn(['Система Saleport (ОПОРА)'], ['ОПОРА']), [{ system: 'ОПОРА', alias: 'Saleport' }])
})

// Раунд 4: полнота разведки. Нейтральный домен — подписка на прокат самокатов (не из заявок портала).
test('ранжирование: эпик в работе про тот же поток с именами продуктов из названия остаётся; чужой продукт с одним общим словом — ниже предметных', () => {
  const subject = ['Скидка RideGo за поездку через агрегатор CityMove', 'Биллинг']
  const jira = jiraFindings(wrap({ issues: [
    // Тот же поток (поездки агрегатора в RideGo), но без слова «скидка» — эпик в работе.
    { key: 'RG-1', summary: 'RideGo показывать поездки из агрегатора CityMove в кабинете', browse_url: 'r1', issue_type: { name: 'Epic' }, status: { name: 'В работе' } },
    // Чужой продукт: общее слово «скидка», ни одного имени из названия.
    { key: 'XX-1', summary: 'Скидка при оплате криптокартой', browse_url: 'x1', issue_type: { name: 'Задача' } },
    { key: 'XX-2', summary: 'Скидка на доставку курьером', browse_url: 'x2', issue_type: { name: 'Задача' } },
    { key: 'RG-2', summary: 'Скидка RideGo сбрасывается на оплате', browse_url: 'r2', issue_type: { name: 'Ошибка' } },
  ] }), 'q')
  const ranked = rank(jira, ['агрегатор CityMove', 'RideGo CityMove', 'скидка'], 5, { subject }).map((f) => f.id)
  assert.ok(ranked.includes('RG-1'), ranked.join())
  assert.ok(ranked.includes('RG-2'), ranked.join())
  for (const noise of ['XX-1', 'XX-2']) assert.ok(!ranked.includes(noise) || ranked.indexOf(noise) > ranked.indexOf('RG-1'), ranked.join())
  // Без имён продуктов в названии — прежнее поведение: одно слово предмета — уже предмет.
  const plain = rank(jira, ['скидка'], 5, { subject: ['Скидка за поездку'] }).map((f) => f.id)
  assert.ok(plain.includes('XX-1'))
})

test('ранжирование: страница процесса того же действия выше свежих частных страниц с одним словом предмета', () => {
  const pages = confluenceFindings(wrap([
    { id: '11', title: 'Аренда', url: 'c11', updated: '2026-11-17', content: { value: 'аренда' } },
    { id: '12', title: 'Аренда 25.11–20.12', url: 'c12', updated: '2026-11-16', content: { value: 'аренда' } },
    { id: '13', title: 'Процесс подтверждения договора аренды', url: 'c13', updated: '2023-01-10', content: { value: 'договор аренды' } },
    { id: '14', title: 'Подписание договора аренды при отправке на подтверждение', url: 'c14', updated: '2024-03-01', content: { value: 'договора аренды' } },
  ]), 'договор аренды')
  const ranked = rank(pages, ['договор аренды'], 5, { subject: ['Электронный договор аренды в портале', '1С:УПП'] }).map((f) => f.id)
  assert.deepEqual(ranked.slice(0, 2).sort(), ['13', '14'])
})

test('триаж: вся карта (до 14 находок), а не первые восемь — иначе хвост остаётся без вердикта и ссылки', () => {
  const many = Array.from({ length: 16 }, (_, i) => ({ kind: 'jira', id: `T-${i}`, title: `t${i}`, url: `u${i}`, snippet: 's', hits: 1, queries: [] }))
  assert.equal(triageItems(many).length, 14)
})

test('раунд 5: объект заявки держит половину мест своего вида — страницы платформы его не вытесняют', () => {
  // Пять страниц о платформе (полное совпадение с запросом «экран Kiosky»), две — о самом объекте (талон).
  const issues = [
    ...[1, 2, 3, 4, 5].map((n) => ({ key: `K-${n}`, summary: `Экран Kiosky: раздел ${n}`, browse_url: `k${n}`, issue_type: { name: 'Эпик' } })),
    { key: 'T-1', summary: 'Талон теряется после оплаты в Kiosky', browse_url: 't1', issue_type: { name: 'Ошибка' } },
    { key: 'T-2', summary: 'Талон Kiosky на очередь', browse_url: 't2', issue_type: { name: 'Задача' } },
  ]
  const jira = jiraFindings(wrap({ issues }), 'q')
  const queries = ['Талон Kiosky', 'экран Kiosky', 'талон']
  const without = rank(jira, queries, 4, { subject: ['Талон через экран Kiosky'] }).map((f) => f.id)
  const withObject = rank(jira, queries, 4, { subject: ['Талон через экран Kiosky'], object: 'Талон' }).map((f) => f.id)
  assert.equal(withObject.length, 4)
  assert.ok(withObject.includes('T-1') && withObject.includes('T-2'), JSON.stringify({ without, withObject }))
})

test('раунд 6: порядок карты не зависит от порядка ответов и от запросов модели — очки по ядру, тай-брейк по ключу', () => {
  const issues = [
    { key: 'D-2', summary: 'Промокод виджета', browse_url: 'd2', issue_type: { name: 'Задача' } },
    { key: 'D-1', summary: 'Промокод виджета', browse_url: 'd1', issue_type: { name: 'Задача' } },
    { key: 'D-3', summary: 'Промокод виджета: ещё', browse_url: 'd3', issue_type: { name: 'Задача' } },
  ]
  const core = jiraFindings(wrap({ issues }), 'промокод виджета')
  const reversed = jiraFindings(wrap({ issues: [...issues].reverse() }), 'промокод виджета')
  assert.deepEqual(rank(core, ['промокод виджета']).map((f) => f.id), rank(reversed, ['промокод виджета']).map((f) => f.id))
  assert.deepEqual(rank(core, ['промокод виджета']).map((f) => f.id).slice(0, 2), ['D-1', 'D-2'], 'равные очки — по ключу')
  // Запрос модели нашёл D-2 ещё раз: очки по ядру от этого не растут, порядок тот же.
  const extra = jiraFindings(wrap({ issues: [issues[0]] }), 'скидка за покупку')
  assert.deepEqual(rank([...core, ...extra], ['промокод виджета']).map((f) => f.id), rank(core, ['промокод виджета']).map((f) => f.id))
})

test('раунд 6: строка «→» — место находки в БФТ по вердикту триажа, типу и статусу', () => {
  const issues = jiraFindings(wrap({ issues: [
    { key: 'B-1', summary: 'Ошибка', browse_url: 'https://j/browse/B-1', issue_type: { name: 'Ошибка' }, status: { name: 'Открыт' } },
    { key: 'B-2', summary: 'Эпик', browse_url: 'https://j/browse/B-2', issue_type: { name: 'Epic' }, status: { name: 'В работе' } },
    { key: 'B-3', summary: 'Готово', browse_url: 'https://j/browse/B-3', issue_type: { name: 'История' }, status: { name: 'Закрыт' } },
    { key: 'B-4', summary: 'Соседнее', browse_url: 'https://j/browse/B-4', issue_type: { name: 'Задача' }, status: { name: 'Открыт' } },
  ] }), 'q')
  const pages = confluenceFindings(wrap([{ id: '9', title: 'Платформа', url: 'https://c/pages/viewpage.action?pageId=9', content: { value: 'x' } }]), 'q')
  const verdicts = [
    { ref: 'B-1', relevance: 'same_function' }, { ref: 'B-2', relevance: 'same_system' }, { ref: 'B-3', relevance: 'same_function' },
    { ref: 'B-4', relevance: 'adjacent' }, { ref: 'page-9', relevance: 'same_system' },
  ]
  const md = findingsMarkdown(applyTriage([...issues, ...pages], verdicts), { source: 'Тест', queries: ['q'], at: '2026-11-18 10:00' })
  const roleOf = (head) => md.split('\n## ').find((b) => b.startsWith(head)).split('\n').find((l) => l.startsWith('→ '))
  assert.match(roleOf('B-1 ·'), /«Риски»: открытая ошибка той же функции/)
  assert.match(roleOf('B-2 ·'), /«Зависимости»: параллельная работа/)
  assert.match(roleOf('B-3 ·'), /решение того же действия: сверь с ASIS/)
  assert.match(roleOf('B-4 ·'), /смежное: не больше строки «Якорей» R2/)
  assert.match(roleOf('Платформа'), /«Зависимости»: предпосылка/)
})
