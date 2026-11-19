/**
 * Т8: чистые половины — клиент Коробки (payload/разбор) и сборка fast-команды.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { BoxClient, buildStartPayload, classifyStartResponse } from '../src/box-client.js'
import { buildFastCommand, fastDocPath, quoteInline } from '../src/intake-fast.js'

test('payload старта: минимум по контракту 1.0.0, пустая цель/ключ отвергаются', () => {
  const ok = buildStartPayload({ goal: '  Выгрузка заказов  ', idempotencyKey: 'k1' })
  assert.ok(ok.ok)
  assert.deepEqual(ok.value, { schema_version: '1.0.0', goal: 'Выгрузка заказов', idempotency_key: 'k1' })

  assert.ok(!buildStartPayload({ goal: '   ', idempotencyKey: 'k' }).ok)
  assert.ok(!buildStartPayload({ goal: 'x', idempotencyKey: '' }).ok)
})

test('payload: файлы с текстом едут телом, binary — только имя+тип; refs маппятся', () => {
  const res = buildStartPayload({
    goal: 'g', idempotencyKey: 'k',
    brief: '  бриф  ',
    files: [
      { name: 'a.md', media_type: 'text/markdown', text: 'текст' },
      { name: 'фото.png', media_type: 'image/png' },
    ],
    externalRefs: { slug: 'direct-faq' },
  })
  assert.ok(res.ok)
  const v = res.value as { brief: string; files: object[]; external_refs: object }
  assert.equal(v.brief, 'бриф')
  assert.deepEqual(v.files[0], { name: 'a.md', media_type: 'text/markdown', text: 'текст' })
  assert.deepEqual(v.files[1], { name: 'фото.png', media_type: 'image/png' })
  assert.deepEqual(v.external_refs, { slug: 'direct-faq' })
})

test('разбор ответа: ack, Error-объект (HTTP 200!), мусор', () => {
  assert.deepEqual(
    classifyStartResponse({ type: 'StartAck', initiative_id: 'i-1', iteration_id: 'it-9', state: 'goal' }),
    { ok: true, initiativeId: 'i-1', iterationId: 'it-9', state: 'goal' },
  )
  const err = classifyStartResponse({ type: 'Error', error: { code: 'conflict', message: 'не та база' } })
  assert.equal(err.ok, false)
  if (!err.ok) { assert.equal(err.code, 'conflict'); assert.equal(err.message, 'не та база') }
  assert.equal(classifyStartResponse('мусор').ok, false)
  assert.equal(classifyStartResponse({}).ok, false)
})

test('BoxClient.start: идемпотентный ключ уезжает, bearer на месте, сеть переживает отказ', async () => {
  const calls: object[] = []
  const client = new BoxClient({
    baseUrl: 'http://box:8700', token: 'sekret',
    fetch: async (url, init) => {
      calls.push({ url, init })
      return { status: 200, json: async () => ({ type: 'StartAck', initiative_id: 'i-7' }) }
    },
  })
  const ack = await client.start({ goal: 'g', idempotencyKey: 'k' })
  assert.ok(ack.ok)
  const call = calls[0] as { url: string; init: { headers: Record<string, string>; body: string } }
  assert.equal(call.url, 'http://box:8700/api/start')
  assert.equal(call.init.headers.authorization, 'Bearer sekret')
  assert.ok(JSON.parse(call.init.body).idempotency_key)

  const dead = new BoxClient({ baseUrl: 'http://x', token: 't', fetch: async () => { throw new Error('down') } })
  const res = await dead.start({ goal: 'g', idempotencyKey: 'k' })
  assert.ok(!res.ok)
  if (!res.ok) assert.equal(res.code, 'network')

  const unconfigured = new BoxClient({ baseUrl: '', token: '' })
  assert.equal(unconfigured.available(), false)
})

test('fast-команда: файлы вперёд, текст в кавычках, слаг и флаги, пустота — ошибка', () => {
  const res = buildFastCommand({ text: 'нужна выгрузка "всё"', paths: ['bft/uploads/1-x/запись.webm'], slug: 'direct-faq' })
  assert.ok(res.ok)
  if (res.ok) {
    assert.match(res.command, /^\/bft-fast bft\/uploads\/1-x\/запись\.webm "нужна выгрузка ""всё""" direct-faq --no-deep --no-recon --no-custdev$/)
  }
  assert.ok(!buildFastCommand({ text: '', paths: [], slug: 'x' }).ok)
  assert.ok(!buildFastCommand({ text: 'текст', paths: [], slug: ' ' }).ok)
})

test('quoteInline: однострочник, внутренние кавычки удваиваются; путь fast-документа', () => {
  assert.equal(quoteInline('много\n  строк   и "кавычки"'), '"много строк и ""кавычки"""')
  assert.equal(fastDocPath('direct-faq'), 'direct-faq/direct-faq-fast.md')
})
