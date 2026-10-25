/**
 * Живой прогон (не тест): длинная запись встречи → реальная модель портала.
 * Показывает, что форма приходит, не дожидаясь расшифровки, а черновик — после
 * ответа; печатает вопросы формы и раскадровку из правой панели.
 *   MEETING=test-results/запись.m4a node e2e/live-meeting.mjs   (в контейнере Playwright, --network host)
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { chromium } from '@playwright/test'

const file = process.env.MEETING ?? 'e2e/fixtures/meeting.m4a'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080')
const composer = page.locator("[data-composer-input][contenteditable='true']").first()
await composer.waitFor({ timeout: 30_000 })
await page.getByRole('button', { name: 'Прикрепить файлы' }).click()
const chooser = page.waitForEvent('filechooser')
await page.getByRole('option', { name: /^Файл/ }).click()
await (await chooser).setFiles({ name: basename(file), mimeType: 'audio/mp4', buffer: readFileSync(file) })
await composer.click()
await page.keyboard.type('Постановка задачи из созвона — всё в записи. Юрий Юдин, y.yudin@example.com')
const t0 = Date.now()
const sec = () => `${((Date.now() - t0) / 1000).toFixed(1)} с`
await page.getByRole('button', { name: 'Отправить' }).click()

const card = page.getByText('Как я буду принимать работу')
const form = page.getByRole('button', { name: /^(Отправить|Дальше)$/ }).last()
for (let round = 0; round < 4; round++) {
  const which = await Promise.race([
    card.waitFor({ timeout: 300_000 }).then(() => 'card'),
    page.locator('textarea, [role="radiogroup"]').filter({ visible: true }).first().waitFor({ timeout: 300_000 }).then(() => 'form'),
  ])
  if (which === 'card') break
  const q = await page.locator('h2').filter({ visible: true }).last().innerText().catch(() => '?')
  console.log(`▸ форма через ${sec()}: ${q}`)
  const custom = page.getByPlaceholder('Свой ответ').filter({ visible: true }).first()
  if (await custom.count()) await custom.fill(/назван/i.test(q) ? 'Страховка билетов в корзине Ticketland' : 'Юрий Юдин, y.yudin@example.com')
  else await page.getByRole('radio').first().click()
  await form.click()
  await page.waitForTimeout(800)
}
await card.waitFor({ timeout: 300_000 })
console.log(`▸ карточка через ${sec()}`)
const panel = page.frameLocator('iframe[data-customer-acceptance]')
await panel.locator('#flow svg').waitFor({ timeout: 30_000 }).catch(() => console.log('▸ Mermaid не отрисован'))
await panel.locator('details.story > summary').click()
await page.waitForTimeout(800)
await page.screenshot({ path: 'test-results/live-meeting.png' })
console.log('──── панель ────')
console.log((await panel.locator('main').innerText()).slice(0, 3500))
console.log('──── макеты ────')
console.log((await panel.locator('.step svg').evaluateAll((svgs) => svgs.map((s) => [...s.querySelectorAll('text')].map((t) => t.textContent).join(' | ')))).join('\n'))
await browser.close()
