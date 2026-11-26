// «Все заявки» (ADR-0012, шаг 7; ADR-0029): стадия, чат, документ, артефакты в одно касание.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bftCard } from '../lib-test/bft-list.js'
import { documentOf, requestRow, requestsError, requestsList, requestsShell, stageView } from '../lib-test/requests-page.js'

const urls = { portal: (p) => `https://portal.example/bft${p}`, form: (id) => `https://portal.example/bft/form?id=${id}` }
const item = (taskId, title, status) => ({ sessionId: `sess-${taskId}`, taskId, url: '', title, created: '2026-11-20T10:00:00Z', status, demoApproved: false })
const dialog = bftCard(item(3, 'Выгрузка возвратов <для> партнёров', 'Создан'), {}, urls)
const review = bftCard(item(5, 'Отчёт по возвратам для организаторов', 'Проработка БФТ'), { demo: { approvedAt: 'x' }, fast: {} }, urls)
const ready = bftCard(item(7, 'Сверка выплат площадкам', 'Проработка БФТ'), {
  demo: { approvedAt: 'x' }, fast: { approvedAt: 'y' }, deep: { stage: 'ready' },
  form: { id: 'f-1', publishedAt: 'z', total: 12, answered: 3 },
}, { ...urls, ticket: 'https://tracker.example/tasks/7' })
const failed = bftCard(item(8, 'Напоминания о брошенной корзине', 'Проработка БФТ'), { fast: { approvedAt: 'y' }, deep: { stage: 'failed' } }, urls)
const agreed = bftCard(item(9, 'Скидка по промокоду', 'Согласование'), { fast: { approvedAt: 'y' }, deep: { stage: 'ready' }, lifecycle: { stage: 'validated', waitingFor: [], round: 1 } }, urls)

test('стадия: шаг пути и тон — по циклу, иначе по файлам заявки', () => {
  assert.deepEqual(stageView(dialog), { step: 1, tone: 'idle' })
  assert.deepEqual(stageView(review), { step: 3, tone: 'wait' })
  assert.deepEqual(stageView(ready), { step: 4, tone: 'done' })
  assert.deepEqual(stageView(failed), { step: 4, tone: 'fail' })
  assert.deepEqual(stageView(agreed), { step: 5, tone: 'done' })
  assert.deepEqual(stageView({ stage: 'deep-ready', lifecycle: { stage: 'agreement', waitingFor: ['customer'], round: 1 } }), { step: 5, tone: 'wait' })
})

test('документ — полный БФТ, без него — первичные требования, в диалоге — нет', () => {
  assert.equal(documentOf(ready).kind, 'deep')
  assert.equal(documentOf(review).kind, 'fast')
  assert.equal(documentOf(dialog), undefined)
})

test('строка: чат, документ и артефакты — по одной ссылке, стадия словами и шкалой', () => {
  const row = requestRow(ready)
  assert.match(row, /data-request="7" data-step="4" data-tone="done"/)
  assert.match(row, /<a class="rq-btn" href="https:\/\/portal\.example\/bft\/\?session=sess-7"[^>]*data-act="chat"/)
  assert.match(row, /<a class="rq-btn" href="https:\/\/portal\.example\/bft\/api\/customer-form\.bftFast\?session=sess-7"[^>]*data-act="doc"/)
  assert.match(row, /<details class="rq-art"><summary class="rq-btn">[\s\S]*<span class="rq-cnt">5<\/span>/)
  assert.match(row, /doc=deep&amp;format=docx/, 'выгрузка полного БФТ — в меню артефактов')
  assert.match(row, /Форма вопросов согласования[\s\S]*ответов 3 из 12/)
  assert.match(row, /Полный БФТ готов/)
  assert.match(row, /Шаг 4 из 5 · Полный БФТ/)
  assert.equal((row.match(/<i class="past"/g) ?? []).length, 4, 'готовый шаг закрашен целиком')
  assert.match(row, /ответов 3 из 12/)
})

test('в диалоге: чат есть, документ и артефакты — выключены, без пустых ссылок', () => {
  const row = requestRow(dialog)
  assert.match(row, /data-act="chat"/)
  assert.doesNotMatch(row, /data-act="doc"/)
  assert.equal((row.match(/aria-disabled="true"/g) ?? []).length, 2)
  assert.doesNotMatch(row, /href="#"|href=""/)
  assert.match(row, /Выгрузка возвратов &lt;для&gt; партнёров/, 'название экранировано')
  assert.match(row, /data-search="#3 выгрузка возвратов &lt;для&gt; партнёров в диалоге с заказчиком создан диалог"/)
})

test('список: фильтр по стадии со счётчиками, «Не собран» — только при сбое', () => {
  const html = requestsList([dialog, review, ready, failed, agreed], 'https://portal.example/bft/')
  const chips = [...html.matchAll(/data-filter="([^"]*)" aria-pressed="(\w+)"><span>([^<]+)<\/span><span class="rq-cnt">(\d+)/g)].map((m) => [m[1], m[3], +m[4], m[2]])
  assert.deepEqual(chips, [
    ['', 'Все', 5, 'true'],
    ['1', 'Диалог', 1, 'false'],
    ['3', 'Требования', 1, 'false'],
    ['4', 'Полный БФТ', 2, 'false'],
    ['5', 'Согласование', 1, 'false'],
    ['fail', 'Не собран', 1, 'false'],
  ])
  assert.match(html, /data-total="5">Заявок: 5/)
  assert.equal((html.match(/<li class="rq"/g) ?? []).length, 5)
  assert.match(html, /data-state="nothing" hidden/)
  assert.doesNotMatch(requestsList([dialog], ''), /data-filter="fail"/)
})

test('много заявок: строки в порядке трекера, счётчики сходятся', () => {
  const many = Array.from({ length: 120 }, (_, i) => bftCard(item(i + 1, `Заявка ${i + 1}`), i % 3 ? { fast: {} } : {}, urls))
  const html = requestsList(many, '')
  assert.equal((html.match(/<li class="rq"/g) ?? []).length, 120)
  assert.match(html, /data-filter="1" aria-pressed="false"><span>Диалог<\/span><span class="rq-cnt">40</)
  assert.match(html, /data-filter="3" aria-pressed="false"><span>Требования<\/span><span class="rq-cnt">80</)
})

test('пустой список — экран «Заявок пока нет» со ссылкой в чат портала', () => {
  const html = requestsList([], 'https://portal.example/bft/')
  assert.match(html, /data-state="empty"/)
  assert.match(html, /Заявок пока нет/)
  assert.match(html, /href="https:\/\/portal\.example\/bft\/"/)
  assert.doesNotMatch(html, /rq-filters/)
})

test('ошибка трекера — что случилось и «Повторить», без alert()', () => {
  const html = requestsError()
  assert.match(html, /role="alert"/)
  assert.match(html, /Трекер не ответил/)
  assert.match(html, /data-retry/)
})

test('страница: скелет загрузки, поиск, ошибка-шаблон, скрипт синтаксически цел', () => {
  const page = requestsShell('https://portal.example/bft/')
  assert.match(page, /<section id="rqBox" aria-busy="true"/)
  assert.equal((page.match(/<li class="rq sk">/g) ?? []).length, 5)
  assert.match(page, /<input id="rqQ" type="search"/)
  assert.match(page, /<template id="rqErr">[\s\S]*data-retry/)
  assert.match(page, /fetch\("customer-form\.requests\?part=list"/)
  assert.match(page, /<h1>Все заявки<\/h1>/)
  assert.doesNotMatch(page, /alert\(/)
  const js = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  assert.equal(js.length, 1)
  assert.doesNotThrow(() => new Function(js[0]))
  // Шкала отступов скилла: только 0/2/4/8/12/16/24/32/40/48/64 в padding/gap/margin.
  const css = /<style>([\s\S]*?)<\/style>/.exec(page)[1]
  const bad = [...css.matchAll(/(?:padding|margin|gap)[a-z-]*:([^;}]+)/g)].flatMap((m) => m[1].match(/-?\d+px/g) ?? []).filter((v) => ![0, 2, 4, 8, 12, 16, 24, 32, 40, 48, 64].includes(Math.abs(parseInt(v))))
  assert.deepEqual(bad, [])
  const sizes = [...css.matchAll(/font:\s*\d+ (\d+)px\/(\d+)px/g)].map((m) => `${m[1]}/${m[2]}`)
  assert.ok(sizes.every((s) => ['12/16', '14/20', '16/24', '24/32'].includes(s)), sizes.join(' '))
})
