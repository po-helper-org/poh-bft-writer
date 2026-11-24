// Отправка БФТ в Confluence (ADR-0028): преобразование в storage-формат (детерминизм,
// корпоративная структура), выбор родительской страницы (ссылка, ТОП-5), повторная
// отправка — обновление той же страницы (двойник Confluence в памяти), панель на странице.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bftToStorage, diagramFileName, inline, plantumlSources, publishableMarkdown } from '../lib-test/confluence-storage.js'
import { ConfluenceWriter, parentQueries, parsePageRef, publishActivities, publishConfigFromEnv, rankParents, readPublishState, sourcePages } from '../lib-test/confluence-publish.js'
import { withConfluence } from '../lib-test/confluence-publish-page.js'

const DOC = `---
source: "[УТОЧНИТЬ — не опубликовано]"
pageId: pending
version: 0.3
synced: 2026-11-20
status: Черновик
epic_slug: zayavka-7
stage: deep
---

# [БФТ] zayavka-7: Отчёт по **возвратам** для организаторов

<!-- BFT-HEAD-END -->

## Шапка (сутевое описание запроса)

### Цель

| SMART | Значение |
|---|---|
| S (Specific) | Организатор видит возвраты в кабинете |
| T (Time-bound) | [УТОЧНИТЬ] |

### How to demo

1. Открываю раздел «Возвраты» → вижу фильтры
2. Нажимаю «Скачать в Excel» → скачивается файл
   - строки те же, что на экране

### Общая информация

| Поле | Значение |
| --- | --- |
| Задача/Epic Jira | [DEMO-12](https://jira.example.test/browse/DEMO-12) |

## Проблема которую решаем

Текст с \`кодом\`, *курсивом*, ~~старым~~ и ссылкой [страница](https://wiki.example.test/pages/viewpage.action?pageId=42) & знаком <тег>.
Вторая строка абзаца.

> Цитата заказчика

## План демонстрации

\`\`\`plantuml
@startuml
actor Org
Org -> LK: открывает «Возвраты»
@enduml
\`\`\`

<details>
<summary>▶ Подробный контекст</summary>

Свёрнутый текст.

</details>

## Функциональные требования*

| Идентификатор | Наименование | Приоритет | Функциональные требования | Параметры, ограничения | Связанные требования |
| --- | --- | --- | --- | --- | --- |
| ФТ-1 | Отбор | Высокий | Система показывает возвраты по периоду | a \\| b | БТ-1 |

## Продолжить / уточнить БФТ

Служебный блок для PO — на страницу не идёт.
`

/** Баланс тегов XHTML (парсера XML в node нет): каждое открытие закрыто, вложенность верна. */
function wellFormed(xhtml) {
  const stack = []
  const body = xhtml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m
    if (self) continue
    if (close) { if (stack.pop() !== name) return false } else stack.push(name)
  }
  return stack.length === 0 && !/&(?!amp;|lt;|gt;|quot;)/.test(body)
}

test('преобразование детерминировано: тот же документ → то же тело байт в байт', () => {
  const a = bftToStorage(DOC, { diagrams: [diagramFileName(1)] })
  const b = bftToStorage(DOC, { diagrams: [diagramFileName(1)] })
  assert.equal(a.body, b.body)
  assert.equal(createHash('sha256').update(a.body).digest('hex'), createHash('sha256').update(b.body).digest('hex'))
  assert.deepEqual(a, b)
  // CRLF и лишний перевод строки в конце — то же тело.
  assert.equal(bftToStorage(DOC.replace(/\n/g, '\r\n') + '\n', { diagrams: [diagramFileName(1)] }).body, a.body)
  // В теле нет времени отправки: версия и дата — из frontmatter.
  assert.match(a.body, /документ версия 0\.3 от 2026-11-20/)
})

test('корпоративная структура: заголовок — H1, без frontmatter и служебного, таблицы, макросы', () => {
  const page = bftToStorage(DOC, { diagrams: [diagramFileName(1)] })
  assert.equal(page.title, '[БФТ] zayavka-7: Отчёт по возвратам для организаторов')
  assert.deepEqual(page.labels, ['bft', 'bft-zayavka-7'])
  assert.equal(page.slug, 'zayavka-7')
  assert.ok(wellFormed(page.body), 'XHTML сбалансирован')
  assert.doesNotMatch(page.body, /<h1>|epic_slug|BFT-HEAD-END|Продолжить \/ уточнить|Служебный блок/)
  assert.match(page.body, /^<ac:structured-macro ac:name="info">/)
  assert.match(page.body, /<ac:structured-macro ac:name="toc">/)
  assert.match(page.body, /<h2>Шапка \(сутевое описание запроса\)<\/h2>/)
  assert.match(page.body, /<h3>Общая информация<\/h3>/, '«Общая информация» — блок корпоративного шаблона, остаётся')
  assert.match(page.body, /<h2>Функциональные требования\*<\/h2>/)
  assert.match(page.body, /<tr><th>Идентификатор<\/th><th>Наименование<\/th><th>Приоритет<\/th>/)
  assert.match(page.body, /<td>a \| b<\/td>/, 'экранированная черта — внутри ячейки')
  assert.match(page.body, /<ol><li>Открываю раздел «Возвраты» → вижу фильтры<\/li><li>Нажимаю «Скачать в Excel» → скачивается файл<ul><li>строки те же, что на экране<\/li><\/ul><\/li><\/ol>/)
  assert.match(page.body, /<ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">DEMO-12<\/ac:parameter><\/ac:structured-macro>/)
  assert.match(page.body, /<a href="https:\/\/wiki\.example\.test\/pages\/viewpage\.action\?pageId=42">страница<\/a> &amp; знаком &lt;тег&gt;\./)
  assert.match(page.body, /<code>кодом<\/code>, <em>курсивом<\/em>, <del>старым<\/del>/)
  assert.match(page.body, /<blockquote><p>Цитата заказчика<\/p><\/blockquote>/)
  assert.match(page.body, /<ac:image ac:align="center"><ri:attachment ri:filename="bft-diagram-1.png"\/><\/ac:image>/)
  assert.match(page.body, /<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Подробный контекст<\/ac:parameter><ac:rich-text-body><p>Свёрнутый текст.<\/p><\/ac:rich-text-body>/)
  assert.doesNotMatch(page.body, /@startuml/, 'отрендеренная схема — картинкой, не кодом')
  assert.deepEqual(page.diagrams, plantumlSources(DOC))
  assert.equal(page.diagrams.length, 1)
})

test('схема не отрендерилась — исходник в свёрнутом блоке с [УТОЧНИТЬ], а не голым кодом', () => {
  const page = bftToStorage(DOC)
  assert.match(page.body, /\[УТОЧНИТЬ: схема не отрендерилась/)
  assert.match(page.body, /<ac:parameter ac:name="title">Схема 1 \(PlantUML\)<\/ac:parameter><ac:rich-text-body><ac:structured-macro ac:name="code"><ac:plain-text-body><!\[CDATA\[@startuml/)
  assert.ok(wellFormed(page.body))
  assert.match(bftToStorage('# T\n\n```text\na ]]> b\n```\n').body, /a ]]]]><!\[CDATA\[> b/, ']]> внутри кода не ломает CDATA')
})

test('publishableMarkdown и inline: служебное срезано, snake_case не курсив', () => {
  const { title, body } = publishableMarkdown(DOC)
  assert.equal(title, '[БФТ] zayavka-7: Отчёт по возвратам для организаторов')
  assert.ok(!body.includes('Служебный блок'))
  assert.equal(inline('file_name_here и **жирный**'), 'file_name_here и <strong>жирный</strong>')
  assert.equal(inline('[x](javascript:void)'), 'x', 'не http(s) — без ссылки')
})

test('ссылка или ввод → страница: id, адреса Confluence, короткая ссылка, название', () => {
  assert.deepEqual(parsePageRef('https://wiki.example.test/pages/viewpage.action?pageId=123456'), { pageId: '123456' })
  assert.deepEqual(parsePageRef('https://example.atlassian.net/wiki/spaces/DEMO/pages/98765/Раздел+БФТ'), { pageId: '98765' })
  assert.deepEqual(parsePageRef('https://wiki.example.test/display/DEMO/Раздел+БФТ'), { space: 'DEMO', title: 'Раздел БФТ' })
  assert.deepEqual(parsePageRef('  4242 '), { pageId: '4242' })
  assert.deepEqual(parsePageRef('https://wiki.example.test/x/AbCd12'), { tiny: 'https://wiki.example.test/x/AbCd12' })
  assert.deepEqual(parsePageRef('Требования кабинета'), { query: 'Требования кабинета' })
  assert.deepEqual(parsePageRef('https://intranet.example.test/some/page'), { query: 'https://intranet.example.test/some/page' })
  assert.equal(parsePageRef('   '), undefined)
})

test('ТОП-5 родителей: порядок источников, детерминизм при перестановке, исключение своей страницы', () => {
  const candidates = [
    { id: '10', title: 'Кабинет организатора', source: 'search', rank: 0, via: 'возвраты' },
    { id: '11', title: 'Разное', source: 'search', rank: 5, via: 'возвраты' },
    { id: '12', title: 'БФТ команды кабинета', source: 'sibling', via: '[БФТ] zayavka-3: Выплаты', space: 'DEMO' },
    { id: '13', title: 'Регламент возвратов', source: 'sources' },
    { id: '14', title: 'Архив БФТ', source: 'previous' },
    { id: '15', title: 'Ещё страница', source: 'search', rank: 1, via: 'возвраты' },
    { id: '16', title: 'Совсем мимо', source: 'search', rank: 7, via: 'кабинет' },
    { id: '99', title: 'Сама страница БФТ', source: 'previous' },
    { id: 'abc', title: 'не id', source: 'search', rank: 0 },
    { id: '10', title: 'Кабинет организатора', source: 'search', rank: 2, via: 'кабинет' },
  ]
  const top = rankParents(candidates, { exclude: ['99'] })
  assert.equal(top.length, 5)
  assert.deepEqual(top.map((t) => t.id), ['14', '12', '10', '13', '15'])
  assert.match(top[0].reasons[0], /уже публиковали/)
  assert.match(top[1].reasons[0], /похожий БФТ «\[БФТ\] zayavka-3: Выплаты»/)
  assert.deepEqual(top[2].reasons, ['найдено поиском: «возвраты», «кабинет»'], 'два запроса — одна причина')
  assert.deepEqual(rankParents([{ id: '1', title: 'Шаблон. БФТ № [команда]', source: 'search', rank: 0 }, { id: '2', title: 'Скрипты', source: 'search', rank: 6 }]).map((t) => t.id), ['2', '1'], 'шаблон — ниже')
  for (let i = 0; i < 5; i++) {
    const shuffled = [...candidates].sort(() => Math.random() - 0.5)
    assert.deepEqual(rankParents(shuffled, { exclude: ['99'] }), top)
  }
})

test('запросы поиска родителя и страницы из карты находок', () => {
  assert.deepEqual(parentQueries('[БФТ] zayavka-7: Отчёт по возвратам для организаторов', ['Кабинет организатора']),
    ['Отчёт по возвратам для организаторов', 'Отчёт возвратам организаторов', 'Кабинет организатора БФТ', 'Кабинет организатора'])
  const md = '# Корпоративные источники\n\n## Регламент возвратов\nConfluence · DEMO\nСсылка для БФТ: [Confluence: Регламент](https://wiki.example.test/pages/viewpage.action?pageId=777)\n\n## Задача\nСсылка для БФТ: [DEMO-1](https://jira.example.test/browse/DEMO-1)\n'
  assert.deepEqual(sourcePages(md), [{ id: '777', title: 'Регламент возвратов', url: 'https://wiki.example.test/pages/viewpage.action?pageId=777' }])
})

test('настройка публикации — только при адресе и ключе', () => {
  assert.equal(publishConfigFromEnv({}), undefined)
  assert.equal(publishConfigFromEnv({ CONFLUENCE_PUBLISH_URL: 'https://wiki.example.test' }), undefined)
  assert.deepEqual(publishConfigFromEnv({ CONFLUENCE_PUBLISH_URL: 'https://wiki.example.test/', CONFLUENCE_PUBLISH_TOKEN: ' t ' }), { baseUrl: 'https://wiki.example.test', token: 't' })
})

/** Двойник REST API Confluence в памяти: страницы, метки, вложения. */
function fakeConfluence() {
  const pages = new Map([['100', { id: '100', title: 'Раздел БФТ', space: { key: 'DEMO' }, version: { number: 1 }, ancestors: [], labels: [], attachments: [] }]])
  let next = 500
  const calls = []
  const view = (p) => ({ id: p.id, title: p.title, space: p.space, version: p.version, ancestors: p.ancestors, _links: { webui: `/pages/viewpage.action?pageId=${p.id}` } })
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url)
    const method = init.method ?? 'GET'
    calls.push(`${method} ${u.pathname}`)
    assert.equal(init.headers.authorization, 'Bearer secret-token')
    const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    let m
    if ((m = /^\/rest\/api\/content\/(\d+)$/.exec(u.pathname))) {
      const p = pages.get(m[1])
      if (!p) return ok({ message: 'not found' }, 404)
      if (method === 'GET') return ok(view(p))
      const body = JSON.parse(init.body)
      assert.equal(body.version.number, p.version.number + 1)
      Object.assign(p, { title: body.title, body: body.body.storage.value, version: { number: body.version.number }, ancestors: body.ancestors.map((a) => ({ id: a.id, title: pages.get(a.id)?.title })) })
      return ok(view(p))
    }
    if (u.pathname === '/rest/api/content' && method === 'GET') {
      const found = [...pages.values()].filter((p) => p.title === u.searchParams.get('title') && p.space.key === u.searchParams.get('spaceKey'))
      return ok({ results: found.map(view) })
    }
    if (u.pathname === '/rest/api/content' && method === 'POST') {
      const body = JSON.parse(init.body)
      if ([...pages.values()].some((p) => p.title === body.title)) return ok({ message: 'title exists' }, 400)
      const p = { id: String(next++), title: body.title, space: body.space, version: { number: 1 }, ancestors: body.ancestors.map((a) => ({ id: a.id, title: pages.get(a.id)?.title })), body: body.body.storage.value, labels: [], attachments: [] }
      pages.set(p.id, p)
      return ok(view(p))
    }
    if ((m = /^\/rest\/api\/content\/(\d+)\/label$/.exec(u.pathname))) {
      const p = pages.get(m[1])
      if (method === 'POST') for (const l of JSON.parse(init.body)) if (!p.labels.includes(l.name)) p.labels.push(l.name)
      return ok({ results: p.labels.map((name) => ({ name })) })
    }
    if ((m = /^\/rest\/api\/content\/(\d+)\/child\/attachment(?:\/(\d+)\/data)?$/.exec(u.pathname))) {
      const p = pages.get(m[1])
      if (method === 'GET') return ok({ results: p.attachments.map((a) => ({ id: a.id, title: a.title, extensions: { fileSize: a.size } })) })
      assert.equal(init.headers['x-atlassian-token'], 'no-check')
      const file = init.body.get('file')
      if (m[2]) { const a = p.attachments.find((x) => x.id === m[2]); a.size = file.size; a.versions++; return ok({ id: a.id, title: a.title }) }
      const a = { id: String(next++), title: file.name, size: file.size, versions: 1 }
      p.attachments.push(a)
      return ok({ results: [{ id: a.id, title: a.title }] })
    }
    return ok({ message: `не ожидали ${method} ${u.pathname}` }, 500)
  }
  return { pages, calls, writer: new ConfluenceWriter({ baseUrl: 'https://wiki.example.test', token: 'secret-token' }, fetchImpl) }
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'cf-publish-'))
  await mkdir(join(dir, 'confluence'), { recursive: true })
  const md = join(dir, 'zayavka-7.md')
  await writeFile(md, DOC, 'utf8')
  const docx = join(dir, 'zayavka-7.docx')
  await writeFile(docx, 'DOCX')
  const fake = fakeConfluence()
  const announced = []
  const acts = publishActivities({
    files: () => ({ dir, md }),
    writer: () => fake.writer,
    exportDoc: async (_slug, _md, format) => { if (format === 'pdf') throw new Error('weasyprint нет'); return docx },
    renderPng: async (_src, out) => { await writeFile(out, 'PNG'); return true },
    now: () => '2026-11-24T12:00:00.000Z',
  })
  const req = (run) => ({ taskId: 7, slug: 'zayavka-7', sessionId: 's-7', run, parent: { id: '100', title: 'Раздел БФТ' } })
  const publish = async (run) => {
    const r = req(run)
    const render = await acts.confluenceRender(r)
    const page = await acts.confluenceUpsertPage(r, render)
    const attach = await acts.confluenceAttach(r, render, page)
    const fin = await acts.confluenceFinish(r, render, page, attach)
    return { render, page, attach, fin }
  }
  return { dir, fake, acts, announced, publish, req }
}

test('отправка: создаёт подстраницу, повторная — обновляет ту же, вложения без изменений не грузит', async () => {
  const { dir, fake, announced, publish, acts: a1 } = await setup()
  const first = await publish(1)
  assert.equal(first.page.mode, 'create')
  assert.deepEqual(first.render.attachments.map((a) => a.name), ['bft-diagram-1.png', 'zayavka-7.docx'])
  assert.match(first.render.warnings.join(), /\.pdf не собралась/)
  const page = fake.pages.get(first.page.pageId)
  assert.equal(page.ancestors[0].id, '100')
  assert.equal(page.title, '[БФТ] zayavka-7: Отчёт по возвратам для организаторов')
  assert.equal(page.body, await readFile(join(dir, 'confluence', 'page.xhtml'), 'utf8'))
  assert.deepEqual(page.labels, ['bft', 'bft-zayavka-7'])
  assert.deepEqual(first.attach.uploaded, ['bft-diagram-1.png', 'zayavka-7.docx'])
  assert.equal(first.fin.url, `https://wiki.example.test/pages/viewpage.action?pageId=${first.page.pageId}`)
  const state = await readPublishState(dir)
  assert.equal(state.pageId, first.page.pageId)
  assert.equal(state.publishedAt, '2026-11-24T12:00:00.000Z')
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'confluence.json'), 'utf8')), { url: first.fin.url, at: '2026-11-24T12:00:00.000Z', by: 'портал', pageId: first.page.pageId })

  const second = await publish(2)
  assert.equal(second.page.mode, 'update')
  assert.equal(second.page.pageId, first.page.pageId, 'та же страница — без дубля')
  assert.equal(fake.pages.size, 2, 'родитель + одна страница БФТ')
  assert.equal(fake.pages.get(first.page.pageId).version.number, 2)
  assert.deepEqual(second.attach.uploaded, [])
  assert.deepEqual(second.attach.skipped, ['bft-diagram-1.png', 'zayavka-7.docx'])
  assert.deepEqual(announced, [])
  // Родители похожих страниц — для ТОП-5 («здесь лежит похожий БФТ»).
  assert.deepEqual(await a1.confluenceAncestors(['100', 'x', '9999', first.page.pageId]), [{ id: '100', space: 'DEMO' }, { id: first.page.pageId, space: 'DEMO', parent: { id: '100', title: 'Раздел БФТ' } }])
})

test('страницу удалили из состояния — находит свою по названию и метке; чужая с тем же названием — отказ', async () => {
  const { dir, fake, publish } = await setup()
  const first = await publish(1)
  await writeFile(join(dir, 'confluence-publish.json'), JSON.stringify({ runs: 1 }), 'utf8')
  const again = await publish(2)
  assert.equal(again.page.pageId, first.page.pageId)
  assert.equal(again.page.mode, 'update')

  fake.pages.get(first.page.pageId).labels = []
  await writeFile(join(dir, 'confluence-publish.json'), JSON.stringify({ runs: 2 }), 'utf8')
  await assert.rejects(publish(3), (e) => e.type === 'ConfluenceRejected' && /созданная не порталом/.test(e.message))
})

test('отказы Confluence: нет родителя — без повтора; нет ключа — без повтора; 5xx — с повтором', async () => {
  const { acts, req } = await setup()
  const r = { ...req(1), parent: { id: '404', title: 'Нет такой' } }
  const render = await acts.confluenceRender(r)
  await assert.rejects(acts.confluenceUpsertPage(r, render), (e) => e.type === 'ConfluenceRejected' && e.nonRetryable && /Нет такой/.test(e.message))

  const dir = await mkdtemp(join(tmpdir(), 'cf-nokey-'))
  await writeFile(join(dir, 'a.md'), DOC)
  const noKey = publishActivities({ files: () => ({ dir, md: join(dir, 'a.md') }), writer: () => undefined, exportDoc: async () => { throw new Error('нет') } })
  const rr = await noKey.confluenceRender(req(1))
  await assert.rejects(noKey.confluenceUpsertPage(req(1), rr), (e) => e.nonRetryable && /CONFLUENCE_PUBLISH_TOKEN/.test(e.message))

  const down = new ConfluenceWriter({ baseUrl: 'https://wiki.example.test', token: 't' }, async () => new Response('bad gateway', { status: 502 }))
  const flaky = publishActivities({ files: () => ({ dir, md: join(dir, 'a.md') }), writer: () => down, exportDoc: async () => { throw new Error('нет') } })
  await assert.rejects(flaky.confluenceUpsertPage(req(1), rr), (e) => e.type === 'ConfluenceRetry' && !e.nonRetryable && /временно недоступен \(502\)/.test(e.message))
  const denied = new ConfluenceWriter({ baseUrl: 'https://wiki.example.test', token: 't' }, async () => new Response('{"message":"no"}', { status: 401 }))
  await assert.rejects(publishActivities({ files: () => ({ dir, md: join(dir, 'a.md') }), writer: () => denied, exportDoc: async () => '' }).confluenceUpsertPage(req(1), rr),
    (e) => e.nonRetryable && /не принял ключ/.test(e.message) && !/\bt\b/.test(e.message.replace(/[а-яё]/gi, '')))
})

test('документ ещё не собран — преобразование отказывает без повтора', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cf-empty-'))
  const acts = publishActivities({ files: () => ({ dir, md: join(dir, 'none.md') }), writer: () => undefined, exportDoc: async () => '' })
  await assert.rejects(acts.confluenceRender({ taskId: 1, slug: 'zayavka-1', sessionId: 's', run: 1, parent: { id: '1', title: 'x' } }), (e) => e.nonRetryable && /не собран/.test(e.message))
})

test('страница БФТ: вкладка в рейке боковых панелей, без рейки — кнопка под «Скачать»', () => {
  const withRail = withConfluence('<html><body><main><h1>T</h1></main><nav class="cs-rail" aria-label="Панели БФТ"><button>Вопросы</button><a class="cs-rail-tab plan">Планирование</a></nav></body></html>', 's/1')
  assert.match(withRail, /Планирование<\/a><button type="button" class="cs-rail-tab cf" data-cs-cf[^>]*>⇪ В Confluence<\/button><\/nav>/)
  assert.match(withRail, /<aside class="cs-cf" id="csCf"/)
  assert.match(withRail, /var S="s%2F1"/, 'сессия в скрипте — закодирована')
  assert.ok(withRail.indexOf('id="cs-cf-script"') < withRail.indexOf('</body>'))
  const noRail = withConfluence('<body><h1>T</h1><div class="cs-download" id="customer-download-deep"><span>Скачать:</span><a>docx</a></div><p>x</p></body>', 's')
  assert.match(noRail, /<a>docx<\/a><\/div><button type="button" class="cs-cf-btn" data-cs-cf>⇪ Отправить в Confluence<\/button><p>x<\/p>/)
})
