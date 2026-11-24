import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isBalanceError, ProviderHealth } from '../lib-test/provider-health.js'

test('распознаёт «закончился баланс»', () => {
  assert.ok(isBalanceError(Object.assign(new Error('Payment Required'), { statusCode: 402 })))
  assert.ok(isBalanceError(new Error('Insufficient credits. Please top up your account')))
  assert.ok(isBalanceError({ message: 'failed', cause: { responseBody: '{"error":{"message":"Your credit balance is too low"}}' } }))
  assert.ok(isBalanceError(new Error('HTTP 402 Payment Required')))
  assert.ok(isBalanceError(new Error('Недостаточно средств на счёте')))
  assert.ok(!isBalanceError(new Error('rate limit exceeded')), '429 — не баланс')
  assert.ok(!isBalanceError(Object.assign(new Error('Too Many Requests'), { statusCode: 429 })))
  assert.ok(!isBalanceError(new Error('модель вернула пустой ответ (токены {"input":402})')), 'число 402 в тексте — не статус')
  assert.ok(!isBalanceError(undefined))
})

test('отметка провайдера живёт ttl и снимается', () => {
  let now = 1_000
  const h = new ProviderHealth(60_000, () => now)
  h.exhausted('requesty')
  assert.ok(h.isExhausted('requesty'))
  assert.ok(!h.isExhausted('zai'))
  assert.equal(h.list().length, 1)
  now += 61_000
  assert.ok(!h.isExhausted('requesty'), 'истекла — пробуем снова')
  h.exhausted('requesty')
  h.clear()
  assert.equal(h.list().length, 0)
})
