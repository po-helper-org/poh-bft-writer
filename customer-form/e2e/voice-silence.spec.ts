/**
 * E2E · микрофон молчит (ADR-0008): браузер дал доступ, но пишет тишину (не
 * то устройство, выключен в системе) — заказчик видит, что проверить, а не
 * «Речь не распознана». Подставной микрофон читает fixtures/silence.wav.
 */
import { expect, test } from '@playwright/test'
import { dictate, fakeMic } from './voice.js'

test.use(fakeMic('silence.wav'))

test('микрофон молчит → подсказка про устройство, а не «Речь не распознана»', async ({ page }) => {
  test.setTimeout(60_000)
  await dictate(page, 3)
  await expect(page.getByText(/микрофон передал тишину/).first()).toBeVisible({ timeout: 15_000 })
})
