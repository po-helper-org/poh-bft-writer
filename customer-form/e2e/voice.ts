/** Общее для e2e микрофона: подставной микрофон Chromium и запись с композера. */
import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
export const fakeMic = (wav: string) => ({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fixture(wav)}`],
  },
})

export async function dictate(page: Page, seconds: number) {
  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Начать запись' }).click()
  const stop = page.getByRole('button', { name: 'Остановить и распознать' })
  await expect(stop).toBeVisible({ timeout: 10_000 })
  await page.waitForTimeout(seconds * 1000)
  await stop.click()
  return { composer, stoppedAt: Date.now() }
}
