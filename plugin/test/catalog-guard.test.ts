import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG_STALE_MS, catalogGuardText, catalogRows, isStale, remainingWork } from '../src/catalog-guard.js'
import type { BftArtifacts, BftStage, BftTask } from '../src/model.js'

const NONE: BftArtifacts = { fast: false, fastHtml: false, deep: false, deepHtml: false, custdev: false, custdevHtml: false }

function task(id: string, stage: BftStage, extra: Partial<BftTask> = {}): BftTask {
  return {
    id, title: `Тема ${id}`, stage, stageSource: 'backlog', description: '', howToDemo: [],
    links: { other: [] }, artifacts: NONE, missing: [], ...extra,
  }
}

test('осталось: терминальные стадии — словом, рабочие — нехватка и следующий навык', () => {
  assert.equal(remainingWork(task('PO-1', 'BFT-CANCELED')), 'отменено')
  assert.equal(remainingWork(task('PO-1', 'OKR-DONE')), 'реализовано в рамках OKR')
  assert.equal(remainingWork(task('PO-1', 'OKR-VLET')), 'в работе влётом')
  assert.equal(remainingWork(task('PO-1', 'OKR-ADDED')), 'реализация по плану OKR')
  assert.equal(remainingWork(task('PO-1', 'DEEP-DONE')), 'БФТ готов: передать в OKR или оформить влётом')
  // Задача доски без документа — создание документа под её идентификатором.
  assert.equal(remainingWork(task('PO-31', 'To Do', { missing: ['документ БФТ'] })), 'документ БФТ → /bft-fast PO-31')
  // Fast готов — следующий навык deep.
  assert.equal(
    remainingWork(task('PO-7', 'FAST-DONE', { slug: 'po-7', artifacts: { ...NONE, fast: true, fastHtml: true }, links: { other: [], html: 'bft/documentation/po-7/po-7-fast.html' } })),
    '/bft-deep po-7',
  )
})

test('текст секции: правило, снимок и по строке на инициативу — ближе к финалу выше', () => {
  const rows = catalogRows([
    task('PO-31', 'To Do', { missing: ['документ БФТ'] }),
    task('PO-22', 'DEEP-DONE', {
      slug: 'vibe-kino', title: 'Билеты в кино | Vibe',
      links: { other: [], epic: 'https://jira/browse/GDSLV-1', confluence: 'https://wiki/page?pageId=1', html: 'bft/documentation/vibe-kino/vibe-kino.html' },
    }),
  ])
  const text = catalogGuardText({ at: '2026-09-18T10:00:00.000Z', rows })
  assert.match(text, /^## Каталог БФТ — проверка на дубль/)
  assert.match(text, /только когда сообщение PO начинается с `\/bft-fast` или `\/bft-deep`/)
  assert.match(text, /снимок 2026-09-18T10:00:00.000Z/)
  const lines = text.split('\n')
  const deep = lines.findIndex(line => line.startsWith('PO-22 (vibe-kino) | DEEP-DONE'))
  const todo = lines.findIndex(line => line.startsWith('PO-31 | To Do'))
  assert.ok(deep > 0 && todo > deep, 'DEEP-DONE выше To Do')
  // Разделитель колонок внутри значения заменяется, чтобы строка не сломала таблицу.
  assert.equal(lines[deep], 'PO-22 (vibe-kino) | DEEP-DONE | Билеты в кино / Vibe | БФТ готов: передать в OKR или оформить влётом | https://jira/browse/GDSLV-1 | https://wiki/page?pageId=1 | bft/documentation/vibe-kino/vibe-kino.html')
  assert.equal(lines[todo], 'PO-31 | To Do | Тема PO-31 | документ БФТ → /bft-fast PO-31 | — | — | —')
})

test('без снимка модели говорят, чем его заменить; пустой каталог — так и пишется', () => {
  assert.match(catalogGuardText(null), /backlog task list --type bft --plain/)
  assert.match(catalogGuardText({ at: 'x', rows: [] }), /\(пусто — инициатив ещё нет\)/)
})

test('снимок стар после CATALOG_STALE_MS, битая дата — тоже стар', () => {
  const now = Date.parse('2026-09-18T10:00:00.000Z')
  assert.equal(isStale(undefined, now), true)
  assert.equal(isStale('битая', now), true)
  assert.equal(isStale('2026-09-18T09:59:00.000Z', now), false)
  assert.equal(isStale(new Date(now - CATALOG_STALE_MS - 1).toISOString(), now), true)
})
