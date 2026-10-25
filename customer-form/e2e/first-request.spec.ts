/**
 * E2E · HowToDemo шаг 1 (rev5) — открыл портал → ввёл обращение → ссылка на заявку.
 *
 * Портал заказчика = главная страница dsh без сайдбара (ADR-0007 rev4/5).
 * Проверяем путь заказчика целиком: вход без кода и без «Internal Testing
 * Notice», русская инструкция «Введите свои мысли», композер в workspace
 * «Customer-requests» с рабочей моделью по умолчанию,
 * отправка → ссылка на задачу в ленте < 1 с → задача есть в Vikunja.
 * Ответ модели не проверяем: он зависит от квоты ключа, а заявка — нет.
 * Селекторы — классы харнесса 0.1.7-rc.2 (как в poh-mobile-skin).
 */
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const TRACKER_API = process.env.TRACKER_API ?? 'http://127.0.0.1:3456/api/v1'
const UNIQUE = Date.now().toString(36)

test.beforeEach(async ({ page }) => {
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 160)) })
})

test('открыл портал → обращение → ссылка на заявку < 1 с', async ({ page, request }) => {
  // Шаг 1: открыл ссылку — без кода, токена и модалок.
  const res = await page.goto(CUSTOMER_URL)
  expect(res?.status(), 'вход без кода отдал приложение').toBe(200)

  // Шаг 2: стартовый экран dsh — композер на всю колонку, сайдбара нет.
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer, 'композер dsh').toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Continue' }), 'нет Internal Testing Notice').toHaveCount(0)
  await expect(page.getByText('Введите свои мысли'), 'инструкция по-русски').toBeVisible()
  await expect(page.getByRole('button', { name: 'Раздел заявок' }), 'workspace заказчика')
    .toContainText('Customer-requests', { timeout: 15_000 })
  // Интерфейса кодера нет: выбор модели, пресета и режима доступа выключены.
  await expect(page.getByRole('button', { name: /Select model/ })).toHaveCount(0)
  const width = (await composer.boundingBox())?.width ?? 0
  expect(width, 'композер не схлопнут скрытым сайдбаром').toBeGreaterThan(300)

  // Шаг 3: обращение текстом и отправка (Enter в композере dsh).
  const text = `E2E-инициатива ${UNIQUE}: нужна выгрузка отчётов в CSV, сейчас руками и долго. ` +
    'Заказчик — E2E Тестов, e2e@test.local'
  await composer.click()
  await page.keyboard.type(text)
  // «Отправить» активна — у модели по умолчанию есть ключ (с DeepSeek без ключа была бы выключена).
  await expect(page.getByRole('button', { name: 'Отправить' })).toBeEnabled()
  const sentAt = Date.now()
  await page.keyboard.press('Enter')

  // Шаг 4: ссылка на заявку в ленте — критерий HowToDemo п.6: < 1 с.
  const link = page.getByText(/Заявка #\d+ зарегистрирована в беклоге: http\S+\/tasks\/\d+/).first()
  await expect(link).toBeVisible({ timeout: 5_000 })
  const elapsed = Date.now() - sentAt
  console.log(`▸ ссылка на заявку через ${elapsed} мс`)
  expect(elapsed, 'ссылка < 1 с').toBeLessThan(1_000)
  await expect(page.getByText(text, { exact: true }), 'обращение в ленте').toBeVisible()

  // Шаг 5: задача в беклоге Vikunja — заголовок из обращения, лейбл «запрос».
  const taskId = Number(/\/tasks\/(\d+)/.exec((await link.textContent()) ?? '')?.[1])
  const login = await request.post(`${TRACKER_API}/login`, {
    data: { username: process.env.TRACKER_USER ?? 'bft-admin', password: process.env.TRACKER_PASSWORD ?? '' },
  })
  test.skip(!login.ok(), 'нет TRACKER_PASSWORD — проверку задачи в Vikunja пропускаем')
  const { token } = (await login.json()) as { token: string }
  const task = await request.get(`${TRACKER_API}/tasks/${taskId}`, { headers: { authorization: `Bearer ${token}` } })
  expect(task.ok(), `задача #${taskId} в трекере`).toBeTruthy()
  const body = (await task.json()) as { title: string; description: string; labels: { title: string }[] | null }
  expect(body.title).toContain(`E2E-инициатива ${UNIQUE}`)
  expect(body.description).toContain('e2e@test.local')
  expect((body.labels ?? []).map((l) => l.title)).toContain('запрос')
})
