/**
 * Т6: онбординг — чистая половина (onboarding.ts) и сервис (onboarding-host.ts)
 * на фейковых fs/fetch. Дисковый ввод-вывод инъектирован — тесты без него.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { ONBOARDING_SLIDES, keyCheckFromStatus, restartHint, validateZaiKey } from '../src/onboarding.js'
import { OnboardingService } from '../src/onboarding-host.js'

function fakeFs(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed))
  return {
    files,
    readTextFile: async (p: string) => {
      if (!files.has(p)) throw Object.assign(new Error('нет'), { code: 'ENOENT' })
      return files.get(p)!
    },
    writeTextFile: async (p: string, t: string) => { files.set(p, t) },
  }
}

const GOOD_KEY = 'a'.repeat(32) + '.' + 'b'.repeat(16)

test('слайдов пять, connect — последний, порядок фиксирован', () => {
  assert.equal(ONBOARDING_SLIDES.length, 5)
  assert.equal(ONBOARDING_SLIDES[4].id, 'connect')
  assert.deepEqual(ONBOARDING_SLIDES.map((s) => s.id), ['intro', 'input', 'minute', 'board', 'connect'])
})

test('форма ключа: id.secret из hex; пустой и мусорный отвергаются с причиной', () => {
  assert.equal(validateZaiKey(GOOD_KEY).ok, true)
  assert.equal(validateZaiKey('').ok, false)
  const bad = validateZaiKey('sk-123')
  assert.equal(bad.ok, false)
  assert.match(bad.reason ?? '', /не похож/i)
})

test('стейт по умолчанию: не пройден, ключа нет; с env — keyActive', async () => {
  const fs = fakeFs()
  const svc = new OnboardingService({ home: '/d', fs, env: {} })
  const st = await svc.state()
  assert.deepEqual(st, { done: false, hasKey: false, keyActive: false, dictation: 'browser' })

  const active = new OnboardingService({ home: '/d', fs, env: { ZAI_API_KEY: 'x' } })
  assert.equal((await active.state()).keyActive, true)
})

test('complete: ключ в файл, флаг и диктовка в json, подсказка о рестарте', async () => {
  const fs = fakeFs()
  const svc = new OnboardingService({ home: '/d', fs, env: {} })
  const res = await svc.complete(GOOD_KEY, 'local')
  assert.ok(!('error' in res))
  assert.match(res.restartHint, /restart harness-web/)
  assert.equal((fs.files.get('/d/zai.key') ?? '').trim(), GOOD_KEY)
  const flags = JSON.parse(fs.files.get('/d/onboarding.json')!)
  assert.deepEqual(flags, { done: true, dictation: 'local' })
  assert.equal((await svc.state()).hasKey, true)
})

test('complete отвергает плохой ключ, ничего не пишет', async () => {
  const fs = fakeFs()
  const svc = new OnboardingService({ home: '/d', fs, env: {} })
  const res = await svc.complete('мусор', 'browser')
  assert.ok('error' in res)
  assert.equal(fs.files.size, 0)
})

test('skip: флаг без ключа; диктовка сохраняется отдельно', async () => {
  const fs = fakeFs()
  const svc = new OnboardingService({ home: '/d', fs, env: {} })
  await svc.setDictation('local')
  await svc.skip()
  const st = await svc.state()
  assert.equal(st.done, true)
  assert.equal(st.hasKey, false)
  assert.equal(st.dictation, 'local')
})

test('checkKey: форма раньше сети; 200 — ок, 401 — человекочитаемо', async () => {
  const fs = fakeFs()
  const status = (code: number) => async () => ({ status: code })
  const svc = (code: number) => new OnboardingService({ home: '/d', fs, env: {}, fetch: status(code) })

  assert.equal((await svc(200).checkKey(GOOD_KEY)).ok, true)
  assert.match((await svc(401).checkKey(GOOD_KEY)).message, /отклонён/)
  assert.match((await svc(503).checkKey(GOOD_KEY)).message, /503/)
  // Плохая форма — сеть не трогается (fetch бы упал с исключе… нет, он не зовётся).
  const noNet = new OnboardingService({ home: '/d', fs, env: {} })
  const res = await noNet.checkKey('мусор')
  assert.equal(res.ok, false)
})

test('checkKey переживает сетевой отказ', async () => {
  const fs = fakeFs()
  const svc = new OnboardingService({
    home: '/d', fs, env: {},
    fetch: async () => { throw new Error('network down') },
  })
  const res = await svc.checkKey(GOOD_KEY)
  assert.equal(res.ok, false)
  assert.match(res.message, /не отвечает/)
})

test('keyCheckFromStatus: коды согласованы с сообщениями', () => {
  assert.equal(keyCheckFromStatus(200).ok, true)
  assert.equal(keyCheckFromStatus(403).ok, false)
  assert.match(keyCheckFromStatus(500).message, /500/)
})

test('restartHint называет команду явно', () => {
  assert.match(restartHint(), /docker compose restart harness-web/)
})
