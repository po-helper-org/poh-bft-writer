/**
 * Живой E2E «Отправить в Confluence» (ADR-0028) — HowToDemo владельца, шаги 1–5, на заявке
 * с готовым полным БФТ (LIVE_SESSION):
 *
 *  1. вкладка «⇪ В Confluence» на странице полного БФТ;
 *  2. панель: ТОП-5 родительских страниц с причинами;
 *  3. поиск по названию (CF_QUERY) и вставка ссылки (CF_PARENT);
 *  4. «Отправить» → шаги с отметками, перезагрузка посреди отправки — ход тот же, ссылка в конце;
 *  5. повторная отправка — «страница обновлена», та же ссылка.
 *
 * Публикует ТОЛЬКО если задан CF_PARENT (тестовая страница-родитель, которую назвал владелец)
 * и CF_PUBLISH=1. Без ключа публикации — проверяет, что «Отправить» честно говорит, чего не
 * хватает (страница при этом не создаётся). Запуск — harness/e2e-confluence-publish.sh.
 */
import { expect, test } from '@playwright/test'

const PORTAL = (process.env.PORTAL_URL ?? 'http://127.0.0.1:3082').replace(/\/$/, '')
const SESSION = process.env.LIVE_SESSION ?? ''
const PARENT = process.env.CF_PARENT ?? ''
const QUERY = process.env.CF_QUERY ?? 'БФТ'
const PUBLISH = process.env.CF_PUBLISH === '1'
const OUT = 'test-results'

test('отправка в Confluence: вкладка → ТОП-5 → поиск/ссылка → ход по шагам → повтор без дубля', async ({ page, request }) => {
  test.setTimeout(15 * 60_000)
  expect(SESSION, 'LIVE_SESSION — сессия заявки с готовым полным БФТ').not.toBe('')
  const s = encodeURIComponent(SESSION)
  const deepUrl = `${PORTAL}/api/customer-form.bftFast?session=${s}`
  const parents = await (await request.get(`${PORTAL}/api/customer-form.confluenceParents?session=${s}`)).json() as { configured: boolean; searchable: boolean; suggestions: Array<{ title: string; reasons: string[] }> }
  console.log(`▸ публикация настроена: ${parents.configured}, поиск: ${parents.searchable}, ТОП: ${parents.suggestions.length}`)

  // Шаг 1.
  await page.goto(deepUrl)
  const tab = page.locator('[data-cs-cf]').first()
  await expect(tab).toBeVisible()
  await page.screenshot({ path: `${OUT}/cf-1-tab.png` })

  // Шаг 2.
  await tab.click()
  const panel = page.locator('#csCf')
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Куда лучше положить — ТОП-5')).toBeVisible({ timeout: 60_000 })
  const top = panel.locator('#csCfTop .cs-cf-item')
  const n = await top.count()
  expect(n).toBeLessThanOrEqual(5)
  for (let i = 0; i < n; i++) console.log(`  ${i + 1}. ${(await top.nth(i).innerText()).replace(/\n/g, ' — ')}`)
  if (parents.searchable) expect(n, 'поиск работает — есть предложения').toBeGreaterThan(0)
  await page.screenshot({ path: `${OUT}/cf-2-top5.png` })

  // Шаг 3: поиск по названию.
  const q = panel.locator('#csCfQ')
  await q.fill(QUERY)
  await expect(panel.locator('#csCfFound .cs-cf-item').first().or(panel.getByText(/Ничего не нашлось|недоступен/))).toBeVisible({ timeout: 30_000 })
  console.log(`▸ поиск «${QUERY}»: ${await panel.locator('#csCfFound .cs-cf-item').count()} страниц`)
  await page.screenshot({ path: `${OUT}/cf-3-search.png` })

  if (!PARENT) {
    // Без тестового места не публикуем: выбираем первое предложение и проверяем только кнопку.
    if (n > 0) {
      await top.first().click()
      await expect(panel.locator('#csCfSend')).toBeEnabled()
    }
    if (!parents.configured && n > 0) {
      await panel.locator('#csCfSend').click()
      await expect(panel.locator('#csCfErr')).toContainText(/CONFLUENCE_PUBLISH_TOKEN|Temporal/)
      await page.screenshot({ path: `${OUT}/cf-4-not-configured.png` })
      console.log('▸ ключа нет — «Отправить» говорит, что добавить; страница не создавалась')
    }
    return
  }

  // Шаг 3: вставка ссылки тестового родителя → одна страница, выбрана.
  await q.fill(PARENT)
  await expect(panel.locator('#csCfFound .cs-cf-item.sel')).toHaveCount(1, { timeout: 30_000 })
  console.log(`▸ родитель по ссылке: ${await panel.locator('#csCfFound .cs-cf-item.sel b').innerText()}`)
  await expect(panel.locator('#csCfSend')).toBeEnabled()
  if (!PUBLISH) return

  // Шаг 4: отправка, перезагрузка посреди хода.
  await panel.locator('#csCfSend').click()
  await expect(panel.locator('#csCfSteps')).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: `${OUT}/cf-4-progress.png` })
  await page.reload()
  const done = page.locator('#csCfDone')
  const steps = page.locator('#csCf #csCfSteps')
  // Ход виден после перезагрузки (если отправка ещё шла) — панель открылась сама.
  if (!(await done.isVisible().catch(() => false))) {
    const reopened = await steps.isVisible({ timeout: 10_000 }).catch(() => false)
    console.log(`▸ после перезагрузки панель ${reopened ? 'открылась сама с ходом' : 'закрыта (отправка уже закончилась)'}`)
    if (!reopened) await page.locator('[data-cs-cf]').first().click()
  }
  await expect(page.locator('#csCfDone').or(page.locator('#csCfErr'))).toBeVisible({ timeout: 10 * 60_000 })
  await page.screenshot({ path: `${OUT}/cf-5-done.png` })
  await expect(page.locator('#csCfDone'), await page.locator('#csCfErr').innerText().catch(() => '')).toBeVisible()
  const url = await page.locator('#csCfDone a').getAttribute('href')
  console.log(`▸ опубликовано: ${url}`)
  for (const li of await page.locator('#csCfSteps li').all()) console.log(`  ${(await li.innerText()).replace(/\n/g, ' — ')}`)

  // Шаг 5: повторная отправка — та же страница.
  await page.getByRole('button', { name: 'Отправить ещё раз или в другое место' }).click()
  await expect(page.locator('#csCfSend')).toBeEnabled({ timeout: 60_000 })
  await expect(page.locator('#csCfSend')).toHaveText('Отправить (обновить страницу)')
  await page.locator('#csCfSend').click()
  await expect(page.locator('#csCfDone').or(page.locator('#csCfErr'))).toBeVisible({ timeout: 10 * 60_000 })
  await expect(page.locator('[data-step="page"]')).toContainText(/обновлена/)
  expect(await page.locator('#csCfDone a').getAttribute('href')).toBe(url)
  await page.screenshot({ path: `${OUT}/cf-6-update.png` })
  for (const li of await page.locator('#csCfSteps li').all()) console.log(`  ${(await li.innerText()).replace(/\n/g, ' — ')}`)
})
