/**
 * Живой прогон (не тест): материалы → реальная модель портала. Печатает
 * время до карточки и текст черновика, кладёт скриншот в test-results/.
 *   node e2e/live-materials.mjs   (в контейнере Playwright, --network host)
 */
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080')
const composer = page.locator("[data-composer-input][contenteditable='true']").first()
await composer.waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Прикрепить файлы' }).click()
const chooser = page.waitForEvent('filechooser')
await page.getByRole('option', { name: /^Файл/ }).click()
const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url))
await (await chooser).setFiles([
  { name: 'Новая запись 12.m4a', mimeType: 'audio/mp4', buffer: fx('memo.m4a') },
  { name: 'Бриф отпуска.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fx('brief.docx') },
])
await composer.click()
await page.keyboard.type('Инициатива с планёрки — всё в записи и брифе. Ирина Петрова, i.petrova@example.com')
const t0 = Date.now()
await page.getByRole('button', { name: 'Отправить' }).click()
await page.getByText('Как я буду принимать работу').waitFor({ timeout: 180_000 })
console.log(`▸ карточка через ${((Date.now() - t0) / 1000).toFixed(1)} с`)
await page.waitForTimeout(1500)
await page.screenshot({ path: 'test-results/live-materials.png' })
const text = await page.locator('body').innerText()
console.log(text.slice(text.indexOf('Инициатива с планёрки'), text.indexOf('Инициатива с планёрки') + 1200))
console.log('──── панель ────')
const i = text.lastIndexOf('Как я понял задачу и как')
console.log(text.slice(i, i + 3000))
await browser.close()
