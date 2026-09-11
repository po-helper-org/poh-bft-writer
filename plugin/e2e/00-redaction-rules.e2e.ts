/**
 * Правила обезличивания (support/redact.ts). Харнесс не нужен: это чистые регулярки.
 *
 * Общие правила проверяются на вымышленных данных здесь. Словарь установки
 * (`e2e/.redact.local.json`, в .gitignore) проверяется на собственных `samples`: после
 * подмены в них не должно остаться ничего из `forbidden` — иначе словарь надо дописать до
 * того, как снимать скриншоты.
 */
import { expect, test } from '@playwright/test'
import { FORBIDDEN, GENERIC_RULES, LOCAL, REDACTIONS, redactText } from './support/redact.ts'

test('почта уходит на example.com', () => {
  expect(redactText('пишите на ivan.petrov@acme-corp.example', GENERIC_RULES)).toBe('пишите на user@example.com')
})

test('фамилии в обоих порядках слов заменяются, обычный текст — нет', () => {
  expect(redactText('Заказчик: Петров Иван / Сидорова Анна', GENERIC_RULES)).toBe('Заказчик: Сотрудник / Сотрудник')
  expect(redactText('Мария Кузнецова согласовала', GENERIC_RULES)).toBe('Сотрудник согласовала')
  expect(redactText('Покупатель оформляет возврат сам за минуту', GENERIC_RULES)).toBe('Покупатель оформляет возврат сам за минуту')
  expect(redactText('Открыть доску требований', GENERIC_RULES)).toBe('Открыть доску требований')
})

test('словарь установки вычищает собственные образцы', () => {
  const samples = LOCAL.samples ?? []
  test.skip(samples.length === 0, 'нет e2e/.redact.local.json с samples — см. redact.local.example.json')
  const forbidden = new RegExp(FORBIDDEN, 'iu')
  for (const sample of samples) {
    expect(redactText(sample, REDACTIONS), sample).not.toMatch(forbidden)
  }
})
