// «Планирование» (ADR-0025): заметка + доска, сохранение, архив, комментарий Confluence, блок на странице БФТ.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { confluenceComment, crc32, PLAN_TEMPLATE, planArtifact, planFiles, planPage, readPlan, safeSvg, savePlan, validatePlan, zip } from '../lib-test/plan.js'
import { planLinks, withPlan } from '../lib-test/plan-routes.js'

const scene = (n = 1) => JSON.stringify({ type: 'excalidraw', version: 2, elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, type: 'rectangle' })), appState: {}, files: {} })

/** Записи zip: имя и распакованные данные (по локальным заголовкам). */
function unzip(buf) {
  const out = []
  let at = 0
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const crc = buf.readUInt32LE(at + 14), size = buf.readUInt32LE(at + 18), nameLen = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28)
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8')
    const data = inflateRawSync(buf.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size))
    assert.equal(crc32(data), crc, `crc ${name}`)
    out.push({ name, data })
    at += 30 + nameLen + extra + size
  }
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50, 'конец центрального каталога')
  return out
}

test('шаблон заметки — четыре заголовка с доски PO', () => {
  assert.deepEqual(PLAN_TEMPLATE.split('\n').filter((l) => l.startsWith('## ')), ['## Вопросы', '## Декомпозиция', '## Риски', '## Сроки'])
})

test('вход «Сохранить»: пусто, не сцена, не SVG, лимиты', () => {
  assert.match(validatePlan({ note: '  ', scene: scene(0) }).error, /пусто/)
  assert.match(validatePlan({ note: 'x', scene: '{"type":"other","elements":[]}' }).error, /не сцена/)
  assert.match(validatePlan({ note: 'x', scene: 'нет' }).error, /не JSON/)
  assert.match(validatePlan({ note: 'x', svg: '<html>' }).error, /не SVG/)
  assert.match(validatePlan({ note: 'x'.repeat(200_001) }).error, /200 000/)
  assert.deepEqual(validatePlan({ note: '', scene: scene(2), svg: '<svg></svg>', by: '  Аня  ' }), { note: '', scene: scene(2), svg: '<svg></svg>', by: 'Аня' })
})

test('SVG доски — без скриптов и обработчиков', () => {
  const clean = safeSvg('<svg onload="x()"><script>alert(1)</script><a href="javascript:x">t</a><rect onclick=\'y\'/></svg>')
  assert.ok(!/script|onload|onclick|javascript:/i.test(clean), clean)
})

test('zip: deflate, CRC, имена UTF-8 — распаковывается обратно', () => {
  const buf = zip([{ name: 'zametka.md', data: Buffer.from('## Вопросы\n- лимит промокодов') }, { name: 'doska.excalidraw', data: Buffer.from(scene(3)) }])
  const files = unzip(buf)
  assert.deepEqual(files.map((f) => f.name), ['zametka.md', 'doska.excalidraw'])
  assert.equal(files[0].data.toString(), '## Вопросы\n- лимит промокодов')
})

test('сохранить: файлы, версия растёт, архив с заметкой и доской', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'))
  const note = '## Вопросы\n- Как работают промокоды?\n\n## Риски\n- Нет требований бухгалтерии'
  const m1 = await savePlan(dir, { note, scene: scene(2), svg: '', by: 'PO' }, 'Промокоды за покупку', new Date('2026-11-24T10:00:00Z'))
  assert.equal(m1.rev, 1)
  assert.equal(m1.elements, 2)
  assert.equal(m1.pdf, false) // без SVG PDF не собирается
  const m2 = await savePlan(dir, { note: note + '\n- ещё', scene: scene(3), svg: '' }, 'Промокоды за покупку')
  assert.equal(m2.rev, 2)
  const plan = await readPlan(dir)
  assert.match(plan.note, /ещё$/)
  const files = unzip(await readFile(planFiles(dir).zip))
  assert.deepEqual(files.map((f) => f.name), ['zametka.md', 'doska.excalidraw'])
  assert.match(files[0].data.toString(), /^# Планирование: Промокоды за покупку/)
  assert.equal(JSON.parse(files[1].data.toString()).elements.length, 3)
})

test('комментарий Confluence: заметка целиком и список вложений', () => {
  const plan = { note: '## Сроки\n- 3–5 недель', scene: '', meta: { savedAt: '2026-11-24T10:00:00Z', by: 'Аня', rev: 1, pdf: true, elements: 4 } }
  const text = confluenceComment(plan, 'Промокоды', { zip: 'zayavka-1-planirovanie.zip', pdf: 'zayavka-1-doska.pdf' })
  assert.match(text, /\*\*Планирование\*\* по «Промокоды»/)
  assert.match(text, /## Сроки\n- 3–5 недель/)
  assert.match(text, /Вложения: zayavka-1-planirovanie\.zip \(заметка и доска\), zayavka-1-doska\.pdf \(доска\)\./)
})

test('страница БФТ: кнопка всегда, артефакт — когда сохранено', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plan-'))
  const page = '<html><body><main><h1>БФТ</h1></main></body></html>'
  const empty = await withPlan(page, 'session-1', dir)
  assert.match(empty, /class="plan-btn" href="customer-form\.plan\?session=session-1"/)
  assert.ok(empty.indexOf('plan-btn') > empty.indexOf('</h1>') && empty.indexOf('plan-btn') < empty.indexOf('</main>'), 'кнопка — под заголовком')
  assert.ok(!empty.includes('data-plan'))
  await savePlan(dir, { note: '## Декомпозиция\n- BE: событие из Kafka', scene: scene(1), svg: '' }, 'Т')
  const saved = await withPlan(page, 'session-1', dir)
  assert.ok(saved.indexOf('data-plan') < saved.indexOf('</main>'), 'артефакт — внизу документа')
  assert.match(saved, /href="customer-form\.planFile\?session=session-1&amp;f=zip" download>Скачать \.zip/)
  assert.ok(!saved.includes('Доска .pdf'), 'PDF не собран — ссылки нет')
  assert.equal(planArtifact(undefined, planLinks('s')), '')
})

test('экран: заметка слева, доска справа, сохранённая сцена и черновик', () => {
  const html = planPage({ title: 'Промокоды', slug: 'zayavka-1', saveUrl: 'save', bftUrl: 'bft', assetUrl: (f) => `asset?f=${f}`, links: planLinks('s'),
    saved: { note: '## Вопросы\n- </script><b>', scene: scene(2), meta: { savedAt: '2026-11-24T10:00:00Z', rev: 3, pdf: false, elements: 2 } } })
  assert.match(html, /<textarea id="note"/)
  assert.match(html, /<section id="board"/)
  assert.match(html, /src="asset\?f=board\.js"/)
  assert.ok(!html.includes('</script><b>'), 'текст заметки не ломает скрипт страницы')
  assert.match(html, /"rev":3/)
  assert.match(html, /bft-plan:zayavka-1/)
})

test('заметка из боковой панели: без доски — без архива; доска сохранена — архив с новой заметкой', async () => {
  const { saveNote, boardSavedAt, planSidebar } = await import('../lib-test/plan.js')
  const dir = await mkdtemp(join(tmpdir(), 'plan-'))
  const m1 = await saveNote(dir, '## Риски\n- сроки', 'Т', 'po', new Date('2026-11-24T10:00:00Z'))
  assert.equal(m1.rev, 0)
  assert.equal(boardSavedAt(m1), undefined)
  await assert.rejects(readFile(planFiles(dir).zip), 'архива ещё нет')
  const side1 = planSidebar(await readPlan(dir), planLinks('s'))
  assert.match(side1, /Перейти на доску/)
  assert.ok(!side1.includes('Скачать архив планирования'), 'доска не сохранялась — кнопки архива нет')
  assert.match(side1, /## Риски\n- сроки<\/textarea>/)
  assert.equal((await withPlan('<main><h1>Б</h1></main>', 's', dir)).includes('data-plan'), false, 'артефакт внизу — только с доской')

  const m2 = await savePlan(dir, { note: '## Риски\n- сроки', scene: scene(2), svg: '' }, 'Т', new Date('2026-11-24T11:00:00Z'))
  assert.equal(m2.rev, 1)
  assert.equal(boardSavedAt(m2), '2026-11-24T11:00:00.000Z')
  const m3 = await saveNote(dir, '## Риски\n- сроки\n- люди', 'Т', undefined, new Date('2026-11-24T12:00:00Z'))
  assert.equal(m3.rev, 1, 'заметка номер версии доски не меняет')
  assert.equal(boardSavedAt(m3), '2026-11-24T11:00:00.000Z')
  const files = unzip(await readFile(planFiles(dir).zip))
  assert.deepEqual(files.map((f) => f.name), ['zametka.md', 'doska.excalidraw'], 'архив: заметка и доска .excalidraw')
  assert.match(files[0].data.toString(), /- люди\n$/)
  const side2 = planSidebar(await readPlan(dir), planLinks('s'))
  assert.match(side2, /href="customer-form\.planFile\?session=s&amp;f=zip" download>Скачать архив планирования/)
  assert.match(side2, /"saveUrl":"customer-form\.planNote\?session=s"/)
})

test('прежняя запись (только экран доски) — доска считается сохранённой', async () => {
  const { boardSavedAt } = await import('../lib-test/plan.js')
  assert.equal(boardSavedAt({ savedAt: 'x', rev: 2, pdf: false, elements: 1 }), 'x')
  assert.equal(boardSavedAt({ savedAt: 'x', rev: 0, pdf: false, elements: 0, noteAt: 'x' }), undefined)
})
