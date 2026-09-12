import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  epicSlugFromRefs, linkTaskToEpic, normalizeDocsRef, normalizeTitle, parseH1, type EpicCandidate,
} from '../src/epic-link.js'

const DOCS = '.bft/documentation'

test('ссылка внутрь каталога документов нормализуется к пути от корня воркспейса', () => {
  assert.equal(normalizeDocsRef('.bft/documentation/alpha/alpha-fast.html', DOCS), '.bft/documentation/alpha/alpha-fast.html')
  assert.equal(normalizeDocsRef('./.bft/documentation/alpha/alpha.md', DOCS), '.bft/documentation/alpha/alpha.md')
  // Прежнее имя каталога и префикс репозитория — то, что реально встречается в задачах.
  assert.equal(normalizeDocsRef('bft/documentation/alpha/letter.md', DOCS), '.bft/documentation/alpha/letter.md')
  assert.equal(normalizeDocsRef('ishmanov-cortex/bft/documentation/alpha/alpha.html', 'bft/documentation'), 'bft/documentation/alpha/alpha.html')
  assert.equal(normalizeDocsRef('bft\\documentation\\alpha\\alpha.html', 'bft/documentation'), 'bft/documentation/alpha/alpha.html')
})

test('ссылка наружу — не связь', () => {
  assert.equal(normalizeDocsRef('https://confluence.mts.ru/pages/viewpage.action?pageId=1', DOCS), null)
  assert.equal(normalizeDocsRef('https://host/bft/documentation/alpha/alpha.html', 'bft/documentation'), null)
  assert.equal(normalizeDocsRef('okr:PO-78', DOCS), null)
  assert.equal(normalizeDocsRef('GROUND/NEXUS/pulse.md', DOCS), null)
  assert.equal(normalizeDocsRef('.bft/documentation', DOCS), null)
  assert.equal(normalizeDocsRef('   ', DOCS), null)
  // Подстрока, а не сегмент: `xbft/documentation` — чужой каталог.
  assert.equal(normalizeDocsRef('xbft/documentation/alpha/a.md', 'bft/documentation'), null)
})

test('слаг из ссылок — первый сегмент после каталога, от любой ссылки внутрь папки эпика', () => {
  assert.equal(epicSlugFromRefs(['https://jira/x', 'bft/documentation/alpha/personas.csv'], DOCS), 'alpha')
  assert.equal(epicSlugFromRefs(['GROUND/x.md'], DOCS), null)
  assert.equal(epicSlugFromRefs([], DOCS), null)
})

test('H1 даёт ключ и название', () => {
  assert.deepEqual(parseH1('---\nx: y\n---\n\n# [БФТ] PO-11: AI Harness агент\n'), { key: 'PO-11', title: 'AI Harness агент' })
  assert.deepEqual(parseH1('#  [БФТ]  direct-faq : Блок «Вопрос-ответ»'), { key: 'direct-faq', title: 'Блок «Вопрос-ответ»' })
  assert.equal(parseH1('# Просто заголовок'), null)
})

test('название сравнивается без регистра, кавычек, пробелов и префикса «БФТ:»', () => {
  assert.equal(normalizeTitle('БФТ:  AI Harness  агент для «Ticketland» PHP'), 'ai harness агент для ticketland php')
  assert.equal(normalizeTitle('БФТ (упрощенно): Взаиморасчёты'), 'взаиморасчёты')
})

const EPICS: EpicCandidate[] = [
  { slug: 'alpha', h1Key: 'alpha', h1Title: 'Альфа' },
  { slug: 'po-11', h1Key: 'po-11', h1Title: 'Документ из раздела' },
  { slug: 'ai-harness', h1Key: 'PO-12', h1Title: 'AI Harness агент' },
  { slug: 'legacy', h1Key: 'legacy', h1Title: 'Блокировка мест на схеме зала' },
]

test('признак 1: ссылка задачи сильнее всего остального', () => {
  const link = linkTaskToEpic({ id: 'PO-11', title: 'Другое', refs: ['.bft/documentation/alpha/alpha.md'] }, EPICS, DOCS)
  assert.deepEqual(link, { slug: 'alpha', via: 'ref' })
})

test('признак 2: слаг равен идентификатору без учёта регистра', () => {
  assert.deepEqual(linkTaskToEpic({ id: 'PO-11', title: 'Что угодно', refs: [] }, EPICS, DOCS), { slug: 'po-11', via: 'slug' })
})

test('признак 3: ключ или название в H1', () => {
  assert.deepEqual(linkTaskToEpic({ id: 'PO-12', title: 'Не совпадает', refs: [] }, EPICS, DOCS), { slug: 'ai-harness', via: 'h1' })
  assert.deepEqual(
    linkTaskToEpic({ id: 'PO-20', title: 'БФТ: Блокировка мест на схеме зала', refs: [] }, EPICS, DOCS),
    { slug: 'legacy', via: 'h1' },
  )
})

test('ссылка в неизвестный каталог не даёт связи по ссылке, но не мешает остальным признакам', () => {
  assert.deepEqual(linkTaskToEpic({ id: 'PO-11', title: 'x', refs: ['.bft/documentation/nope/nope.md'] }, EPICS, DOCS), { slug: 'po-11', via: 'slug' })
})

test('ничего не совпало — связи нет', () => {
  assert.equal(linkTaskToEpic({ id: 'PO-99', title: 'Новая инициатива', refs: [] }, EPICS, DOCS), null)
  assert.equal(linkTaskToEpic({ id: 'PO-99', title: '', refs: [] }, [{ slug: 'x', h1Title: '' }], DOCS), null)
})
