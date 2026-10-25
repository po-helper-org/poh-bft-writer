/**
 * E2E · разбор материалов не блокирует заказчика (ADR-0007 rev10): запись
 * встречи на 5 минут расшифровывается дольше, чем read_customer_materials
 * ждёт (6 с), — ассистент сразу задаёт короткую форму «Краткое название
 * инициативы», разбор идёт, пока заказчик отвечает, и после ответа он
 * получает черновик по материалам.
 *
 * Модель — двойник (e2e/llm-double.mjs): на «Ещё разбираются» он задаёт форму,
 * после неё снова читает материалы; карточку показывает, только если в
 * расшифровке есть «отдел кадров», — разбор настоящий (context-ingest).
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const UNIQUE = Date.now().toString(36)
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

test('длинная запись: форма сразу, черновик — после ответа, без ожидания разбора', async ({ page }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(180_000)

  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Прикрепить файлы' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('option', { name: /^Файл/ }).click()
  await (await chooser).setFiles({ name: `meeting-${UNIQUE}.m4a`, mimeType: 'audio/mp4', buffer: fixture('meeting.m4a') })
  await expect(page.getByText(`meeting-${UNIQUE}.m4a`).first()).toBeVisible()

  await composer.click()
  await page.keyboard.type(`Встреча ${UNIQUE}: запись созвона во вложении. Ирина Петрова, i.petrova@example.com`)
  const sentAt = Date.now()
  await page.getByRole('button', { name: 'Отправить' }).click()
  await expect(page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()).toBeVisible({ timeout: 5_000 })

  // Форма — не дожидаясь расшифровки: только краткое название.
  await expect(page.getByText('Краткое название инициативы').first(), 'форма до конца разбора').toBeVisible({ timeout: 15_000 })
  console.log(`▸ форма через ${Date.now() - sentAt} мс после отправки`)
  await page.getByRole('radio', { name: 'Отпуска в портале' }).click()
  await page.getByRole('button', { name: 'Отправить' }).last().click()

  // Разбор шёл, пока заказчик отвечал: черновик по материалам.
  await expect(page.getByText('Как я буду принимать работу'), 'карточка по материалам').toBeVisible({ timeout: 90_000 })
  await expect(page.getByText('Как я понял задачу').first()).toBeVisible({ timeout: 10_000 })
  console.log(`▸ черновик через ${Date.now() - sentAt} мс после отправки`)
})
