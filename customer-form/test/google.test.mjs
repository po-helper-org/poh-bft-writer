// Коннектор ссылок Google (ADR-0017): экспорт без ключей, OCR картинок, папки,
// закрытые файлы, хосты только Google. Сеть не нужна: fetch и context-ingest — двойники.
// Данные вымышленные: нейтральный домен «заявки на ремонт оборудования».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GoogleConnector, allowedHost, fileName, googleTarget, parseFolderView, splitDocImages } from '../lib-test/google.js'
import { Materials, materialsPack } from '../lib-test/materials.js'

const DOC = 'docAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const DECK = 'deckBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
const FOLDER = 'folderCCCCCCCCCCCCCCCCCCCCC'
const SUB = 'subfolderDDDDDDDDDDDDDDDDDD'
const IMG = 'imageEEEEEEEEEEEEEEEEEEEEEE'
const PDF = 'pdfFFFFFFFFFFFFFFFFFFFFFFFF'
const ZIP = 'zipGGGGGGGGGGGGGGGGGGGGGGGG'
const PNG_B64 = Buffer.from('fake-png').toString('base64')

/** fetch-двойник: адрес → ответ (или функция). Пишет, куда ходили. */
function fakeFetch(routes) {
  const calls = []
  const fn = async (url, init) => {
    calls.push(url)
    assert.equal(init.redirect, 'manual', 'редиректы — вручную, по списку хостов')
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))
    if (!route) return new Response('not found', { status: 404 })
    const r = typeof route[1] === 'function' ? route[1](url) : route[1]
    return new Response(r.body ?? '', { status: r.status ?? 200, headers: r.headers ?? {} })
  }
  return { fn, calls }
}

function fakeIngest() {
  const seen = []
  const fn = async (name, bytes) => {
    seen.push(name)
    if (/\.(png|jpe?g)$/.test(name)) return { kind: 'document', ocr: true, markdown: `OCR ${name}: кнопка «Создать заявку»` }
    if (name === 'slides.pptx') return { kind: 'document', markdown: '<!-- Slide number: 1 -->\nЗаявка с планшета\n\n<!-- Slide number: 2 -->\nДиспетчер видит сразу' }
    return { kind: 'document', markdown: `текст ${name} (${bytes.length} байт)` }
  }
  return { fn, seen }
}

test('googleTarget: Docs, Slides, Sheets, файл и папка Drive; прочее — не Google', () => {
  assert.deepEqual(googleTarget(`https://docs.google.com/document/d/${DOC}/edit?usp=sharing`), { kind: 'doc', id: DOC })
  assert.deepEqual(googleTarget(`https://docs.google.com/presentation/d/${DECK}/edit#slide=id.p`), { kind: 'slides', id: DECK })
  assert.deepEqual(googleTarget(`https://docs.google.com/spreadsheets/u/1/d/${DOC}/edit`), { kind: 'sheet', id: DOC })
  assert.deepEqual(googleTarget(`https://drive.google.com/drive/folders/${FOLDER}?usp=drive_link`), { kind: 'folder', id: FOLDER })
  assert.deepEqual(googleTarget(`https://drive.google.com/drive/u/0/folders/${FOLDER}`), { kind: 'folder', id: FOLDER })
  assert.deepEqual(googleTarget(`https://drive.google.com/file/d/${IMG}/view?usp=drive_web`), { kind: 'file', id: IMG })
  assert.deepEqual(googleTarget(`https://drive.google.com/open?id=${IMG}`), { kind: 'file', id: IMG })
  assert.equal(googleTarget('https://example.com/document/d/x'), undefined)
  assert.equal(googleTarget(`http://docs.google.com.evil.example/document/d/${DOC}`), undefined)
})

test('allowedHost: только Google-хосты экспорта; вход и чужие — нет', () => {
  assert.ok(allowedHost('docs.google.com'))
  assert.ok(allowedHost('doc-0s-1a-docstext.googleusercontent.com'))
  assert.ok(allowedHost('drive.usercontent.google.com'))
  assert.ok(!allowedHost('accounts.google.com'))
  assert.ok(!allowedHost('googleusercontent.com.evil.example'))
  assert.ok(!allowedHost('r.jina.ai'))
})

test('splitDocImages: data URI вырезаны из текста, байты картинок — для OCR', () => {
  const md = `# Заявки\n\n![][image1]\n\nТекст\n\n[image1]: <data:image/png;base64,${PNG_B64}>\n[image2]: <data:image/jpeg;base64,${PNG_B64}>\n`
  const { text, images } = splitDocImages(md)
  assert.ok(!text.includes('base64'))
  assert.match(text, /Текст/)
  assert.deepEqual(images.map((i) => `${i.ref}.${i.ext}`), ['image1.png', 'image2.jpg'])
  assert.equal(Buffer.from(images[0].bytes).toString(), 'fake-png')
})

test('fileName: filename* в UTF-8 и простое имя', () => {
  assert.equal(fileName(`attachment; filename="a.png"; filename*=UTF-8''%D0%BC%D0%B0%D0%BA%D0%B5%D1%82.png`), 'макет.png')
  assert.equal(fileName('attachment; filename="plan.pdf"'), 'plan.pdf')
  assert.equal(fileName(''), '')
})

const folderHtml = (title, entries) => `<html><head><title>${title}</title></head><body>${entries.map(([href, name]) =>
  `<div class="flip-entry"><a href="${href}" target="_blank"><div class="flip-entry-info"><div class="flip-entry-title">${name}</div></div></a></div>`).join('')}</body></html>`

test('parseFolderView: файлы, вложенные папки и документы из HTML-списка', () => {
  const { title, entries } = parseFolderView(folderHtml('Макеты &amp; схемы', [
    [`https://drive.google.com/file/d/${IMG}/view?usp=drive_web`, 'form-tablet.png'],
    [`https://drive.google.com/drive/folders/${SUB}`, 'Старое'],
    [`https://docs.google.com/document/d/${DOC}/edit?usp=drive_web`, 'Описание'],
  ]))
  assert.equal(title, 'Макеты & схемы')
  assert.deepEqual(entries.map((e) => `${e.kind}:${e.name}`), ['file:form-tablet.png', 'folder:Старое', 'doc:Описание'])
})

test('Docs: экспорт md за редиректом на googleusercontent, картинки — OCR через context-ingest', async () => {
  const { fn, calls } = fakeFetch({
    [`https://docs.google.com/document/d/${DOC}/export?format=md`]: { status: 307, headers: { location: 'https://doc-0a-docstext.googleusercontent.com/export/x' } },
    'https://doc-0a-docstext.googleusercontent.com/export/x': { body: `# Ремонт с планшета\n\nМастер оформляет заявку.\n\n![][image1]\n\n[image1]: <data:image/png;base64,${PNG_B64}>\n` },
  })
  const ingest = fakeIngest()
  const read = await new GoogleConnector(ingest.fn, fn, undefined).read(`https://docs.google.com/document/d/${DOC}/edit?usp=sharing`)
  assert.equal(calls.length, 2)
  assert.deepEqual(ingest.seen, ['image1.png'])
  assert.match(read.label, /Google Docs.*1 картинок \(OCR\)/)
  assert.match(read.markdown, /Мастер оформляет заявку/)
  assert.match(read.markdown, /## Картинки документа[\s\S]*OCR image1\.png: кнопка «Создать заявку»/)
  assert.ok(!read.markdown.includes('base64'))
})

test('Slides: pptx → MarkItDown (context-ingest), число слайдов в метке', async () => {
  const { fn } = fakeFetch({ [`https://docs.google.com/presentation/d/${DECK}/export/pptx`]: { body: 'PK-fake', headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' } } })
  const ingest = fakeIngest()
  const read = await new GoogleConnector(ingest.fn, fn, undefined).read(`https://docs.google.com/presentation/d/${DECK}/edit`)
  assert.deepEqual(ingest.seen, ['slides.pptx'])
  assert.match(read.label, /Google Slides — презентация, 2 слайдов/)
  assert.match(read.markdown, /Диспетчер видит сразу/)
})

test('закрытый файл: редирект на вход Google → понятная ошибка «откройте доступ по ссылке»', async () => {
  const { fn } = fakeFetch({ [`https://docs.google.com/document/d/${DOC}/export`]: { status: 302, headers: { location: 'https://accounts.google.com/ServiceLogin?continue=x' } } })
  await assert.rejects(new GoogleConnector(fakeIngest().fn, fn, undefined).read(`https://docs.google.com/document/d/${DOC}/edit`),
    /файл закрыт.*Все, у кого есть ссылка/)
})

test('редирект на чужой хост не выполняется', async () => {
  const { fn, calls } = fakeFetch({ [`https://docs.google.com/document/d/${DOC}/export`]: { status: 302, headers: { location: 'https://attacker.example/steal' } } })
  await assert.rejects(new GoogleConnector(fakeIngest().fn, fn, undefined).read(`https://docs.google.com/document/d/${DOC}/edit`), /чужой хост attacker\.example/)
  assert.equal(calls.length, 1)
})

function folderRoutes() {
  return {
    [`https://drive.google.com/embeddedfolderview?id=${FOLDER}`]: { body: folderHtml('Макеты', [
      [`https://drive.google.com/file/d/${IMG}/view?usp=drive_web`, 'form-tablet.png'],
      [`https://drive.google.com/drive/folders/${SUB}`, 'Схемы'],
      [`https://drive.google.com/file/d/${ZIP}/view?usp=drive_web`, 'archive.zip'],
    ]), headers: { 'content-type': 'text/html; charset=utf-8' } },
    [`https://drive.google.com/embeddedfolderview?id=${SUB}`]: { body: folderHtml('Схемы', [[`https://drive.google.com/file/d/${PDF}/view`, 'flow.pdf']]), headers: { 'content-type': 'text/html' } },
    [`https://drive.usercontent.google.com/download?id=${IMG}`]: { body: 'png', headers: { 'content-type': 'image/png', 'content-disposition': 'attachment; filename="form-tablet.png"' } },
    [`https://drive.usercontent.google.com/download?id=${PDF}`]: { body: '%PDF', headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="flow.pdf"' } },
    [`https://drive.usercontent.google.com/download?id=${ZIP}`]: { body: 'zip', headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="archive.zip"' } },
  }
}

test('папка Drive без ключа: список из embeddedfolderview, подпапка, картинки — OCR, неподдерживаемое — пометкой', async () => {
  const { fn } = fakeFetch(folderRoutes())
  const ingest = fakeIngest()
  const read = await new GoogleConnector(ingest.fn, fn, undefined).read(`https://drive.google.com/drive/folders/${FOLDER}?usp=drive_link`)
  assert.deepEqual(ingest.seen.sort(), ['flow.pdf', 'form-tablet.png'])
  assert.match(read.label, /папка Google Drive — 3 файлов, картинки \(1\) — текст распознан OCR/)
  assert.match(read.markdown, /^Папка Google Drive «Макеты»: 3 файлов\./)
  assert.match(read.markdown, /## form-tablet\.png — файл Drive «form-tablet\.png» — картинка — текст распознан OCR\nСсылка: https:\/\/drive\.google\.com\/file\/d\/imageE+\/view/)
  assert.match(read.markdown, /## Схемы\/flow\.pdf — файл Drive «flow\.pdf» — документ/)
  assert.match(read.markdown, /archive\.zip.*формат не разбирается/)
})

test('папка Drive с ключом владельца: Drive API v3 вместо HTML-списка', async () => {
  const routes = folderRoutes()
  routes['https://www.googleapis.com/drive/v3/files?'] = (url) => {
    assert.match(decodeURIComponent(url), new RegExp(`'${FOLDER}' in parents`))
    assert.match(url, /key=test-key/)
    return { body: JSON.stringify({ files: [{ id: IMG, name: 'form-tablet.png', mimeType: 'image/png' }, { id: DECK, name: 'Презентация', mimeType: 'application/vnd.google-apps.presentation' }] }), headers: { 'content-type': 'application/json' } }
  }
  routes[`https://docs.google.com/presentation/d/${DECK}/export/pptx`] = { body: 'PK' }
  const { fn, calls } = fakeFetch(routes)
  const read = await new GoogleConnector(fakeIngest().fn, fn, 'test-key').read(`https://drive.google.com/drive/folders/${FOLDER}`)
  assert.ok(!calls.some((u) => u.includes('embeddedfolderview')))
  assert.match(read.markdown, /## Презентация — Google Slides/)
  assert.match(read.label, /2 файлов/)
})

test('Materials: ссылка Google → материал с источником; полный текст дочитывается частями', async () => {
  const long = `${'а'.repeat(31_000)}КОНЕЦ`
  const connector = { read: async (url) => ({ label: 'Google Docs — документ', markdown: `${url.includes(DOC) ? long : ''}` }) }
  const materials = new Materials('http://ingest.invalid', connector)
  const url = `https://docs.google.com/document/d/${DOC}/edit?usp=sharing`
  const m = materials.addLink('s1', url)
  const result = await m.result
  assert.ok(result.ok)
  assert.equal(result.label, 'Google Docs — документ')
  assert.ok(result.markdown.startsWith(`Источник: ${url}`))
  const { ready } = await materials.take('s1')
  const pack = materialsPack(ready)
  assert.match(pack, /<source id="S1" name="https:\/\/docs\.google\.com[^"]*" type="Google Docs — документ">/)
  assert.match(pack, /read_customer_materials с id этого источника и part/)
  const p1 = materials.part('s1', 's1', 1)
  assert.match(p1, /part="1 из 2"/)
  assert.match(p1, /part 2/)
  const p2 = materials.part('s1', 'S1', 2)
  assert.match(p2, /КОНЕЦ/)
  assert.match(p2, /Это конец материала/)
  assert.match(materials.part('s1', 'S9'), /Материала S9 нет. Есть: S1/)
})

test('Materials: закрытая ссылка Google — ошибка в материале, разбор других не ломается', async () => {
  const connector = { read: async () => { throw new Error('нужен вход в Google: файл закрыт — попросите заказчика открыть доступ') } }
  const materials = new Materials('http://ingest.invalid', connector)
  const m = materials.addLink('s2', `https://drive.google.com/file/d/${IMG}/view`)
  const result = await m.result
  assert.equal(result.ok, false)
  assert.match(result.error, /файл закрыт/)
  assert.equal(materials.list('s2')[0].status, 'error')
})
