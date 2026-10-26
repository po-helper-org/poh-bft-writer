/**
 * E2E · материалы заказчика (rev8): диктофон iPhone (m4a) + бриф (docx) →
 * портал расшифровывает и читает их сам → ассистент сразу показывает черновик
 * «Как я понял задачу» с раскадровкой приёмки → «Согласую» → ИТОГ → задача,
 * в которой лежат расшифровка и текст брифа.
 *
 * Модель — двойник (e2e/llm-double.mjs): он продолжает сценарий, только если в
 * результате read_customer_materials есть расшифровка голоса, — так проверяется
 * настоящий разбор (context-ingest: ffmpeg + GigaAM, MarkItDown).
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const TRACKER_API = process.env.TRACKER_API ?? 'http://127.0.0.1:3456/api/v1'
const UNIQUE = Date.now().toString(36)
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

test('материалы: m4a + docx → черновик по материалам → согласование → расшифровка в задаче', async ({ page, request }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(120_000)

  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })

  // Голосовая заметка с диктофона и бриф — штатным «+» → «Файл».
  await page.getByRole('button', { name: 'Прикрепить файлы' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('option', { name: /^Файл/ }).click()
  await (await chooser).setFiles([
    { name: `memo-${UNIQUE}.m4a`, mimeType: 'audio/mp4', buffer: fixture('memo.m4a') },
    { name: `brief-${UNIQUE}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fixture('brief.docx') },
  ])
  await expect(page.getByText(`memo-${UNIQUE}.m4a`).first()).toBeVisible()

  await composer.click()
  await page.keyboard.type(`Материалы ${UNIQUE}: инициатива по отпускам. Ирина Петрова, i.petrova@example.com`)
  await page.getByRole('button', { name: 'Отправить' }).click()

  // Ссылка на заявку и обещание разобрать материалы — сразу.
  const pin = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(pin).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/Изучаю материалы: memo-/).first()).toBeVisible()
  const taskId = Number(/#(\d+)/.exec((await pin.textContent()) ?? '')?.[1])

  // Без единого вопроса — черновик по материалам на согласование.
  const sentAt = Date.now()
  await expect(page.getByText('Как я буду принимать работу'), 'карточка согласования').toBeVisible({ timeout: 60_000 })
  console.log(`▸ черновик по материалам через ${Date.now() - sentAt} мс`)
  // Черновик — страницей в правой панели (UserFlow + раскадровка, ADR-0007 rev10).
  const panel = page.frameLocator('iframe[data-customer-acceptance]')
  await expect(panel.getByRole('heading', { name: 'Как я понял задачу' }), 'раздел черновика в панели').toBeVisible({ timeout: 15_000 })
  await expect(panel.getByRole('heading', { name: 'Не нашёл в материалах или есть противоречие' })).toBeVisible()
  await page.screenshot({ path: 'test-results/materials-draft.png' })
  await page.getByRole('button', { name: 'Согласую' }).click()

  await expect(page.getByText(/ИТОГ по заявке/)).toBeVisible({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type('подтверждаю')
  await page.keyboard.press('Enter')
  await expect(page.getByText(new RegExp(`Отслеживание статуса: \\S+/tasks/${taskId}`))).toBeVisible({ timeout: 30_000 })

  // В задаче: исходники, расшифровка голоса и текст брифа — PO читает то же, что модель.
  const login = await request.post(`${TRACKER_API}/login`, {
    data: { username: process.env.TRACKER_USER ?? 'bft-admin', password: process.env.TRACKER_PASSWORD ?? '' },
  })
  test.skip(!login.ok(), 'нет TRACKER_PASSWORD — проверку задачи в Vikunja пропускаем')
  const auth = { authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const task = (await (await request.get(`${TRACKER_API}/tasks/${taskId}`, { headers: auth })).json()) as {
    attachments: { id: number; file: { name: string } }[] | null
  }
  const files = (task.attachments ?? []).map((a) => a.file.name)
  expect(files, 'исходная запись').toContain(`memo-${UNIQUE}.m4a`)
  const transcript = (task.attachments ?? []).find((a) => /^S\d+-memo-.*\.md$/.test(a.file.name))
  expect(transcript, `расшифровка в задаче (есть: ${files.join(', ')})`).toBeTruthy()
  expect(files.some((f) => /^S\d+-brief-.*\.md$/.test(f)), 'текст брифа в задаче').toBeTruthy()
  const body = await (await request.get(`${TRACKER_API}/tasks/${taskId}/attachments/${transcript!.id}`, { headers: auth })).text()
  expect(body, 'расшифровка содержит речь').toMatch(/отдел\S* кадров/i)

  // Страница сценария приёмки — .html в задаче: предложенная версия и согласованная.
  expect(files, 'сценарий приёмки страницей').toContain(`scenarij-priyomki-${taskId}-v1.html`)
  const agreed = (task.attachments ?? []).find((a) => a.file.name === `scenarij-priyomki-${taskId}-v1-soglasovan.html`)
  expect(agreed, `согласованный сценарий в задаче (есть: ${files.join(', ')})`).toBeTruthy()
  const page2 = await (await request.get(`${TRACKER_API}/tasks/${taskId}/attachments/${agreed!.id}`, { headers: auth })).text()
  expect(page2).toContain('<!doctype html>')
  expect(page2, 'отметка согласования').toContain('class="ok">согласован')
  expect(page2, 'UserFlow').toContain('flowchart')
})
