/**
 * Живой E2E формы вопросов по БФТ (ADR-0018) — HowToDemo владельца по шагам,
 * на заявке с готовым полным БФТ (LIVE_SESSION) и настоящей моделью портала:
 *
 *  2. «Что нужно для согласования»: заказчику / командам; PO добавляет свой вопрос;
 *  3. внизу БФТ — «Сформировать форму» → ссылка;
 *  5–6. форма по ссылке: сначала вопросы заказчику, потом команды; ответ и
 *     «не знаю» сохраняются и видны при повторном открытии;
 *  предпросмотр БФТ из формы — только чтение, вопросы ведут в форму;
 *  7. ответы — в файле заявки; 8. через паузу БФТ пересобирается и закрывает
 *  отвеченную пометку, форма получает новую версию; 9. пометки ведут в форму;
 *  отзыв ссылки — старая отвечает «Ссылка отозвана».
 *
 * Запуск — harness/e2e-bft-form.sh на сервере. Пересборка — полный прогон
 * модели (5–15 минут).
 */
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const PORTAL = (process.env.PORTAL_URL ?? 'http://127.0.0.1:3082').replace(/\/$/, '')
const SESSION = process.env.LIVE_SESSION ?? ''
const OUT = 'test-results'
const MY_QUESTION = `Нужна ли выгрузка отчёта в Excel (E2E ${Date.now().toString(36)})`

test('форма вопросов: правка PO → ссылка → ответы → предпросмотр → пересборка БФТ → отзыв', async ({ page, request, context }) => {
  test.setTimeout(40 * 60_000)
  expect(SESSION, 'LIVE_SESSION — сессия заявки с готовым полным БФТ').not.toBe('')
  const started = Date.now()
  const sec = () => `${Math.round((Date.now() - started) / 1000)} с`
  page.on('dialog', (d) => void d.accept())
  const deepUrl = `${PORTAL}/api/customer-form.bftFast?session=${encodeURIComponent(SESSION)}`
  const status = async () => ((await (await request.get(`${PORTAL}/api/customer-form.bftDeepStatus?session=${encodeURIComponent(SESSION)}`)).json()) as { stage: string; startedAt: string | null })

  expect((await status()).stage, 'полный БФТ готов').toBe('ready')
  await page.goto(deepUrl)
  // Управление формой — в боковой панели (ADR-0026).
  const block = page.locator('#csSidebar')
  if (!(await block.isVisible())) await page.locator('#csSideToggle').click()
  await expect(block.getByRole('heading', { name: /Вопросы/ })).toBeVisible()
  await expect(block.getByText(/^Заказчику · \d+/)).toBeVisible()
  const before = await block.locator('li.sb-q').count()
  console.log(`▸ вопросов на странице БФТ: ${before} (${sec()})`)

  // Шаг 2: свой вопрос PO.
  await block.locator('#csAddQ input[name=text]').fill(MY_QUESTION)
  await block.locator('#csAddQ button').click()
  await expect(page.locator('#csSidebar li.sb-q', { hasText: MY_QUESTION })).toBeVisible({ timeout: 15_000 })

  // Шаг 3: «Сформировать форму» внизу боковой панели.
  const share = page.locator('#csSidebar')
  if (await share.locator('#csCreate').count()) await share.locator('#csCreate').click()
  const linkInput = share.locator('#csFormUrl')
  await expect(linkInput).toBeVisible({ timeout: 15_000 })
  const link = await linkInput.inputValue()
  const id = new URL(link).searchParams.get('id') ?? ''
  expect(id, 'ключ формы — UUID').toMatch(/^[0-9a-f-]{36}$/)
  console.log(`▸ ссылка формы выдана (${sec()})`)
  // Шаг 9: пометки [УТОЧНИТЬ] в документе ведут в форму.
  expect(await page.locator('a.unc-link').count(), 'пометки — ссылками на форму').toBeGreaterThan(0)
  await page.screenshot({ path: `${OUT}/form-1-deep.png` })

  // Шаги 5–6: форма по ссылке (как её откроет заказчик — без входа в портал).
  const formUrl = `${PORTAL}/api/customer-form.form?id=${id}`
  const form = await context.newPage()
  const res = await form.goto(formUrl)
  expect(res?.headers()['x-robots-tag'], 'noindex').toContain('noindex')
  await expect(form.getByRole('heading', { name: 'Вопросы заказчику' })).toBeVisible()
  const sides = await form.locator('.side h2').allInnerTexts()
  expect(sides, 'сначала заказчику, потом командам').toEqual(['Вопросы заказчику', 'Уточнения для команд'])
  const mine = form.locator('.q', { hasText: MY_QUESTION })
  await expect(mine, 'вопрос PO — в форме').toBeVisible()
  await mine.locator('textarea').fill('Да, нужна: Excel и CSV')
  const teamQid = await form.locator('.side.teams ~ .q').first().getAttribute('data-qid').catch(() => null)
  if (teamQid) await form.locator(`#q-${teamQid} input.unk`).check()
  await form.locator('#author').fill('E2E Тестов')
  await form.getByRole('button', { name: 'Отправить ответы' }).click()
  await expect(form.locator('#status')).toContainText('Сохранено ответов', { timeout: 15_000 })
  const submittedAt = new Date().toISOString()
  await form.screenshot({ path: `${OUT}/form-2-answered.png`, fullPage: true })
  await form.reload()
  await expect(form.locator('.q', { hasText: MY_QUESTION }).locator('textarea'), 'ответ сохранён').toHaveValue('Да, нужна: Excel и CSV')
  if (teamQid) await expect(form.locator(`#q-${teamQid} input.unk`), '«не знаю» сохранено').toBeChecked()
  console.log(`▸ ответы сохранены (${sec()})`)

  // Предпросмотр из формы: только чтение, вопросы ведут обратно в форму.
  const previewHref = await form.getByRole('link', { name: /Открыть БФТ целиком/ }).getAttribute('href')
  const preview = await context.newPage()
  await preview.goto(new URL(previewHref ?? '', formUrl).toString())
  await expect(preview.getByText(/Предпросмотр БФТ · только чтение/)).toBeVisible()
  await expect(preview.getByText('Скачать:'), 'без выгрузки').toHaveCount(0)
  await expect(preview.locator('#customer-questions a', { hasText: MY_QUESTION })).toBeVisible()
  await preview.screenshot({ path: `${OUT}/form-3-preview.png` })

  // Шаг 8: пауза после ответа (FORM_REBUILD_MS) → пересборка → новая версия формы.
  let stage = 'ready'
  let rebuilt = false
  for (let i = 0; i < 6 * 30 && !rebuilt; i++) {
    await page.waitForTimeout(10_000)
    const s = await status()
    stage = s.stage
    if (s.startedAt && s.startedAt > submittedAt && stage !== 'building') rebuilt = true
    if (i % 6 === 5) console.log(`  … БФТ: ${stage}${s.startedAt && s.startedAt > submittedAt ? ' (пересборка по ответам)' : ''} (${sec()})`)
  }
  expect(rebuilt, 'БФТ пересобран по ответам').toBe(true)
  expect(stage, 'пересобранный БФТ готов').toBe('ready')
  const md = await (await request.get(`${PORTAL}/api/customer-form.bftDownload?session=${encodeURIComponent(SESSION)}&doc=deep&format=md`)).text()
  writeFileSync(`${OUT}/form-deep.md`, md)
  await form.reload()
  const meta = await form.locator('.meta').innerText()
  console.log(`▸ форма после пересборки: ${meta} (${sec()})`)
  expect(meta, 'новая версия формы').not.toMatch(/Версия формы 1 /)
  expect(md, 'ответ встроен в БФТ').toMatch(/ответ в форме согласования/i)

  // Отзыв: старая ссылка больше не открывается.
  await page.goto(deepUrl)
  if (!(await page.locator('#csSidebar').isVisible())) await page.locator('#csSideToggle').click()
  await page.locator('#csRevoke').click()
  await expect(page.locator('#csCreate')).toBeVisible({ timeout: 15_000 })
  const gone = await request.get(formUrl)
  expect(gone.status(), 'отозванная ссылка').toBe(410)
  expect(await gone.text()).toContain('Ссылка отозвана')
  writeFileSync(`${OUT}/form-run.json`, JSON.stringify({ session: SESSION, id, meta, seconds: Math.round((Date.now() - started) / 1000) }, null, 2))
})
