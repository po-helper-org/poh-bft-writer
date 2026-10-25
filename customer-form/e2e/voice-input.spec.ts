/**
 * E2E · микрофон композера по-русски (rev9): «Начать запись» → речь →
 * «Остановить и распознать» → русский текст в поле ввода.
 *
 * Микрофон подставной: Chromium читает fixtures/memo.wav (12 с голосовой
 * заметки) вместо устройства. Распознаёт провайдер gigaam-local
 * (customer-form/speech → context-ingest, GigaAM v3) — настоящий, без двойника:
 * модель чата в этом сценарии не участвует.
 */
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const WAV = fileURLToPath(new URL('./fixtures/memo.wav', import.meta.url))

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${WAV}`],
  },
})

test('микрофон: запись → GigaAM → русский текст в композере', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Начать запись' }).click()
  const stop = page.getByRole('button', { name: 'Остановить и распознать' })
  await expect(stop).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(9_000) // фраза про отдел кадров — в первых секундах записи
  const stoppedAt = Date.now()
  await stop.click()

  await expect(composer, 'распознанный текст в композере').toContainText(/отдел\S* кадров/i, { timeout: 30_000 })
  console.log(`▸ текст в композере через ${Date.now() - stoppedAt} мс после «Остановить»: ${(await composer.textContent())?.slice(0, 80)}…`)
})
