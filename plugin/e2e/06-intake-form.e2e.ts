/**
 * Плейбук 6 — форма сбора инициативы: настройка, «+», ширина панели, отправка, «Готово»,
 * «Добавить» с доски, сброс ссылки.
 *
 * Форма — локальный сервер из e2e/support/form-server.ts, а не настоящая Google Forms: прогон
 * не зависит от сети, а отправку можно проверить по факту (сервер видит POST). Документ
 * настроек общий с PO: значения снимаются до прогона и возвращаются дословно в `afterAll`.
 */
import { expect, test, type CardValues } from './support/types.ts'
import { startFormServer, type FormServer } from './support/form-server.ts'
import {
  CARD_LABELS, DEMO_SETTINGS, applyCard, closeSettings, openHarness, openPanel, openSettingsCard, panel,
  readCard, requireHarness, restoreCard, shot, writeBackup,
} from './support/harness.ts'

const SCENARIO = '06-intake-form'
const FRAME = 'iframe[title="Форма сбора требований"]'

test.describe.configure({ mode: 'serial' })

let backup: CardValues | undefined
let server: FormServer | undefined
let url = ''

test.beforeAll(async ({ browser }) => {
  url = requireHarness()
  server = await startFormServer()
  const page = await browser.newPage()
  await openHarness(page, url)
  const card = await openSettingsCard(page)
  backup = await readCard(card)
  writeBackup(SCENARIO, backup)
  // Исходное состояние сценария: таблица и промт — демонстрационные, ссылки на форму ещё нет
  // (тогда «+» на первом снимке погашена, как у PO до настройки). Живые значения PO на
  // снимках стоять не должны.
  await applyCard(card, {
    sheetUrl: DEMO_SETTINGS.sheetUrl,
    syncPrompt: DEMO_SETTINGS.syncPrompt,
    ...backup.formUrl.overridden ? { formUrl: { reset: true } } : {},
  })
  await closeSettings(page)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  await server?.close()
  if (backup === undefined) return
  const page = await browser.newPage()
  await openHarness(page, url)
  await restoreCard(page, backup)
  await page.close()
})

test('форма сбора: настройка, «+», ширина, отправка, «Готово», доска, сброс', async ({ page }) => {
  if (server === undefined) throw new Error('форма не поднялась')
  await openHarness(page, url)

  // 0. Без ссылки «+» погашена, подсказка говорит, где её задать.
  const aside0 = await openPanel(page)
  const plus0 = aside0.getByRole('button', { name: 'Новая инициатива' })
  await expect(plus0).toBeDisabled()
  await expect(plus0).toHaveAttribute('title', /настройках/)
  await shot(page, SCENARIO, '00-plus-disabled', plus0)
  await aside0.getByRole('button', { name: 'Закрыть', exact: true }).click()

  // 1. Ссылка на форму в настройках.
  let card = await openSettingsCard(page)
  await card.getByLabel(CARD_LABELS.formUrl).fill(server.url)
  const save = card.getByRole('button', { name: 'Сохранить' })
  await expect(save).toBeEnabled()
  await shot(page, SCENARIO, '01-settings', save)
  await applyCard(card, {})
  await closeSettings(page)

  // 2. «+» в шапке панели активна.
  const aside = await openPanel(page)
  const plus = aside.getByRole('button', { name: 'Новая инициатива' })
  await expect(plus).toBeEnabled()
  await shot(page, SCENARIO, '02-plus', plus)
  await plus.click()
  const form = page.getByRole('complementary', { name: 'Новая инициатива' })
  await expect(form).toBeVisible()
  await expect(panel(page)).toBeHidden()
  const frame = page.frameLocator(FRAME)
  await expect(frame.getByRole('heading', { name: 'Заявка на инициативу' })).toBeVisible()
  // Плашки «не открылась» нет: форма пришла.
  await expect(form.getByText('Форма не открылась')).toHaveCount(0)
  for (const name of ['Открыть в браузере', 'Готово']) {
    await expect(form.getByRole('button', { name })).toBeVisible()
  }
  await shot(page, SCENARIO, '03-form')

  // 3. Ширина: тянем левую кромку, значение остаётся в localStorage.
  const before = await form.boundingBox()
  if (before === null) throw new Error('панель без геометрии')
  const grip = form.getByRole('separator', { name: 'Изменить ширину панели' })
  const gripBox = await grip.boundingBox()
  if (gripBox === null) throw new Error('ручка без геометрии')
  const startX = gripBox.x + gripBox.width / 2
  const y = gripBox.y + gripBox.height / 2
  await page.mouse.move(startX, y)
  await page.mouse.down()
  await page.mouse.move(startX - 220, y, { steps: 12 })
  await page.mouse.up()
  const after = await form.boundingBox()
  if (after === null) throw new Error('панель без геометрии')
  expect(after.width).toBeGreaterThan(before.width + 150)
  const stored = await page.evaluate(() => window.localStorage.getItem('bft-panel-width'))
  expect(Number(stored)).toBeGreaterThan(before.width + 150)
  await shot(page, SCENARIO, '04-resized', grip)

  // 4. Заполнить и отправить внутри айфрейма: сервер получает POST, форма показывает «Ответ записан».
  await frame.getByLabel('Название инициативы').fill('Возврат билетов в личном кабинете')
  await frame.getByLabel('Заказчик').fill('Служба поддержки')
  await frame.getByLabel('Проблема, которую решаем').fill('Возвраты идут через оператора, очередь на три дня')
  await frame.getByLabel('Ожидаемый результат').fill('Покупатель оформляет возврат сам за минуту')
  await frame.getByRole('button', { name: 'Отправить' }).click()
  await expect(frame.getByRole('heading', { name: 'Ответ записан' })).toBeVisible()
  expect(server.submissions).toHaveLength(1)
  expect(server.submissions[0]?.title).toBe('Возврат билетов в личном кабинете')
  await shot(page, SCENARIO, '05-submitted')

  // 5. «Готово» → список.
  await form.getByRole('button', { name: 'Готово' }).click()
  await expect(panel(page)).toBeVisible()
  await expect(aside.locator('.bft-item').first()).toBeVisible()
  await shot(page, SCENARIO, '06-done')

  // Ширина пережила перезагрузку страницы — и для списка тоже.
  await page.reload()
  await openPanel(page)
  const reloaded = await panel(page).boundingBox()
  if (reloaded === null) throw new Error('панель без геометрии')
  expect(Math.abs(reloaded.width - after.width)).toBeLessThan(3)

  // 6. С доски: «Добавить» → та же форма на всю страницу, «Назад» → доска.
  await panel(page).getByRole('button', { name: 'Открыть доску требований' }).click()
  const board = page.locator('.bft-detail-page').filter({ hasText: 'Доска с требованиями' })
  await expect(board).toBeVisible()
  await board.getByRole('button', { name: 'Добавить' }).click()
  const pageForm = page.locator('.bft-detail-page').filter({ hasText: 'Новая инициатива' })
  await expect(pageForm).toBeVisible()
  await expect(page.frameLocator(FRAME).getByRole('heading', { name: 'Заявка на инициативу' })).toBeVisible()
  await shot(page, SCENARIO, '07-from-board', pageForm.getByRole('button', { name: 'Готово' }))
  await pageForm.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(board).toBeVisible()
  await board.getByRole('button', { name: 'Назад', exact: true }).click()
  await panel(page).getByRole('button', { name: 'Закрыть', exact: true }).click()

  // 7. Сброс ссылки → «+» гаснет с подсказкой, где её задать.
  card = await openSettingsCard(page)
  const formField = card.locator('.bft-field').filter({ hasText: CARD_LABELS.formUrl })
  await expect(formField.getByText('переопределено')).toBeVisible()
  await formField.getByRole('button', { name: 'сбросить' }).click()
  await shot(page, SCENARIO, '08-reset', card.getByRole('button', { name: 'Сохранить' }))
  await applyCard(card, {})
  await closeSettings(page)
  await openPanel(page)
  await expect(panel(page).getByRole('button', { name: 'Новая инициатива' })).toBeDisabled()
  await panel(page).getByRole('button', { name: 'Закрыть', exact: true }).click()
})
