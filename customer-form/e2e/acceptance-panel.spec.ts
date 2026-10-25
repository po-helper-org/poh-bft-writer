/**
 * E2E · сценарий приёмки страницей в правой панели (ADR-0007 rev10):
 * карточка согласования открывает нашу страницу (UserFlow Mermaid сверху,
 * раскадровка свёрнута), замечание правой кнопкой по выделенному тексту
 * копится в корзине и встаёт в строку ввода; вкладка Information — ссылка
 * на заявку и статус сценария.
 */
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const UNIQUE = Date.now().toString(36)

test('сценарий справа: UserFlow, свёрнутая раскадровка, замечание → строка ввода, Information', async ({ page }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type(`Панель ${UNIQUE}: утренняя выгрузка отчётов в CSV. Иван Тест, ivan@test.local`)
  await page.getByRole('button', { name: 'Отправить' }).click()
  const pin = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(pin).toBeVisible({ timeout: 5_000 })
  const taskId = /#(\d+)/.exec((await pin.textContent()) ?? '')?.[1]

  await page.getByRole('radio', { name: 'Вручную в Excel' }).click()
  await page.getByRole('radio', { name: 'В почте утром' }).click()
  await page.getByRole('button', { name: 'Отправить' }).last().click()
  await expect(page.getByText('Как я буду принимать работу')).toBeVisible({ timeout: 30_000 })

  // Справа — наша страница: UserFlow нарисован, раскадровка свёрнута, макет письма.
  const panel = page.frameLocator('iframe[data-customer-acceptance]')
  await expect(panel.getByRole('heading', { name: 'Путь приёмки' })).toBeVisible({ timeout: 15_000 })
  await expect(panel.locator('#flow svg'), 'Mermaid UserFlow').toBeVisible({ timeout: 20_000 })
  await expect(panel.locator('details.story')).not.toHaveAttribute('open', /.*/)
  await panel.locator('details.story > summary').click()
  await expect(panel.locator('.step').first().locator('svg text', { hasText: 'Отчёт продаж' }), 'макет экрана из mock').toBeVisible()
  await page.screenshot({ path: 'test-results/acceptance-panel.png' })

  // Замечание: выделить текст → правая кнопка → текст → «Добавить замечание».
  const h1 = panel.locator('h1')
  await h1.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection()!; s.removeAllRanges(); s.addRange(r) })
  await h1.click({ button: 'right' })
  await panel.locator('#popText').fill('Не CSV, а Excel-файл')
  await panel.getByRole('button', { name: 'Добавить замечание' }).click()
  await expect(panel.locator('#count')).toHaveText('1')
  await expect(panel.locator('#toast')).toContainText('в строке ввода')

  // Карточку — в «Нужны правки»: строка ввода показывается с замечанием.
  await page.getByRole('button', { name: 'Нужны правки' }).click()
  await expect(composer).toContainText('Поправь сценарий приёмки', { timeout: 10_000 })
  await expect(composer).toContainText('Не CSV, а Excel-файл')

  // Information: ссылка на заявку и сценарий.
  await page.getByRole('tab', { name: 'Information' }).click()
  await expect(page.locator('[data-customer-info]').getByRole('link', { name: `Заявка #${taskId}` })).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-customer-info]')).toContainText('Сценарий приёмки')
})
