/**
 * Администратор портала (ADR-0012): штатные «Настройки» dsh — только за паролем.
 *
 * Заказчик: сайдбара и «Настроек» нет, запись ключей и плагинов узел
 * отклоняет. Администратор: вход по ADMIN_PASSWORD, интерфейс dsh целиком,
 * «Ещё → Настройки → Модели» открываются, вызов записи доходит до шлюза.
 */
import { expect, test, type APIRequestContext } from '@playwright/test'

const PORTAL = process.env.PORTAL_URL ?? 'http://127.0.0.1:3080'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ''

/** Вызов шлюза /api так, как его делает клиент dsh. */
async function rpc(request: APIRequestContext, method: string, payload: unknown) {
  const res = await request.post(`${PORTAL}/api/${method}`, {
    headers: { 'content-type': 'application/json' },
    data: { type: 'client-request', rpcId: 'e2e-1', method, payload },
  })
  expect(res.status(), `${method}: HTTP`).toBe(200)
  return (await res.json()) as { result: { ok: boolean; error?: { code?: string } } }
}

test('заказчик: сайдбара и «Настроек» нет, запись ключей и плагинов закрыта', async ({ page, request }) => {
  await page.goto(PORTAL)
  await expect(page.getByText('Введите свои мысли')).toBeVisible()
  const status = await (await request.get(`${PORTAL}/api/customer-form.adminStatus`)).json()
  expect(status.admin).toBe(false)
  await expect(page.getByRole('button', { name: 'Меню аккаунта' })).toBeHidden()
  await expect(page.locator('[data-portal-admin]')).toHaveCount(0)
  // Горячая клавиша настроек заказчику не открывает панель.
  await page.keyboard.press('Control+Alt+Comma')
  await page.keyboard.press('Meta+Alt+Comma')
  await expect(page.getByRole('dialog').filter({ hasText: 'Модели' })).toHaveCount(0)

  const models = await request.post(`${PORTAL}/api/customer-form.portalModels`, { data: { chat: null } })
  expect(models.status(), 'модели портала без входа не меняются').toBe(403)

  for (const method of ['credentials/set', 'settings/mutate', 'pluginManager/setPluginEnabled', 'terminal/create']) {
    const body = await rpc(request, method, {})
    expect(body.result.ok, method).toBe(false)
    expect(body.result.error?.code, method).toBe('portal/admin-only')
  }
})

test('администратор: вход по паролю, штатные «Настройки» и запись до шлюза', async ({ page }) => {
  test.skip(!ADMIN_PASSWORD, 'ADMIN_PASSWORD не передан раннеру')
  await page.goto(`${PORTAL}/api/customer-form.admin`)
  await page.getByLabel('Пароль').fill('неверный-пароль')
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page.getByRole('alert')).toHaveText('Неверный пароль.')

  await page.getByLabel('Пароль').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Войти' }).click()
  await expect(page).toHaveURL(`${PORTAL}/`)
  await expect(page.locator('[data-portal-admin]')).toBeVisible()

  // Портал на старте готовит раздел заявок и закрывает открытые окна — ждём готовности.
  await expect(page.getByRole('textbox', { name: /Опишите инициативу/ })).toBeVisible()
  await page.waitForTimeout(1500)
  // Штатные «Настройки» dsh: «Ещё» внизу сайдбара → «Настройки» → «Модели».
  await page.getByRole('button', { name: 'Меню аккаунта' }).click()
  await page.getByText('Настройки', { exact: true }).first().click()
  const settings = page.getByRole('dialog')
  await settings.getByText('Модели', { exact: true }).click()
  // Провайдеры зависят от профиля (под e2e — двойник), сама форма ключей — штатная.
  await expect(settings.getByText('Введите ключи API', { exact: false })).toBeVisible()
  await expect(settings.getByRole('button', { name: /^Редактировать / }).first()).toBeVisible()
  await expect(settings.getByText('Встроенные плагины', { exact: true })).toBeVisible()

  // «Настройки → Портал»: модель полного БФТ выбирается, сохраняется в узле и сбрасывается.
  type Models = { chatChoice: unknown; deep: { provider: string; model: string } | null }
  const readModels = () => page.evaluate(async () => (await fetch('/api/customer-form.portalModels')).json()) as Promise<Models>
  const chatBefore = (await readModels()).chatChoice
  await settings.getByText('Портал', { exact: true }).click()
  const deepSelect = settings.getByLabel('Модель полного БФТ')
  await expect(deepSelect).toBeVisible()
  const option = await deepSelect.locator('option').nth(1).getAttribute('value')
  expect(option, 'в списке есть модели провайдеров с ключом').toBeTruthy()
  await deepSelect.selectOption(option!)
  await settings.getByRole('button', { name: 'Сохранить' }).click()
  await expect(settings.getByRole('status')).toContainText('Сохранено')
  const saved = await readModels()
  expect(saved.deep && `${saved.deep.provider}\u0000${saved.deep.model}`).toBe(option)
  expect(saved.chatChoice, 'модель полного БФТ не трогает выбор модели чата').toEqual(chatBefore)
  await deepSelect.selectOption('')
  await settings.getByRole('button', { name: 'Сохранить' }).click()
  await expect(settings.getByRole('status')).toContainText('Сохранено')
  const reset = await readModels()
  expect(reset.deep).toBeNull()
  expect(reset.chatChoice).toEqual(chatBefore)

  // Вызов записи с кукой администратора доходит до шлюза (а не до отказа портала).
  const body = await page.evaluate(async () => {
    const res = await fetch('/api/pluginManager/cancelInstall', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'e2e-2', method: 'pluginManager/cancelInstall', payload: { id: 'e2e-нет-такой-установки' } }),
    })
    return res.json() as Promise<{ result: { ok: boolean; error?: { code?: string } } }>
  })
  expect(body.result.error?.code).not.toBe('portal/admin-only')

  // Выход: снова режим заказчика.
  await page.goto(`${PORTAL}/api/customer-form.admin`)
  await page.getByRole('button', { name: 'Выйти' }).click()
  await page.goto(PORTAL)
  await expect(page.getByText('Введите свои мысли')).toBeVisible()
  await expect(page.locator('[data-portal-admin]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Меню аккаунта' })).toBeHidden()
})
