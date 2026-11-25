// Список БФТ для Инбокса PO (ADR-0020): краткий статус и артефакты заявки.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bftCard, bftStage } from '../lib-test/bft-list.js'

const item = { sessionId: 'sess-1', taskId: 7, url: 'http://127.0.0.1:3456/tasks/7', title: 'Отчёт по возвратам', created: '2026-11-20T10:00:00Z', status: 'Проработка БФТ', demoApproved: true }
const urls = { portal: (p) => `https://portal.example/bft${p}`, form: (id) => `https://portal.example/bft/form?id=${id}` }

test('этап — по самому дальнему шагу заявки', () => {
  assert.equal(bftStage({}), 'dialog')
  assert.equal(bftStage({ demo: {} }), 'demo')
  assert.equal(bftStage({ demo: {}, fast: {} }), 'fast-review')
  assert.equal(bftStage({ fast: { approvedAt: 'x' } }), 'fast-approved')
  assert.equal(bftStage({ fast: { approvedAt: 'x' }, deep: { stage: 'failed' } }), 'deep-failed')
})

test('в диалоге: только чат, без артефактов', () => {
  const card = bftCard(item, {}, urls)
  assert.equal(card.stageLabel, 'В диалоге с заказчиком')
  assert.equal(card.chatUrl, 'https://portal.example/bft/?session=sess-1')
  assert.deepEqual(card.artifacts, [])
  assert.equal(card.status, 'Проработка БФТ')
})

test('полный БФТ готов: документ с выгрузкой, первичные — отдельной ссылкой, форма с ответами', () => {
  const card = bftCard(item, {
    demo: { approvedAt: '2026-11-20T11:00:00Z' },
    fast: { approvedAt: '2026-11-20T12:00:00Z' },
    deep: { stage: 'ready', startedAt: '2026-11-20T12:01:00Z', finishedAt: '2026-11-20T12:20:00Z' },
    form: { id: 'f-1', publishedAt: '2026-11-21T09:00:00Z', total: 12, answered: 3 },
  }, { ...urls, ticket: 'https://tracker.example/tasks/7' })
  assert.equal(card.stage, 'deep-ready')
  assert.deepEqual(card.artifacts.map((a) => a.kind), ['deep', 'fast', 'demo', 'form', 'ticket'])
  const [deep, fast, , form] = card.artifacts
  assert.equal(deep.url, 'https://portal.example/bft/api/customer-form.bftFast?session=sess-1')
  assert.deepEqual(deep.downloads.map((d) => d.format), ['docx', 'pdf', 'md'])
  assert.match(deep.downloads[0].url, /doc=deep&format=docx$/)
  assert.match(fast.url, /&view=fast$/)
  assert.equal(form.note, 'ответов 3 из 12')
  assert.deepEqual(card.questions, { total: 12, answered: 3 })
  assert.equal(card.updatedAt, '2026-11-20T12:20:00Z')
})

test('сборка идёт — без выгрузки; отозванная форма не показывается', () => {
  const card = bftCard(item, { fast: { approvedAt: 'x' }, deep: { stage: 'building', startedAt: '2026-11-22T08:00:00Z' }, form: { id: 'f', publishedAt: 'p', revokedAt: 'r', total: 1, answered: 0 } }, urls)
  assert.equal(card.stageLabel, 'Полный БФТ собирается')
  assert.equal(card.artifacts[0].downloads, undefined)
  assert.equal(card.artifacts[0].note, 'собирается')
  assert.ok(!card.artifacts.some((a) => a.kind === 'form'))
  assert.equal(card.questions, undefined)
})

test('стадия — из цикла заявки, если он есть (ADR-0022, шаг 3)', () => {
  const item = { sessionId: 's1', taskId: 3, title: 'Склад', created: '2026-11-19T09:00:00Z' }
  const urls = { portal: (p) => `https://portal${p}`, form: (id) => `https://portal/form?id=${id}` }
  const files = { fast: { approvedAt: '2026-11-19T10:00:00Z' }, deep: { stage: 'ready', startedAt: '2026-11-19T10:01:00Z' } }
  // Файлы говорят «готов», цикл — «пересборка по ответам»: верим циклу.
  const rebuilding = bftCard(item, { ...files, lifecycle: { stage: 'rebuilding', waitingFor: ['model'], round: 2 } }, urls)
  assert.equal(rebuilding.stage, 'deep-building')
  assert.equal(rebuilding.stageLabel, 'Пересборка по ответам')
  assert.deepEqual(rebuilding.lifecycle, { stage: 'rebuilding', waitingFor: ['model'], round: 2 })
  const agreement = bftCard(item, { ...files, lifecycle: { stage: 'agreement', waitingFor: ['customer', 'team:Платёжки'], round: 1 } }, urls)
  assert.equal(agreement.stage, 'deep-ready')
  assert.equal(agreement.stageLabel, 'Согласование — ждём заказчика, Платёжки')
  // Цикла нет — как раньше, из файлов.
  assert.equal(bftCard(item, files, urls).stageLabel, 'Полный БФТ готов')
})
