/**
 * E2E · HowToDemo шаг 1 — «от открытия до ссылки на заявку» (ADR-0007).
 *
 * Покрывает весь первый экран заказчика на живом стеке (:3080):
 *   открыл ссылку → увидел «Введите свои мысли» → заполнил ФИО/email →
 *   изложил инициативу (текст + ссылка-чип) → «Отправить» →
 *   ссылка на задачу появилась (быстро; бюджет 5с, внутр. критерий <1с) →
 *   задача реально лежит в Vikunja с лейблом «запрос».
 * Заодно ловит boot-состояния: если бандл не активировался (pending /
 * did not activate), тексты экрана не появятся и тест упадёт на первом expect.
 */
import { expect, test } from '@playwright/test'

const UNIQUE = Date.now().toString(36)

test('открытие → ввод обращения → ссылка на заявку', async ({ page }) => {
  // Шаг 1-2: открываем выданную ссылку — экран «Введите свои мысли».
  const url = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Введите свои мысли' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByPlaceholder('Что нужно, зачем и когда хотите результат…')).toBeVisible()

  // Шаг 3 (текстовая часть): ФИО, email и суть с ссылкой — чип «Источники».
  await page.getByPlaceholder('ФИО').fill(`E2E Тестов ${UNIQUE}`)
  await page.getByPlaceholder('email').fill('e2e@test.local')
  await page.getByPlaceholder('Что нужно, зачем и когда хотите результат…').fill(
    `E2E-инициатива ${UNIQUE}: нужна выгрузка отчётов в CSV. Сейчас руками, долго. ` +
    'Хочу к утру автоматически. Материалы: https://confluence.example/x/E2E')
  await expect(page.getByText('🔗 confluence.example/x/E2E')).toBeVisible()

  // Шаг 6: «Отправить» → ссылка на задачу. Бюджет 5с (внутренний критерий <1с —
  // на живом стеке сеть+трекер; замеряем и отражаем в отчёте).
  const started = Date.now()
  await page.getByRole('button', { name: 'Отправить' }).click()
  const link = page.locator('a.tasklink, a:has-text("Запрос создан"), a[href*="/tasks/"]').first()
  await expect(link).toBeVisible({ timeout: 5_000 })
  const elapsed = Date.now() - started
  console.log(`[e2e] ссылка появилась за ${elapsed}мс (критерий <1000мс, бюджет 5000мс)`)
  const taskHref = await link.getAttribute('href')
  expect(taskHref, 'ссылка ведёт на задачу трекера').toContain('/tasks/')

  // Экран перешёл в режим диалога: ассистент открыл микрочат.
  await expect(page.getByPlaceholder(/Ответьте текстом/)).toBeVisible({ timeout: 10_000 })

  // Шаг 10 (контроль): задача реально в Vikunja — с лейблом «запрос».
  const taskId = Number(new URL(taskHref!).pathname.split('/').pop())
  const api = await requestTask(taskId)
  expect(api.ok, `задача ${taskId} читается из Vikunja`).toBeTruthy()
  expect(api.labels, 'лейбл «запрос» на месте').toContain('запрос')
  expect(api.title, 'заголовок — из текста обращения').toContain('E2E-инициатива')
})

/** Чтение задачи напрямую из Vikunja (токен админа — из окружения стека). */
async function requestTask(taskId: number): Promise<{ ok: boolean; labels: string[]; title: string }> {
  const base = process.env.TRACKER_URL ?? 'http://127.0.0.1:3456/api/v1'
  const login = await fetch(`${base}/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: process.env.TRACKER_USER ?? 'bft-admin',
      password: process.env.TRACKER_PASSWORD ?? '',
    }),
  })
  if (!login.ok) return { ok: false, labels: [], title: '' }
  const token = ((await login.json()) as { token: string }).token
  const res = await fetch(`${base}/tasks/${taskId}`, { headers: { authorization: `Bearer ${token}` } })
  if (!res.ok) return { ok: false, labels: [], title: '' }
  const t = (await res.json()) as { title: string; labels?: { title: string }[] }
  return { ok: true, labels: (t.labels ?? []).map((l) => l.title), title: t.title }
}
