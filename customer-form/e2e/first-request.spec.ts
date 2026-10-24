/**
 * E2E · HowToDemo шаг 1 (rev4) — вход без кода → ввод обращения в композер dsh.
 *
 * Новый UX (ADR-0007 rev4): портал заказчика = главная страница dsh без
 * сайдбара; никаких своих форм. Проверяем: открыл → композер на месте →
 * напечатал обращение → Enter → начался чат (фаза ушла с hero).
 * Селекторы — классы харнесса 0.1.7-rc.2 (как в poh-mobile-skin).
 */
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 160)) })
})

const UNIQUE = Date.now().toString(36)

test('вход без кода → обращение в композере → чат начался', async ({ page }) => {
  // Шаг 1: открыл 127.0.0.1:3080 — БЕЗ токена/кода (прокси подставил сам).
  const url = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
  const res = await page.goto(url)
  expect(res?.status(), 'вход без кода отдал приложение').toBe(200)

  // Первый запуск dsh показывает notice «Internal Testing» — закрываем.
  const notice = page.getByRole('button', { name: 'Continue' })
  await notice.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined)
  if (await notice.isVisible()) await notice.click()

  // Шаг 2: главная dsh — композер присутствует, сайдбар скрыт нашим CSS.
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer, 'композер dsh (workspace подключён плагином)').toBeVisible({ timeout: 30_000 })
  const sidebarHidden = await page.evaluate(() => {
    const col = document.querySelector('.pI_x6G_sidebarCol')
    return col ? getComputedStyle(col).display === 'none' : true
  })
  expect(sidebarHidden, 'сайдбар скрыт (customer-form CSS)').toBeTruthy()

  // Дефолт каталога — DeepSeek без ключа (Send задизейблен): выбираем GLM
  // один раз — dsh персистит выбор в settings (volume), дальше дефолт навсегда.
  const modelBtn = page.locator('button', { hasText: /DeepSeek|GLM|Select model/ }).first()
  if (await modelBtn.isVisible().catch(() => false)) {
    const sendBefore = page.getByRole('button', { name: 'Send message' })
    if (await sendBefore.isDisabled().catch(() => true)) {
      await modelBtn.click()
      const glm = page.locator('[role=menuitem], [role=option], button', { hasText: /GLM/i }).first()
      await glm.waitFor({ state: 'visible', timeout: 5000 })
      await glm.click()
      await expect(sendBefore).toBeEnabled({ timeout: 10_000 })
    }
  }

  // Шаг 3: печатаю обращение и отправляю (Enter в композере dsh).
  await composer.click()
  await page.keyboard.type(
    `E2E-инициатива ${UNIQUE}: нужна выгрузка отчётов в CSV, сейчас руками и долго. ` +
    'Хочу к утру автоматически. Заказчик — E2E Тестов, e2e@test.local')
  await page.keyboard.press('Enter')

  // Шаг 4: начался чат — фаза контента ушла со стартового hero.
  const body = page.locator('.wSkVaW_body').first()
  await expect
    .poll(async () => body.getAttribute('data-content-phase'), { timeout: 20_000 })
    .not.toBe('hero')

  // Отправленный текст виден в ленте (пользовательская реплика).
  await expect(page.getByText(`E2E-инициатива ${UNIQUE}`)).toBeVisible({ timeout: 10_000 })
})
