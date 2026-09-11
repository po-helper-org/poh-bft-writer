/** Плейбук 1 — список требований: открыть, свернуть группу, найти. */
import { expect, test } from '@playwright/test'
import { clearComposer, openHarness, openPanel, panel, requireHarness, sectionButton, shot } from './support/harness.ts'

const SCENARIO = '01-requirements-list'

test.describe.configure({ mode: 'serial' })

test('список: открыть, свернуть группу, найти, закрыть', async ({ page }) => {
  const url = requireHarness()
  await openHarness(page, url)

  // 1. Открыть раздел.
  const aside = await openPanel(page)
  const badge = aside.locator('.bft-header .bft-badge')
  await expect(badge).toHaveText(/^\d+$/)
  const total = Number(await badge.textContent())
  expect(total).toBeGreaterThan(0)
  for (const name of ['Новая инициатива', 'Обновить', 'Закрыть']) {
    await expect(aside.getByRole('button', { name, exact: true })).toBeVisible()
  }
  await shot(page, SCENARIO, '01-open', sectionButton(page))

  // 2. Группы по стадиям: заголовок сворачивает группу.
  const groups = aside.locator('.bft-group')
  const groupCount = await groups.count()
  expect(groupCount).toBeGreaterThan(0)
  const shown = await aside.locator('.bft-item').count()
  expect(shown).toBe(total)
  const first = groups.first()
  await first.locator('.bft-group-header').click()
  await expect(first).toHaveAttribute('data-collapsed', 'true')
  await expect(first.locator('.bft-group-header')).toHaveAttribute('aria-expanded', 'false')
  await shot(page, SCENARIO, '02-collapse', first.locator('.bft-group-header'))
  await first.locator('.bft-group-header').click()
  await expect(first).toHaveAttribute('data-collapsed', 'false')

  // 3. Поиск: остаются только совпадения, пустые группы исчезают.
  const firstTitle = (await aside.locator('.bft-item .bft-item-body').first().innerText()).split('\n')[0] ?? ''
  const query = firstTitle.split(/\s+/).find(word => word.length >= 4) ?? firstTitle.slice(0, 4)
  const search = aside.getByPlaceholder('Поиск по требованиям')
  await search.fill(query)
  const matches = aside.locator('.bft-item')
  await expect(matches.first()).toBeVisible()
  const matched = await matches.count()
  expect(matched).toBeGreaterThan(0)
  expect(matched).toBeLessThanOrEqual(total)
  for (const text of await matches.allInnerTexts()) {
    expect(text.toLowerCase()).toContain(query.toLowerCase())
  }
  await shot(page, SCENARIO, '03-search', search)
  await aside.getByRole('button', { name: 'Очистить поиск' }).click()
  await expect(aside.locator('.bft-item')).toHaveCount(total)

  // Ничего не нашлось — отдельное состояние с кнопкой сброса.
  await search.fill('zzz-такого-требования-нет-zzz')
  await expect(aside.getByText('Ничего не найдено')).toBeVisible()
  await aside.getByRole('button', { name: 'Сбросить поиск' }).click()
  await expect(aside.locator('.bft-item')).toHaveCount(total)

  // 4. Закрыть.
  await aside.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await expect(panel(page)).toBeHidden()

  // Свёрнутость и фильтр не переживают закрытие — при следующем открытии всё развёрнуто.
  await openPanel(page)
  await expect(aside.locator('.bft-group[data-collapsed="true"]')).toHaveCount(0)
  await expect(search).toHaveValue('')
  await aside.getByRole('button', { name: 'Закрыть', exact: true }).click()
  await clearComposer(page).catch(() => { /* композер пуст — стирать нечего */ })
})
