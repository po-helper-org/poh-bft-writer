/**
 * E2E · «Мои обращения» на стартовом экране (ADR-0007 rev12): заказчик завёл
 * обращение, открыл портал снова — под формой последние обращения этого
 * браузера, клик открывает чат по инициативе, «Смотреть все обращения» ведёт
 * на доску «Запросы» трекера.
 * Ответ модели не нужен: заявка создаётся по первому сообщению.
 */
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const UNIQUE = Date.now().toString(36)

test('под формой — мои обращения: клик открывает чат, «все» — доска', async ({ page }) => {
  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })

  const text = `Мои обращения ${UNIQUE}: напоминания о сроках договоров`
  await composer.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  const link = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(link).toBeVisible({ timeout: 5_000 })
  const taskId = Number(/#(\d+)/.exec((await link.textContent()) ?? '')?.[1])

  // Частые входы без сообщений не вытесняют обращение: 80 старых пустых сессий
  // свежее нашей — после загрузки списка они вычищены.
  await page.evaluate(() => {
    const key = 'customer-form/sessions'
    const own = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[]
    const empty = Array.from({ length: 80 }, (_, i) => ({ id: `session-empty-${i}`, at: 1 }))
    localStorage.setItem(key, JSON.stringify([...empty, ...own]))
  })

  // Новый вход: пустой чат, под формой — список, наше обращение первым.
  await page.goto(CUSTOMER_URL)
  await expect(composer).toBeVisible({ timeout: 30_000 })
  const recent = page.getByRole('region', { name: 'Мои обращения' })
  await expect(recent).toBeVisible({ timeout: 15_000 })
  const rows = recent.locator('[data-request]')
  expect(await rows.count()).toBeLessThanOrEqual(5)
  await expect(rows.first()).toHaveAttribute('data-request', String(taskId))
  await expect(rows.first()).toContainText(text.slice(0, 40))
  await expect(rows.first(), 'статус — колонка доски').toContainText('Создан')

  // Список стоит под формой, а не над ней.
  const formBox = await composer.boundingBox()
  const listBox = await recent.boundingBox()
  expect(listBox!.y).toBeGreaterThan(formBox!.y + formBox!.height)

  const kept = await page.evaluate(() => localStorage.getItem('customer-form/sessions') ?? '')
  expect(kept, 'пустые старые сессии вычищены').not.toContain('session-empty-')

  const all = recent.getByRole('link', { name: /Смотреть все обращения/ })
  await expect(all).toHaveAttribute('href', /\/projects\/\d+\/\d+$/)
  await expect(all).toHaveAttribute('target', '_blank')

  // Клик — чат по этой инициативе, список пропадает вместе со стартовым экраном.
  await rows.first().click()
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(recent).toHaveCount(0)
})
