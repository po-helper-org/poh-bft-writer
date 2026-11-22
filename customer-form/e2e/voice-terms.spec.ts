/**
 * E2E · термины диалога в подсказке микрофону (ADR-0008): заказчик написал
 * про «1С:ЗУП» и «Битрикс24» → надиктовал → распознавание (speech-ru) получает
 * эти термины от customer-form по ключу записи. Что термины дошли, видно
 * в логе узла: «[speech-ru] термины диалога: …» (раннер печатает его).
 */
import { expect, test } from '@playwright/test'
import { dictate, fakeMic } from './voice.js'

test.use(fakeMic('memo.wav'))

test('микрофон: термины текущего диалога уходят распознавателю', async ({ page }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(90_000)
  const { composer } = await dictate(page, 0, async (composerBox) => {
    await composerBox.click()
    await page.keyboard.type('Ирина Петрова: перенести заявки на отпуск в Битрикс24 с выгрузкой в 1С:ЗУП. Ответственный Олег Сидоров. #без-вопросов')
    await page.getByRole('button', { name: 'Отправить' }).click()
    await expect(page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('Принято, записала.').first()).toBeVisible({ timeout: 15_000 })
  }, 9)
  await expect(composer).toContainText(/отдел\S* кадров/i, { timeout: 30_000 })
})
