/**
 * Живой E2E «Ответы формы → входящее событие в БФТ» (ADR-0027) — HowToDemo владельца,
 * на ТЕСТОВОЙ заявке с готовым полным БФТ (LIVE_SESSION) и циклом в Temporal:
 *
 *  1–2. форма по ссылке (нет ссылки — «Сформировать форму»), ответ и «не знаю», подпись;
 *  3. «Отправить ответы» — в форме плашка «Ответы отправлены» (записано в заявку);
 *  4. на открытой заранее странице документа без перезагрузки — «Форма заполнена»;
 *  5. в сайдбаре «Входящие»: от кого, время, сколько ответов;
 *  6. по клику — ответы (вопрос → ответ, «не знаю / не ко мне»);
 *  7. статус пересборки из цикла: ждёт паузу → собирается → готово / ошибка.
 *
 * Скриншоты — test-results/step-*.png. Запуск — harness/e2e-form-inbox.sh на сервере.
 */
import { expect, test } from '@playwright/test'

const PORTAL = (process.env.PORTAL_URL ?? 'http://127.0.0.1:3082').replace(/\/$/, '')
const SESSION = process.env.LIVE_SESSION ?? ''
const OUT = 'test-results'
const AUTHOR = `Мария Тестова (E2E ${Date.now().toString(36)})`
const ANSWER = 'Лимит — три промокода в месяц на клиента (E2E)'

test('ответы формы → входящее событие на странице БФТ и статус пересборки', async ({ browser }) => {
  test.setTimeout(40 * 60_000)
  expect(SESSION, 'LIVE_SESSION — тестовая заявка с готовым полным БФТ').not.toBe('')
  const doc = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage()
  doc.on('dialog', (d) => void d.accept())
  await doc.goto(`${PORTAL}/api/customer-form.bftFast?session=${encodeURIComponent(SESSION)}`)
  const side = doc.locator('#csSidebar')
  if (!(await side.isVisible())) await doc.locator('#csSideToggle').click()
  await expect(side.getByRole('heading', { name: /Вопросы/ })).toBeVisible()
  if (await side.locator('#csCreate').isVisible()) {
    await side.locator('#csCreate').click()
    await expect(side.locator('#csFormUrl')).toBeVisible({ timeout: 30_000 })
  }
  const link = await side.locator('#csFormUrl').inputValue()
  // Ссылка — публичный адрес за nginx; в обход Authentik открываем тот же ключ маршрутом портала.
  const id = new URL(link).searchParams.get('id')!
  const before = await doc.locator('#csInbox .ib').count()

  // 1–2. Форма
  const form = await (await browser.newContext({ viewport: { width: 1100, height: 1000 } })).newPage()
  await form.goto(`${PORTAL}/api/customer-form.form?id=${id}`)
  await form.locator('#author').fill(AUTHOR)
  const cards = form.locator('.q[data-qid]')
  expect(await cards.count(), 'в форме есть вопросы').toBeGreaterThan(1)
  await cards.nth(0).locator('textarea').fill(ANSWER)
  const unk = cards.nth(1).locator('input.unk')
  if (await unk.isChecked()) await cards.nth(1).locator('textarea').fill('Уточню у команды (E2E)')
  else await unk.check()
  const question0 = (await cards.nth(0).locator('.q-text').innerText()).replace(/^\d+\.\s*/, '')

  // 3. Отправить — плашка «Ответы отправлены»
  await form.locator('#send').click()
  const sent = form.locator('#sent')
  await expect(sent).toBeVisible({ timeout: 20_000 })
  await expect(sent).toContainText('Ответы отправлены')
  await expect(sent).toContainText('ответов: 2')
  await expect(sent).toContainText('записана в заявку')
  await sent.scrollIntoViewIfNeeded()
  await form.screenshot({ path: `${OUT}/step-3-form-sent.png` })

  // 4. Страница документа — без перезагрузки: оповещение «Форма заполнена»
  const toast = doc.locator('.cs-toast')
  await expect(toast).toBeVisible({ timeout: 20_000 })
  await expect(toast).toContainText('Форма заполнена')
  await expect(toast).toContainText(AUTHOR)
  await doc.screenshot({ path: `${OUT}/step-4-doc-toast.png` })

  // 5. Входящее событие в сайдбаре
  const entry = doc.locator('#csInbox .ib').first()
  expect(await doc.locator('#csInbox .ib').count()).toBe(before + 1)
  await expect(entry).toContainText('Форма заполнена')
  await expect(entry).toContainText(`От: ${AUTHOR}`)
  await expect(entry).toContainText('ответов 2 (не знают — 1)')
  await expect(entry.locator('.ib-st')).toContainText('Ждёт паузу')
  await doc.screenshot({ path: `${OUT}/step-5-inbox.png` })

  // 6. По клику — ответы
  await toast.getByRole('button', { name: 'Открыть' }).click()
  await expect(entry.locator('.ib-ans')).toBeVisible()
  await expect(entry.locator('.ib-ans')).toContainText(question0.slice(0, 40))
  await expect(entry.locator('.ib-ans')).toContainText(ANSWER)
  await expect(entry.locator('.ib-ans .unk')).toContainText('не знаю / не ко мне')
  await entry.screenshot({ path: `${OUT}/step-6-answers.png` })

  // 7. Статус пересборки из цикла: ждёт паузу → собирается → готово / ошибка
  const st = entry.locator('.ib-st')
  await doc.screenshot({ path: `${OUT}/step-7a-waiting.png` })
  await expect(st).toHaveClass(/building|ready|failed|skipped/, { timeout: 10 * 60_000 })
  await doc.screenshot({ path: `${OUT}/step-7b-${(await st.getAttribute('class'))!.split(' ').pop()}.png` })
  await expect(st).toHaveClass(/ready|failed|skipped/, { timeout: 30 * 60_000 })
  await doc.screenshot({ path: `${OUT}/step-7c-${(await st.getAttribute('class'))!.split(' ').pop()}.png` })
  console.log(`итог пересборки: ${await st.innerText()}`)
})
