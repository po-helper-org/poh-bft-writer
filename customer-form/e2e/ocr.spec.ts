/**
 * E2E · сканы заказчика (ADR-0008): служебная записка PDF-сканом без
 * текстового слоя + фото документа (JPG) → context-ingest распознаёт их OCR
 * (Tesseract rus+eng) → черновик по материалам → «Согласую» → в задаче лежат
 * распознанные тексты.
 *
 * Модель — двойник (e2e/llm-double.mjs): он продолжает сценарий, только если в
 * результате read_customer_materials есть «отдел кадров», — а он есть только в
 * картинках скана и фото: так проверяется настоящий OCR.
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const TRACKER_API = process.env.TRACKER_API ?? 'http://127.0.0.1:3456/api/v1'
const UNIQUE = Date.now().toString(36)
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

test('сканы: PDF без текста + фото → OCR → черновик → распознанный текст в задаче', async ({ page, request }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(120_000)

  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })

  // Скан служебной записки и её фото — штатным «+» → «Файл».
  await page.getByRole('button', { name: 'Прикрепить файлы' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('option', { name: /^Файл/ }).click()
  await (await chooser).setFiles([
    { name: `scan-${UNIQUE}.pdf`, mimeType: 'application/pdf', buffer: fixture('scan.pdf') },
    { name: `photo-${UNIQUE}.jpg`, mimeType: 'image/jpeg', buffer: fixture('photo.jpg') },
  ])
  await expect(page.getByText(`scan-${UNIQUE}.pdf`).first()).toBeVisible()

  await composer.click()
  await page.keyboard.type(`Сканы ${UNIQUE}: служебная записка во вложении. Ирина Петрова, i.petrova@example.com`)
  await page.getByRole('button', { name: 'Отправить' }).click()

  // Ссылка на заявку и обещание разобрать материалы — сразу.
  const pin = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(pin).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText(/Изучаю материалы: scan-/).first()).toBeVisible()
  const taskId = Number(/#(\d+)/.exec((await pin.textContent()) ?? '')?.[1])

  // Без единого вопроса — черновик по материалам на согласование.
  const sentAt = Date.now()
  await expect(page.getByText('Как я буду принимать работу'), 'карточка согласования').toBeVisible({ timeout: 60_000 })
  console.log(`▸ черновик по сканам через ${Date.now() - sentAt} мс`)
  // Черновик — страницей в правой панели (UserFlow + раскадровка, ADR-0007 rev10).
  const panel = page.frameLocator('iframe[data-customer-acceptance]')
  await expect(panel.getByRole('heading', { name: 'Как я понял задачу' }), 'раздел черновика в панели').toBeVisible({ timeout: 15_000 })
  await expect(panel.getByRole('heading', { name: 'Не нашёл в материалах или есть противоречие' })).toBeVisible()
  await page.screenshot({ path: 'test-results/ocr-draft.png' })
  await page.getByRole('button', { name: 'Согласую' }).click()

  await expect(page.getByText(/ИТОГ по заявке/)).toBeVisible({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type('подтверждаю')
  await page.keyboard.press('Enter')
  await expect(page.getByText(new RegExp(`Отслеживание статуса: \\S+/tasks/${taskId}`))).toBeVisible({ timeout: 30_000 })

  // В задаче: распознанный текст скана и фото — PO читает то же, что модель.
  const login = await request.post(`${TRACKER_API}/login`, {
    data: { username: process.env.TRACKER_USER ?? 'bft-admin', password: process.env.TRACKER_PASSWORD ?? '' },
  })
  test.skip(!login.ok(), 'нет TRACKER_PASSWORD — проверку задачи в Vikunja пропускаем')
  const auth = { authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const task = (await (await request.get(`${TRACKER_API}/tasks/${taskId}`, { headers: auth })).json()) as {
    attachments: { id: number; file: { name: string } }[] | null
  }
  const files = (task.attachments ?? []).map((a) => a.file.name)
  for (const source of ['scan', 'photo']) {
    const text = (task.attachments ?? []).find((a) => new RegExp(`^S\\d+-${source}-.*\\.md$`).test(a.file.name))
    expect(text, `распознанный ${source} в задаче (есть: ${files.join(', ')})`).toBeTruthy()
    const body = await (await request.get(`${TRACKER_API}/tasks/${taskId}/attachments/${text!.id}`, { headers: auth })).text()
    expect(body, `OCR ${source}`).toMatch(/Битрикс24/)
    expect(body, `OCR ${source}`).toMatch(/1С:ЗУП/)
  }
})
