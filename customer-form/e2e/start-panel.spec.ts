/**
 * E2E · правая панель «Старт» заказчика и ответ формой на документ БФТ.
 *
 *  - «Старт» без «Терминала» и «Дополнительных инструментов», с карточками
 *    «Информация» и «Смотреть все заявки» (доска — та же, что под формой).
 *  - После сборки первичных требований ход ассистента кончается формой
 *    «Да, согласен» / «Есть замечания»; «Да, согласен» в чате согласует
 *    документ и запускает полный БФТ — как кнопка на странице документа.
 *  - «Информация» из «Старта» открывает сведения о заявке в панели.
 *  - «Файлы рабочей области»: папка заявки с запросом и документами.
 *  - Строки портала «📌 …» — не пузырь заказчика.
 *
 * Снимки — test-results/ui-*.png (раннер копирует их в .bft/ui/).
 */
import { expect, test, type Page } from '@playwright/test'

const CUSTOMER_URL = (process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080').replace(/\/+$/, '')
const UNIQUE = Date.now().toString(36)

/** Открыть «Старт» правой панели: свёрнутую панель — кнопкой, при открытых вкладках — «Новая вкладка». */
async function openStart(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: 'Открыть правую боковую панель' })
  if (await open.isVisible().catch(() => false)) await open.click()
  const guide = page.locator('[data-sidebar-right-guide]')
  if (!(await guide.isVisible().catch(() => false))) await page.getByRole('button', { name: 'Новая вкладка' }).click()
  await expect(guide, 'панель «Старт»').toBeVisible({ timeout: 10_000 })
}

test('«Старт»: без терминала и доп. инструментов, есть «Информация» и «Смотреть все заявки»', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(CUSTOMER_URL)
  await expect(page.locator("[data-composer-input][contenteditable='true']").first()).toBeVisible({ timeout: 30_000 })
  await openStart(page)
  const guide = page.locator('[data-sidebar-right-guide]')
  await expect(guide.getByRole('button', { name: /Файлы рабочей области/ })).toBeVisible()
  await expect(guide.getByRole('button', { name: /Информация/ })).toBeVisible()
  await expect(guide.getByText('Терминал'), 'терминала нет').toHaveCount(0)
  await expect(page.locator('[data-sidebar-right-guide-entry="terminal"]')).toHaveCount(0)
  await expect(guide.getByRole('button', { name: 'Дополнительные инструменты' }), 'меню «Дополнительные инструменты» скрыто').toBeHidden()
  const all = guide.getByRole('link', { name: /Смотреть все заявки/ })
  await expect(all).toBeVisible()
  // Та же доска, что под формой (my-requests.spec): от адреса портала, а не от корня домена.
  await expect(all).toHaveAttribute('href', `${CUSTOMER_URL}/api/customer-form.requests`)
  await expect(all).toHaveAttribute('target', '_blank')
  await page.screenshot({ path: 'test-results/ui-start-panel.png' })
})

test('документ БФТ: форма «Да, согласен» / «Есть замечания» в чате, «Информация» и папка заявки', async ({ page }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type(`Старт ${UNIQUE}: утренняя выгрузка отчётов в CSV. Иван Тест, ivan@test.local`)
  await page.getByRole('button', { name: 'Отправить' }).click()
  const pin = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(pin).toBeVisible({ timeout: 5_000 })
  const taskId = Number(/#(\d+)/.exec((await pin.textContent()) ?? '')?.[1])

  // Строка портала — пометкой «Портал», не пузырём заказчика.
  await expect(page.locator('[data-portal-note="ticket"]').first(), 'пометка строки портала').toBeVisible({ timeout: 10_000 })

  await page.getByRole('radio', { name: 'Вручную в Excel' }).click()
  await page.getByRole('radio', { name: 'В почте утром' }).click()
  await page.getByRole('button', { name: 'Отправить' }).last().click()
  await page.getByRole('button', { name: 'Согласую' }).click({ timeout: 30_000 })
  await expect(page.locator('[data-portal-note="demo"]').first(), '«Сценарий согласован» — строка портала').toBeVisible({ timeout: 15_000 })

  // Документ собран — ход кончается формой, а не призывом в тексте.
  const doc = page.frameLocator('iframe[data-customer-bft]')
  await expect(doc.getByRole('heading', { name: new RegExp(`\\[БФТ\\] zayavka-${taskId}`) })).toBeVisible({ timeout: 60_000 })
  const question = page.getByRole('region', { name: 'Документ справа верный?' })
  await expect(question, 'форма «Документ справа верный?»').toBeVisible({ timeout: 15_000 })
  await expect(question.getByRole('radio', { name: /Да, согласен/ })).toBeVisible()
  await expect(question.getByRole('radio', { name: /Есть замечания/ })).toBeVisible()
  await expect(page.getByText(/нажмите «Да, согласен»/), 'призыва текстом нет').toHaveCount(0)
  await page.screenshot({ path: 'test-results/ui-fast-chat.png' })

  // «Да, согласен» в форме = кнопка на странице: документ согласован, полный БФТ собирается.
  await question.getByRole('radio', { name: /Да, согласен/ }).click()
  await question.getByRole('button', { name: 'Отправить' }).click()
  await expect(question).toHaveCount(0, { timeout: 10_000 })
  await expect(doc.getByRole('heading', { name: 'Пишу полный БФТ-документ' }).or(doc.getByText('Полный БФТ · по согласованным первичным требованиям')), 'полный БФТ запущен').toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('полный БФТ собирается справа').first(), 'ответ ассистента после согласования').toBeVisible({ timeout: 15_000 })
  await expect(composer, 'поле ввода вернулось').toBeVisible()
  await page.screenshot({ path: 'test-results/ui-fast-approved.png' })

  // «Старт» → «Информация»: сведения о заявке — страницей правой панели.
  await openStart(page)
  await page.screenshot({ path: 'test-results/ui-start-panel-session.png' })
  await page.locator('[data-sidebar-right-guide]').getByRole('button', { name: /Информация/ }).click()
  const info = page.locator('[data-customer-info]').last()
  await expect(info.getByRole('link', { name: `Заявка #${taskId}` }), 'заявка во «Информации»').toBeVisible({ timeout: 10_000 })
  await expect(info).toContainText('Сценарий приёмки')

  // «Старт» → «Файлы рабочей области»: папка заявки с документами.
  await openStart(page)
  await page.locator('[data-sidebar-right-guide]').getByRole('button', { name: /Файлы рабочей области/ }).click()
  const folder = page.getByText(new RegExp(`^Заявка ${taskId} — `)).first()
  await expect(folder, 'папка заявки в файлах').toBeVisible({ timeout: 15_000 })
  await folder.click()
  for (const name of ['Запрос заказчика.md', 'Сценарий приёмки.md', 'Первичные требования (bft-fast).md']) {
    await expect(page.getByText(name, { exact: true }).first(), `файл «${name}»`).toBeVisible({ timeout: 10_000 })
  }
  await page.screenshot({ path: 'test-results/ui-workspace-files.png' })
  // Полный БФТ ложится в ту же папку, когда соберётся (готовый документ сам выходит вперёд — вернуться к файлам).
  await expect(doc.getByText('Полный БФТ · по согласованным первичным требованиям')).toBeVisible({ timeout: 60_000 })
  await page.getByRole('tab', { name: /Файлы/ }).click()
  await expect(page.getByText('БФТ.md', { exact: true }).first(), 'полный БФТ в папке заявки').toBeVisible({ timeout: 20_000 })
})
