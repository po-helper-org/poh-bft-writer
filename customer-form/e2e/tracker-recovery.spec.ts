/**
 * E2E · базовый сценарий заказчика при сбоях трекера (ADR-0007 rev17).
 *
 * На живом портале заявка переставала создаваться: токен Vikunja истекал, узел
 * не перелогинивался, а сдача отвечала «заявка этой сессии ещё не
 * зарегистрирована» — агент трижды повторял и сдавался, документ БФТ не
 * собирался. Оба теста проходят путь целиком: обращение → вопросы формой →
 * «Согласую» → сдача → документ БФТ справа → заявка в Vikunja.
 *
 *  1) токен трекера истёк до первого сообщения — узел входит заново, заявка и
 *     ссылка появляются как обычно;
 *  2) трекер не ответил на первое сообщение — заявки нет, но сдача заводит её
 *     сама: ссылка «📌 Заявка #N», отметка согласованного сценария, документ.
 *
 * Сбои включает эндпоинт /api/customer-form.e2e (флаг e2e-hooks ставит
 * harness/e2e-customer.sh). Модель — двойник.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const TRACKER_API = process.env.TRACKER_API ?? 'http://127.0.0.1:3456/api/v1'

async function hook(request: APIRequestContext, data: Record<string, string>): Promise<void> {
  const res = await request.post(`${CUSTOMER_URL}/api/customer-form.e2e`, { data })
  expect(res.ok(), 'тестовые сбои трекера включены (e2e-customer.sh)').toBeTruthy()
}

/** Обращение → форма вопросов → карточка сценария → «Согласую». */
async function walkToApproval(page: Page, text: string): Promise<void> {
  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await page.getByRole('radio', { name: 'Вручную в Excel' }).click({ timeout: 30_000 })
  await page.getByRole('radio', { name: 'В почте утром' }).click()
  await page.getByRole('button', { name: 'Отправить' }).last().click()
  await expect(page.getByText('Как я буду принимать работу'), 'карточка согласования').toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Согласую' }).click()
}

/** Документ БФТ справа, ссылка на заявку в чате; номер заявки. */
async function expectDocument(page: Page): Promise<number> {
  const link = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(link, 'ссылка на заявку в чате').toBeVisible({ timeout: 30_000 })
  const taskId = Number(/#(\d+)/.exec((await link.textContent()) ?? '')?.[1])
  const doc = page.frameLocator('iframe[data-customer-bft]')
  await expect(doc.getByRole('heading', { name: new RegExp(`\\[БФТ\\] zayavka-${taskId}`) }), 'документ БФТ справа').toBeVisible({ timeout: 45_000 })
  await expect(page.getByText(/не зарегистрирована|не удалось/), 'без ошибок регистрации в чате').toHaveCount(0)
  return taskId
}

async function trackerTask(request: APIRequestContext, taskId: number) {
  const login = await request.post(`${TRACKER_API}/login`, {
    data: { username: process.env.TRACKER_USER ?? 'bft-admin', password: process.env.TRACKER_PASSWORD ?? '' },
  })
  test.skip(!login.ok(), 'нет TRACKER_PASSWORD — проверку задачи в Vikunja пропускаем')
  const auth = { authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const task = (await (await request.get(`${TRACKER_API}/tasks/${taskId}`, { headers: auth })).json()) as {
    description: string; attachments: { file: { name: string } }[] | null
  }
  return { description: task.description, files: (task.attachments ?? []).map((a) => a.file.name) }
}

test.beforeEach(() => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(150_000)
})

test('токен трекера истёк — узел входит заново, путь до документа БФТ целиком', async ({ page, request }) => {
  const unique = Date.now().toString(36)
  await hook(request, { action: 'expireToken' })
  await walkToApproval(page, `Токен ${unique}: нужна утренняя выгрузка отчётов в CSV. Заказчик E2E Тестов, e2e@test.local`)
  const taskId = await expectDocument(page)

  const task = await trackerTask(request, taskId)
  expect(task.description, 'постановка сдана').toContain('HowToDemo')
  expect(task.files, 'документ БФТ в задаче').toContain(`zayavka-${taskId}-fast.html`)
})

test('трекер не ответил на первое сообщение — сдача сама заводит заявку и собирает документ', async ({ page, request }) => {
  const unique = Date.now().toString(36)
  const marker = `Сбой-${unique}`
  await hook(request, { action: 'failCreate', marker })
  await walkToApproval(page, `${marker}: нужна утренняя выгрузка отчётов в CSV. Заказчик E2E Тестов, e2e@test.local`)
  const taskId = await expectDocument(page)

  // Одна заявка: служебный пузырь «📌 Сценарий согласован» не заводит вторую.
  await expect(page.getByText(/Заявка #\d+ зарегистрирована в беклоге/), 'одна ссылка на заявку').toHaveCount(1)
  // Заявка заведена при сдаче — со всем, что было бы при обычном пути.
  const task = await trackerTask(request, taskId)
  for (const section of ['ASIS', 'TOBE', 'HowToDemo', 'согласован заказчиком']) {
    expect(task.description, `раздел «${section}» в постановке`).toContain(section)
  }
  expect(task.files, 'раскадровка согласованного сценария').toContain(`howtodemo-${taskId}.md`)
  expect(task.files, 'документ БФТ в задаче').toContain(`zayavka-${taskId}-fast.html`)
})
