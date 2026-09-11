/**
 * Плейбук 5 — синхронизация с таблицей: настройка таблицы и промта, «Обновить».
 *
 * Пишет в общий с PO документ настроек, поэтому первым делом снимает его значения и в
 * `afterAll` возвращает дословно (см. e2e/support/harness.ts, почему не «сбросить»).
 */
import { expect, test, type CardValues } from './support/types.ts'
import {
  CARD_LABELS, DEMO_SETTINGS, applyCard, clearComposer, closeSettings, composer, openHarness, openPanel,
  openSettingsCard, readCard, requireHarness, restoreCard, shot, writeBackup,
} from './support/harness.ts'

const SCENARIO = '05-sync'
const SHEET = DEMO_SETTINGS.sheetUrl

test.describe.configure({ mode: 'serial' })

let backup: CardValues | undefined
let url = ''

test.beforeAll(async ({ browser }) => {
  url = requireHarness()
  const page = await browser.newPage()
  await openHarness(page, url)
  const card = await openSettingsCard(page)
  backup = await readCard(card)
  writeBackup(SCENARIO, backup)
  // Исходное состояние сценария: форма — демонстрационная, таблица и промт ещё не настроены.
  // Живые значения PO на снимках стоять не должны, а «до настройки» — честная точка старта.
  await applyCard(card, {
    formUrl: DEMO_SETTINGS.formUrl,
    ...backup.sheetUrl.overridden ? { sheetUrl: { reset: true } } : {},
    ...backup.syncPrompt.overridden ? { syncPrompt: { reset: true } } : {},
  })
  await closeSettings(page)
  await page.close()
})

test.afterAll(async ({ browser }) => {
  if (backup === undefined) return
  const page = await browser.newPage()
  await openHarness(page, url)
  await restoreCard(page, backup)
  await page.close()
})

test('синхронизация: таблица и промт в настройках, «Обновить» кладёт черновик', async ({ page }) => {
  await openHarness(page, url)

  // 1. Настройки → Плагины → «Требования»: таблица и промт.
  let card = await openSettingsCard(page)
  await shot(page, SCENARIO, '01-settings-card', card.getByLabel(CARD_LABELS.sheetUrl))
  await card.getByLabel(CARD_LABELS.formUrl).fill(DEMO_SETTINGS.formUrl)
  await card.getByLabel(CARD_LABELS.sheetUrl).fill(SHEET)
  await card.getByLabel(CARD_LABELS.syncPrompt).fill(DEMO_SETTINGS.syncPrompt)
  const save = card.getByRole('button', { name: 'Сохранить' })
  await expect(save).toBeEnabled()
  await shot(page, SCENARIO, '02-settings-filled', save)
  await applyCard(card, {})
  await closeSettings(page)

  // Проверка схемы: адрес без http/https блокирует «Сохранить» и объясняет почему.
  card = await openSettingsCard(page)
  await card.getByLabel(CARD_LABELS.sheetUrl).fill('docs.google.com/spreadsheets/без-схемы')
  await expect(card.getByText('Нужен адрес, начинающийся с http:// или https://')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  await card.getByRole('button', { name: 'Отменить' }).click()
  await expect(card.getByLabel(CARD_LABELS.sheetUrl)).toHaveValue(SHEET)
  await closeSettings(page)

  // 2. «Обновить» → чат с промтом, в котором {sheet} заменён адресом. Ничего не отправлено.
  const aside = await openPanel(page)
  await aside.getByRole('button', { name: 'Обновить', exact: true }).click()
  const input = composer(page)
  await expect(input).toContainText(`/bft-needed-list ${SHEET}`)
  await expect(input).toContainText('Заводи недостающие инициативы типом bft')
  await expect(input).not.toContainText('{sheet}')
  await shot(page, SCENARIO, '03-sync-draft', input)
  await clearComposer(page)
})
