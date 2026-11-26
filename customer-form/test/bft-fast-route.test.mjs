// Страница БФТ заявки (customer-form.bftFast): неполное и нестандартное состояние
// заявки на диске не роняет страницу в 500. Фикстуры обезличены.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bftFastPage, readDeepStateLenient, withNotes } from '../lib-test/bft-fast-route.js'
import { docHash } from '../lib-test/bft-fast.js'
import { planFiles } from '../lib-test/plan.js'

const SESSION = 'session-00000000-0000-4000-8000-000000000001'
const TASK = 7
const SLUG = `zayavka-${TASK}`

const FAST_MD = '# Пример заявки: выгрузка заказов\n\nКраткое описание.\n'
const FAST_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>[БФТ] ${SLUG}</title></head><body><main>
<h1>Пример заявки: выгрузка заказов</h1>
<h3>How to demo</h3>
<ol><li>Открыть раздел заказов</li><li>Проверить выгрузку</li></ol>
<h3>Общая информация</h3><p>Поля для PO</p>
<h2>Требования</h2><p>БТ-1 Заказы выгружаются раз в сутки.</p>
</main></body></html>`
const DEEP_HTML = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Полный БФТ</title></head><body><main>
<h1>Пример заявки: выгрузка заказов</h1>
<h2>Требования</h2><p>ФТ-1 Выгрузка формирует файл [УТОЧНИТЬ у аналитика: формат].</p>
</main></body></html>`

const QUESTION = { text: 'Какой формат файла?', addressee: 'аналитик', refs: [] }
const FORM_LAYER = {
  sessionId: SESSION,
  questions: [{ qid: 'q1', text: QUESTION.text, addressee: QUESTION.addressee, refs: [], side: 'customer', priority: 'high' }],
  answers: {}, removed: [], version: 1,
  api: { create: 'create', revoke: 'revoke', edit: 'edit', inbox: 'inbox' },
}
const DEMO = { title: 'Проверка выгрузки', where: 'тестовый стенд', steps: [{ screen: 'Заказы', action: 'Открыть', expect: 'Список' }], done: ['Файл выгружен'] }
const PRIMARY = {
  args: { people: [{ name: 'Аналитик А.', role: 'аналитик' }] },
  howToDemo: ['Открыть раздел заказов'], checklist: ['Файл выгружен'], where: 'тестовый стенд', brief: {},
}

/**
 * Заявка в каталоге, как её оставляет портал: быстрая версия согласована, полный БФТ
 * собран, у заявки форма вопросов. `over` — что поменять или убрать (null — файла нет).
 */
async function request(over = {}) {
  const root = await mkdtemp(join(tmpdir(), 'bft-fast-route-'))
  const dir = join(root, SLUG)
  await mkdir(dir, { recursive: true })
  const files = {
    [`${SLUG}-fast.md`]: FAST_MD,
    [`${SLUG}-fast.html`]: FAST_HTML,
    'approval.json': JSON.stringify({ rev: docHash(FAST_MD), approvedAt: '2026-01-10T10:00:00.000Z' }),
    'primary.json': JSON.stringify(PRIMARY),
    'deep.json': JSON.stringify({ stage: 'ready', startedAt: '2026-01-10T10:01:00.000Z', finishedAt: '2026-01-10T10:05:00.000Z', attempts: 1, quality: {}, questions: [QUESTION] }),
    [`${SLUG}.html`]: DEEP_HTML,
    [`${SLUG}.md`]: '# Пример заявки: выгрузка заказов\n',
    // Нестандартное, что встречается у живых заявок: резервные копии и ссылка на форму.
    'deep.json.bak-2026-01-09': '{"stage":"ready"',
    'form.json': JSON.stringify({ id: '00000000-0000-4000-8000-0000000000f1' }),
    ...over.files,
  }
  for (const [name, text] of Object.entries(files)) if (text !== null) await writeFile(join(dir, name), text, 'utf8')
  if (over.plan) await mkdir(join(dir, "plan"), { recursive: true })
  for (const [name, text] of Object.entries(over.plan ?? {})) await writeFile(planFiles(dir)[name], text, 'utf8')
  const logged = []
  const deps = {
    root,
    ticket: async (id) => (id === SESSION ? { taskId: TASK } : undefined),
    progress: () => over.progress,
    demo: () => ('demo' in over ? over.demo : DEMO),
    formLayer: over.formLayer ?? (async () => FORM_LAYER),
    href: (p) => `.${p}`,
    settingsHref: './admin?to=settings',
    log: (m, e) => logged.push([m, e]),
  }
  return { root, deps, logged }
}

async function open(over, query = '') {
  const r = await request(over)
  try {
    const res = await bftFastPage(new URL(`http://portal.test/api/customer-form.bftFast?session=${SESSION}${query}`), r.deps)
    return { status: res.status, html: await res.text(), logged: r.logged }
  } finally { await rm(r.root, { recursive: true, force: true }) }
}

test('регрессия: полная заявка (fast согласован, deep собран, форма) — 200, полный БФТ со всеми слоями', async () => {
  const { status, html, logged } = await open()
  assert.equal(status, 200)
  assert.match(html, /ФТ-1 Выгрузка формирует файл/)
  assert.match(html, /Полный БФТ · по согласованным первичным требованиям/)
  assert.doesNotMatch(html, /Показано не всё из заявки/)
  assert.deepEqual(logged, [])
})

test('?view=fast — первичные требования с зонами и сценарием приёмки', async () => {
  const { status, html } = await open({}, '&view=fast')
  assert.equal(status, 200)
  assert.match(html, /БТ-1 Заказы выгружаются/)
  assert.doesNotMatch(html, /ФТ-1/)
  assert.match(html, /Аналитик А\./)
})

test('?full=1 — канонический документ как есть', async () => {
  const { status, html } = await open({}, '&full=1')
  assert.equal(status, 200)
  assert.equal(html, FAST_HTML)
})

test('нет заявки или нет быстрой версии — 404 с пояснением, не 500', async () => {
  const r = await request()
  try {
    const none = await bftFastPage(new URL('http://portal.test/api/customer-form.bftFast?session=other'), r.deps)
    assert.equal(none.status, 404)
    const empty = await bftFastPage(new URL('http://portal.test/api/customer-form.bftFast'), r.deps)
    assert.equal(empty.status, 404)
    assert.match(await empty.text(), /ещё не собрана/)
  } finally { await rm(r.root, { recursive: true, force: true }) }
  const { status } = await open({ files: { [`${SLUG}-fast.html`]: null } })
  assert.equal(status, 404)
  const thrown = await request()
  thrown.deps.ticket = async () => { throw new Error('трекер недоступен') }
  try {
    const res = await bftFastPage(new URL(`http://portal.test/api/customer-form.bftFast?session=${SESSION}`), thrown.deps)
    assert.equal(res.status, 404)
  } finally { await rm(thrown.root, { recursive: true, force: true }) }
})

test('идёт сборка быстрой версии — экран ожидания', async () => {
  const { status, html } = await open({ progress: { stage: 'building', startedAt: '2999-01-01T00:00:00.000Z' } })
  assert.equal(status, 200)
  assert.match(html, /Уже готовлю БФТ-документ/)
})

/**
 * Каждая часть состояния, которую читает маршрут, — отсутствующая, битая и
 * частично заполненная. Страница всегда 200; `expect` — что на ней должно быть.
 */
const CASES = [
  // fast: <slug>-fast.md и approval.json
  ['fast: нет <slug>-fast.md (версия неизвестна)', { files: { [`${SLUG}-fast.md`]: null } }, /БТ-1/],
  ['fast: нет approval.json', { files: { 'approval.json': null } }, /БТ-1/],
  ['fast: approval.json битый', { files: { 'approval.json': '{"rev":' } }, /БТ-1/],
  ['fast: approval.json — null', { files: { 'approval.json': 'null' } }, /БТ-1/],
  ['fast: согласована другая версия', { files: { 'approval.json': JSON.stringify({ rev: 'old', approvedAt: '2026-01-01T00:00:00Z' }) } }, /БТ-1/],
  ['fast: approval без approvedAt', { files: { 'approval.json': JSON.stringify({ rev: docHash(FAST_MD) }) } }, /БТ-1/],
  ['fast: html без заголовка и разделов', { files: { [`${SLUG}-fast.html`]: '<p>черновик</p>', 'deep.json': null } }, /черновик/],
  // primary.json
  ['primary: нет файла', { files: { 'primary.json': null, 'deep.json': null } }, /БТ-1/],
  ['primary: битый JSON', { files: { 'primary.json': '{"args"', 'deep.json': null } }, /primary\.json\) не читаются/],
  ['primary: нет args', { files: { 'primary.json': JSON.stringify({ howToDemo: [] }), 'deep.json': null } }, /БТ-1/],
  ['primary: people не массив', { files: { 'primary.json': JSON.stringify({ args: { people: 'Аналитик' } }), 'deep.json': null } }, /БТ-1/],
  ['primary: people с пустыми записями', { files: { 'primary.json': JSON.stringify({ args: { people: [null, { role: 'x' }, { name: 'Аналитик Б.' }] } }), 'deep.json': null } }, /Аналитик Б\./],
  ['primary: null', { files: { 'primary.json': 'null', 'deep.json': null } }, /primary\.json\) не читаются/],
  // сценарий приёмки (demos.json)
  ['demo: нет', { demo: undefined, files: { 'deep.json': null } }, /Открыть раздел заказов/],
  ['demo: без шагов', { demo: { title: 'x', where: 'y' }, files: { 'deep.json': null } }, /Сценарий приёмки сохранён не полностью/],
  // deep: deep.json и <slug>.html
  ['deep: нет deep.json — первичные требования', { files: { 'deep.json': null } }, /БТ-1/],
  ['deep: deep.json битый (недописан)', { files: { 'deep.json': '{"stage":"rea' } }, /deep\.json\) не читается/],
  ['deep: deep.json — null', { files: { 'deep.json': 'null' } }, /deep\.json\) не читается/],
  ['deep: deep.json — массив', { files: { 'deep.json': '[]' } }, /deep\.json\) не читается/],
  ['deep: неизвестный этап', { files: { 'deep.json': JSON.stringify({ stage: 'queued' }) } }, /deep\.json\) не читается/],
  ['deep: этап без startedAt', { files: { 'deep.json': JSON.stringify({ stage: 'ready' }) } }, /ФТ-1/],
  ['deep: собирается без startedAt', { files: { 'deep.json': JSON.stringify({ stage: 'building' }) } }, /Пишу полный БФТ-документ/],
  ['deep: ошибка без текста', { files: { 'deep.json': JSON.stringify({ stage: 'failed' }) } }, /неизвестная ошибка/],
  ['deep: ошибка — объект', { files: { 'deep.json': JSON.stringify({ stage: 'failed', error: { code: 1 } }) } }, /Не получилось собрать полный документ/],
  ['deep: собран, но страницы нет', { files: { [`${SLUG}.html`]: null } }, /его страницы нет на диске/],
  ['deep: questions не массив, без формы', { files: { 'deep.json': JSON.stringify({ stage: 'ready', startedAt: '', questions: 'нет' }) }, formLayer: async () => undefined }, /ФТ-1/],
  ['deep: questions с пустыми записями, без формы', { files: { 'deep.json': JSON.stringify({ stage: 'ready', startedAt: '', questions: [null, {}] }) }, formLayer: async () => undefined }, /ФТ-1/],
  ['deep: html без заголовка', { files: { [`${SLUG}.html`]: '<p>ФТ-1 без разметки</p>' } }, /ФТ-1 без разметки/],
  // форма вопросов и входящие (слой формы: bft-forms/<id>.json, ответы, inbox)
  ['form: формы нет', { formLayer: async () => undefined }, /ФТ-1/],
  ['form: слой формы падает (форма или входящие не читаются)', { formLayer: async () => { throw new Error('form.json битый') } }, /Форма вопросов и входящие ответы: не удалось прочитать/],
  ['form: вопросы не заданы', { formLayer: async () => ({ ...FORM_LAYER, questions: undefined }) }, /ФТ-1/],
  ['form: ответы и убранные не заданы', { formLayer: async () => ({ ...FORM_LAYER, answers: undefined, removed: undefined }) }, /ФТ-1/],
  ['form: нет маршрутов api и входящих', { formLayer: async () => ({ ...FORM_LAYER, api: undefined }) }, /ФТ-1/],
  ['form: выдана ссылка, вопросы с пустыми полями', { formLayer: async () => ({ ...FORM_LAYER, link: './form?id=x', questions: [{ qid: 'q1' }, {}] }) }, /ФТ-1/],
  // «Планирование»: plan-*.json / .md / .excalidraw
  ['planning: заметка без метаданных', { plan: { note: '## Вопросы\n' } }, /ФТ-1/],
  ['planning: метаданные битые', { plan: { meta: '{"rev":' } }, /ФТ-1/],
  ['planning: метаданные — null', { plan: { meta: 'null' } }, /ФТ-1/],
  ['planning: метаданные пустые, доски нет', { plan: { meta: '{}', note: '' } }, /ФТ-1/],
  ['planning: доска битая', { plan: { meta: JSON.stringify({ savedAt: '2026-01-10T11:00:00Z', rev: 1, pdf: false, elements: 1 }), note: '## Вопросы\nчто-то', scene: '{"type":' } }, /ФТ-1/],
]

for (const [name, over, expect] of CASES) {
  test(`устойчивость: ${name} — 200`, async () => {
    const { status, html } = await open(over)
    assert.equal(status, 200, html.slice(0, 300))
    assert.match(html, expect)
  })
}

test('устойчивость: сломанный слой не роняет страницу — документ без него и пояснение', async () => {
  // Слой формы, который ломает сборку страницы (вопросы — не массив объектов).
  const { status, html, logged } = await open({ formLayer: async () => ({ ...FORM_LAYER, questions: 42 }) })
  assert.equal(status, 200)
  assert.match(html, /ФТ-1/)
  if (logged.length) assert.match(html, /Показано не всё из заявки/)
})

test('readDeepStateLenient: нет — undefined, битый — broken, верный — состояние', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deep-state-'))
  try {
    const p = join(dir, 'deep.json')
    assert.equal(await readDeepStateLenient(p), undefined)
    for (const bad of ['', '{', 'null', '[]', '"ready"', '{"stage":1}', '{"stage":"later"}']) {
      await writeFile(p, bad)
      assert.equal(await readDeepStateLenient(p), 'broken', bad)
    }
    await writeFile(p, JSON.stringify({ stage: 'ready', startedAt: 'x', questions: [QUESTION] }))
    assert.deepEqual((await readDeepStateLenient(p)).questions, [QUESTION])
    await writeFile(p, JSON.stringify({ stage: 'ready', questions: {} }))
    const s = await readDeepStateLenient(p)
    assert.equal(s.questions, undefined)
    assert.equal(s.startedAt, '')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('withNotes: пояснение сразу после <body>, экранировано; пусто — страница как есть', () => {
  assert.equal(withNotes('<body>x</body>', []), '<body>x</body>')
  const page = withNotes('<html><body class="a">x</body></html>', ['нет <deep>'])
  assert.match(page, /^<html><body class="a"><div class="bft-state-notes"/)
  assert.match(page, /нет &lt;deep&gt;/)
  assert.match(withNotes('x', ['y']), /^<div class="bft-state-notes"[\s\S]*x$/)
})
