// node --test: словарь терминов диалога и его путь в prompt Requesty.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { audioKey, composePrompt, dialogTerms, glossary, recognize, resolveConfig } from '../lib/index.js'

const DIALOG = [
  'Ирина Петрова, i.petrova@example.com. Инициатива по отпускам: заявки приходят письмами в Outlook, теряются.',
  'Нужно перенести согласование в 1С:ЗУП, срок — к 1 марта. Сейчас кадровики сверяют вручную. Поручение от Сидорова.',
  '📌 Заявка #64 зарегистрирована в беклоге: http://127.0.0.1:3456/tasks/64. [S1 00:20] отдел кадров, ЗУП, Outlook.',
]

test('словарь: имена, системы, аббревиатуры — без почты, ссылок и меток', () => {
  const terms = glossary(DIALOG)
  for (const t of ['Ирина Петрова', 'Outlook', '1С:ЗУП', 'ЗУП', 'Сидорова']) assert.ok(terms.includes(t), `${t} ∉ ${terms}`)
  assert.equal(terms[0], 'Outlook', 'частое — первым')
  for (const t of terms) assert.doesNotMatch(t, /@|http|^S1$|^Сейчас$|^Нужно$|^Инициатива$/, t)
})

test('словарь: прилагательное в начале фразы не приклеивается к имени', () => {
  const terms = glossary(['Ответственный Олег Сидоров. Дмитрий Козлов согласует.'])
  assert.ok(terms.includes('Олег Сидоров'), String(terms))
  assert.ok(terms.includes('Дмитрий Козлов'), String(terms))
  assert.ok(!terms.some((t) => t.startsWith('Ответственный')), String(terms))
})

test('prompt: база + термины в пределах бюджета', () => {
  assert.equal(composePrompt('База.', []), 'База.')
  const p = composePrompt('База.', ['Outlook', '1С:ЗУП'])
  assert.equal(p, 'База. Термины этого обращения: Outlook, 1С:ЗУП.')
  assert.ok(composePrompt('База.', Array.from({ length: 500 }, (_, i) => `Термин${i}`), 200).length <= 200)
})

test('ключ записи стабилен и различает записи', () => {
  assert.equal(audioKey(new Uint8Array([1, 2, 3])), audioKey(new Uint8Array([1, 2, 3])))
  assert.notEqual(audioKey(new Uint8Array([1, 2, 3])), audioKey(new Uint8Array([1, 2, 4])))
})

test('источник получает ключ записи; медленный не задерживает больше 0,5 с', async () => {
  const audio = new Uint8Array([9, 9, 9])
  let asked
  const fast = ({ audioKey: key }) => { asked = key; return DIALOG }
  const slow = () => new Promise((resolve) => setTimeout(() => resolve(['Медленный Термин']), 3000).unref())
  const started = Date.now()
  const terms = await dialogTerms([fast, slow], audio)
  assert.ok(Date.now() - started < 1500)
  assert.equal(asked, audioKey(audio))
  assert.ok(terms.includes('1С:ЗУП'))
})

test('термины диалога уходят в prompt Requesty', async () => {
  process.env.REQUESTY_API_KEY = 'test-key'
  const samples = new Int16Array(16000).map((_, i) => Math.round(8000 * Math.sin(i / 5)))
  const wav = new Uint8Array(44 + samples.byteLength)
  const v = new DataView(wav.buffer)
  const put = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  put(0, 'RIFF'); v.setUint32(4, 36 + samples.byteLength, true); put(8, 'WAVE'); put(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true)
  v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, samples.byteLength, true)
  new Int16Array(wav.buffer, 44).set(samples)
  let form
  globalThis.fetch = async (_url, init) => { form = init.body; return new Response(JSON.stringify({ text: 'ок' }), { status: 200 }) }
  await recognize(resolveConfig(), wav, new AbortController().signal, () => {}, [() => DIALOG])
  assert.match(form.get('prompt'), /Термины этого обращения: .*1С:ЗУП/)
  assert.match(form.get('prompt'), /Ирина Петрова/)
})
