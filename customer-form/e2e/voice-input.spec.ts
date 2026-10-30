/**
 * E2E · микрофон композера по-русски (ADR-0008): «Начать запись» → речь →
 * «Остановить и распознать» → русский текст в поле ввода.
 *
 * Микрофон подставной: Chromium читает fixtures/memo.wav (12 с голосовой
 * заметки) вместо устройства. Распознаёт провайдер ru-speech плагина speech-ru
 * — настоящий, без двойника: Requesty gpt-4o-mini-transcribe, без ключа —
 * GigaAM. Модель чата в этом сценарии не участвует.
 */
import { expect, test } from '@playwright/test'
import { dictate, fakeMic } from './voice.js'

test.use(fakeMic('memo.wav'))

test('микрофон: запись → speech-ru → русский текст в композере', async ({ page }) => {
  test.setTimeout(90_000)
  const { composer, stoppedAt } = await dictate(page, 9) // фраза про отдел кадров — в первых секундах
  await expect(composer, 'распознанный текст в композере').toContainText(/отдел\S* кадров/i, { timeout: 30_000 })
  console.log(`▸ текст в композере через ${Date.now() - stoppedAt} мс после «Остановить»: ${(await composer.textContent())?.slice(0, 80)}…`)
})
