// node --test: цепочка распознавания без сети — fetch подменён.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { recognize, resolveConfig } from '../lib/index.js'
import { level, SILENCE_PEAK } from '../lib/wave.js'

function wav(samples) {
  const data = new Int16Array(samples)
  const buf = new ArrayBuffer(44 + data.byteLength)
  const v = new DataView(buf)
  const put = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)))
  put(0, 'RIFF'); v.setUint32(4, 36 + data.byteLength, true); put(8, 'WAVE')
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  put(36, 'data'); v.setUint32(40, data.byteLength, true)
  new Int16Array(buf, 44).set(data)
  return new Uint8Array(buf)
}
const speech = wav(Array.from({ length: 16000 }, (_, i) => Math.round(8000 * Math.sin(i / 5))))
const silence = wav(new Array(16000).fill(0))
const signal = new AbortController().signal

function stubFetch(routes) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const route = Object.entries(routes).find(([k]) => String(url).includes(k))
    if (!route) throw new Error(`нет маршрута ${url}`)
    const [status, body] = await route[1](init)
    return new Response(JSON.stringify(body), { status })
  }
  return calls
}

test('уровень: 1 с синуса и цифровая тишина', () => {
  assert.equal(level(speech).seconds, 1)
  assert.ok(level(speech).peak > SILENCE_PEAK)
  assert.equal(level(silence).peak, 0)
})

test('тишина → ошибка про микрофон, в сеть не ходим', async () => {
  const calls = stubFetch({})
  await assert.rejects(recognize(resolveConfig(), silence, signal), /микрофон передал тишину/)
  assert.equal(calls.length, 0)
})

test('облако: model, language=ru и prompt уходят в Requesty', async () => {
  process.env.REQUESTY_API_KEY = 'test-key'
  const calls = stubFetch({ '/audio/transcriptions': async () => [200, { text: 'Привет, это Ирина.' }] })
  const out = await recognize(resolveConfig(), speech, signal)
  assert.equal(out.text, 'Привет, это Ирина.')
  const form = calls[0].init.body
  assert.equal(form.get('model'), 'openai/gpt-4o-mini-transcribe')
  assert.equal(form.get('language'), 'ru')
  assert.match(form.get('prompt'), /БФТ/)
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-key')
})

test('облако упало → резерв GigaAM', async () => {
  process.env.REQUESTY_API_KEY = 'test-key'
  const calls = stubFetch({
    '/audio/transcriptions': async () => [502, { error: { message: 'upstream' } }],
    '/transcribe': async () => [200, { text: 'Это Ирина из отдела кадров.' }],
  })
  const out = await recognize(resolveConfig({ localUrl: 'http://ingest' }), speech, signal)
  assert.equal(out.text, 'Это Ирина из отдела кадров.')
  assert.deepEqual(calls.map((c) => new URL(c.url).pathname), ['/v1/audio/transcriptions', '/transcribe'])
})

test('local-only: облако не трогаем', async () => {
  process.env.REQUESTY_API_KEY = 'test-key'
  const calls = stubFetch({ '/transcribe': async () => [200, { text: 'локально' }] })
  assert.equal((await recognize(resolveConfig({ mode: 'local-only', localUrl: 'http://ingest' }), speech, signal)).text, 'локально')
  assert.equal(calls.length, 1)
})
