/** Плейбук 2 — превью требования и «Работать в чате». */
import { expect, test } from '@playwright/test'
import { clearComposer, composer, openHarness, openPanel, panel, requireHarness, shot } from './support/harness.ts'

const SCENARIO = '02-preview-and-chat'

test.describe.configure({ mode: 'serial' })

test('превью: открыть, уйти в чат с черновиком, вернуться', async ({ page }) => {
  const url = requireHarness()
  await openHarness(page, url)
  const aside = await openPanel(page)

  // 1. Строка списка → превью.
  const item = aside.locator('.bft-item').first()
  const id = (await item.locator('.bft-item-id').innerText()).trim()
  await item.click()
  const preview = page.getByRole('complementary', { name: 'Превью' })
  await expect(preview).toBeVisible()
  await expect(preview.getByText(id, { exact: true })).toBeVisible()
  await expect(preview.getByText('Стадия', { exact: true })).toBeVisible()
  const toChat = preview.getByRole('button', { name: 'Работать в чате' })
  await expect(toChat).toBeVisible()
  await expect(preview.getByRole('button', { name: 'Детальная страница' })).toBeVisible()
  await shot(page, SCENARIO, '01-preview', toChat)

  // 2. «Работать в чате»: чат открыт, черновик на месте, ничего не отправлено.
  await toChat.click()
  await expect(panel(page)).toBeHidden()
  // Черновик приходит с сервера (подкоманда `handoff`) и зависит от состояния требования:
  // документ есть — «Продолжи работу над БФТ …», документа нет — `/bft-fast <id> …` с
  // источником из задачи доски. Обе формы называют идентификатор.
  const input = composer(page)
  await expect(input).toContainText(id)
  await expect(input).toContainText(/Продолжи работу над БФТ|\/bft-fast /)
  await shot(page, SCENARIO, '02-chat-draft', input)
  await clearComposer(page)

  // 3. «Назад к списку» возвращает к очереди.
  await openPanel(page)
  await aside.locator('.bft-item').first().click()
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Назад к списку' }).click()
  await expect(panel(page)).toBeVisible()
  await expect(aside.locator('.bft-item').first()).toBeVisible()
  await aside.getByRole('button', { name: 'Закрыть', exact: true }).click()
})
