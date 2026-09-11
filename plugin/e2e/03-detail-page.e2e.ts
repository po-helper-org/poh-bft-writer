/** Плейбук 3 — детальная страница: документ, «О задаче», быстрые правки (без отправки). */
import { expect, test } from '@playwright/test'
import { DEMO_DOCUMENT } from './support/demo-document.ts'
import { openHarness, openPanel, panel, requireHarness, shot } from './support/harness.ts'

const SCENARIO = '03-detail-page'

test.describe.configure({ mode: 'serial' })

test('детальная страница: документ, «О задаче», набранная правка, назад', async ({ page }) => {
  const url = requireHarness()
  await openHarness(page, url)
  const aside = await openPanel(page)

  // Берём требование, у которого в ссылках есть документ (`bft/documentation/<slug>/<slug>.html`),
  // если такое есть в очереди, иначе — первое попавшееся: тогда слева будет «Документа нет» и
  // «Создать документ», это тоже валидный экран сценария.
  const preferred = aside.locator('.bft-item').filter({ hasText: 'PO-22' })
  const item = (await preferred.count()) > 0 ? preferred.first() : aside.locator('.bft-item').first()
  const id = (await item.locator('.bft-item-id').innerText()).trim()
  await item.click()
  const preview = page.getByRole('complementary', { name: 'Превью' })
  await preview.getByRole('button', { name: 'Детальная страница' }).click()

  // 1. Полноэкранная страница: слева документ или «Документа нет», справа вкладки.
  const detail = page.locator('.bft-detail-page')
  await expect(detail).toBeVisible()
  await expect(panel(page)).toBeHidden()
  const tabs = detail.getByRole('tablist', { name: 'Что показывать в правой колонке' })
  await expect(tabs.getByRole('tab', { name: 'Чат' })).toHaveAttribute('aria-selected', 'true')
  const frame = detail.locator('iframe[title="Документ требования"]')
  const missing = detail.getByText('Документа нет')
  await expect(frame.or(missing)).toBeVisible({ timeout: 20_000 })
  // На снимках — демонстрационный документ вместо настоящего (см. support/demo-document.ts):
  // настоящий — внутренний текст целиком, регулярки вычистят названия, но не смысл. Подмена
  // держится на всех снимках этой страницы и откатывается перед уходом с неё.
  let realDocument: string | undefined
  if (await frame.count() > 0) {
    // Документ приходит через srcdoc и рисуется не мгновенно: снимок пустого фрейма ничего не
    // показал бы. Ждём, пока внутри появится текст, и только потом подменяем.
    await expect(page.frameLocator('iframe[title="Документ требования"]').locator('body')).not.toBeEmpty()
    realDocument = await frame.evaluate((el, demo) => {
      const iframe = el as HTMLIFrameElement
      const before = iframe.srcdoc
      iframe.srcdoc = demo
      return before
    }, DEMO_DOCUMENT)
    await expect(page.frameLocator('iframe[title="Документ требования"]').getByRole('heading', { level: 1 }))
      .toContainText('Возврат билета')
    await page.waitForTimeout(300)
  }
  await shot(page, SCENARIO, '01-detail')

  // 2. «О задаче» — ключевые поля требования.
  await tabs.getByRole('tab', { name: 'О задаче' }).click()
  await expect(tabs.getByRole('tab', { name: 'О задаче' })).toHaveAttribute('aria-selected', 'true')
  await expect(detail.getByText('Стадия', { exact: true })).toBeVisible()
  await shot(page, SCENARIO, '02-about', tabs.getByRole('tab', { name: 'О задаче' }))

  // 3. Быстрые правки: набрать можно, отправку тест не жмёт — это ушло бы агенту.
  await tabs.getByRole('tab', { name: 'Чат' }).click()
  const edit = detail.getByPlaceholder('Что поправить в этом требовании')
  await expect(edit).toBeVisible()
  await expect(detail.getByText('Правки отсюда не уводят в основной чат')).toBeVisible()
  await edit.fill(`Уточни образ результата для ${id}: кто именно заказчик и как поймём, что готово`)
  const send = detail.getByRole('button', { name: 'Отправить' })
  await expect(send).toBeEnabled()
  await expect(detail.getByRole('button', { name: 'Открыть в основном чате' })).toBeVisible()
  await shot(page, SCENARIO, '03-quick-edit', send)
  await edit.fill('')

  if (realDocument !== undefined) {
    await frame.evaluate((el, before) => { (el as HTMLIFrameElement).srcdoc = before }, realDocument)
  }

  // 4. «Назад» возвращает в превью — туда, откуда пришли.
  await detail.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Назад к списку' }).click()
  await aside.getByRole('button', { name: 'Закрыть', exact: true }).click()
})
