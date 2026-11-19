/**
 * E2E · документы Confluence в чате (ADR-0019): «найди документ …» → поиск
 * через шлюз источников → короткий список (название, пространство, ссылка) →
 * выбор формой → страница — материал заявки (S1) и файл в задаче. Шлюз лежит —
 * честное «поиск сейчас недоступен».
 *
 * Модель — двойник (e2e/llm-double.mjs), шлюз — двойник (e2e/sources-double.mjs):
 * оба поднимает harness/e2e-customer.sh. Проверяется всё, что делает портал:
 * служба dataSources, инструменты search_confluence и attach_confluence_page,
 * материалы, вложение в задачу.
 */
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const TRACKER_API = process.env.TRACKER_API ?? 'http://127.0.0.1:3456/api/v1'
const UNIQUE = Date.now().toString(36)
const TITLE = 'Регламент заявок на ремонт оборудования'

async function send(page: import('@playwright/test').Page, message: string) {
  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type(message)
  await page.getByRole('button', { name: 'Отправить' }).click()
  const pin = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(pin).toBeVisible({ timeout: 10_000 })
  return Number(/#(\d+)/.exec((await pin.textContent()) ?? '')?.[1])
}

test('Confluence: «найди документ» → список → выбор → страница в материалах и в задаче', async ({ page, request }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужны двойники модели и шлюза: запускайте через harness/e2e-customer.sh')
  test.setTimeout(120_000)
  const taskId = await send(page, `#confluence ${UNIQUE} найди документ регламент заявок на ремонт`)

  // Короткий список: название — ссылкой на страницу, пространство.
  const link = page.getByRole('link', { name: TITLE })
  await expect(link, 'найденная страница ссылкой').toBeVisible({ timeout: 30_000 })
  await expect(link).toHaveAttribute('href', /pageId=700101/)
  await expect(page.getByText(/Сервисная служба \(SRV\)/).first(), 'пространство').toBeVisible()
  await page.screenshot({ path: 'test-results/confluence-list.png' })

  // Выбор — формой dsh (ask_user_question).
  await page.getByRole('radio', { name: TITLE }).click()
  await page.getByRole('button', { name: 'Отправить' }).last().click()
  await expect(page.getByText(/Приложила страницу к заявке как материал S1/), 'страница в материалах').toBeVisible({ timeout: 30_000 })

  // В задаче — текст страницы: PO читает то же, что модель.
  const login = await request.post(`${TRACKER_API}/login`, {
    data: { username: process.env.TRACKER_USER ?? 'bft-admin', password: process.env.TRACKER_PASSWORD ?? '' },
  })
  test.skip(!login.ok(), 'нет TRACKER_PASSWORD — проверку задачи в Vikunja пропускаем')
  const auth = { authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  let file: { id: number; file: { name: string } } | undefined
  await expect.poll(async () => {
    const task = (await (await request.get(`${TRACKER_API}/tasks/${taskId}`, { headers: auth })).json()) as { attachments: { id: number; file: { name: string } }[] | null }
    file = (task.attachments ?? []).find((a) => /^S1-confluence-.*\.md$/.test(a.file.name))
    return !!file
  }, { timeout: 15_000, message: 'страница Confluence файлом в задаче' }).toBe(true)
  const body = await (await request.get(`${TRACKER_API}/tasks/${taskId}/attachments/${file!.id}`, { headers: auth })).text()
  expect(body).toContain('Источник: https://wiki.example.test/pages/viewpage.action?pageId=700101')
  expect(body).toContain('Диспетчер назначает исполнителя в течение 2 часов')
})

test('Confluence: шлюз недоступен — ассистент честно говорит, ничего не выдумывает', async ({ page }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужны двойники модели и шлюза: запускайте через harness/e2e-customer.sh')
  test.setTimeout(90_000)
  await send(page, `#confluence ${UNIQUE} найди документ недоступный регламент`)
  await expect(page.getByText(/Поиск по Confluence сейчас недоступен/), 'честный ответ').toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: TITLE }), 'без выдуманных страниц').toHaveCount(0)
})
