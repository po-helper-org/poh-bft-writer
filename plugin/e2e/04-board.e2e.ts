/** Плейбук 4 — доска по стадиям: колонки, карточка → детальная, «Добавить», назад. */
import { expect, test } from '@playwright/test'
import { openHarness, openPanel, panel, requireHarness, shot } from './support/harness.ts'

const SCENARIO = '04-board'
const STAGES = ['To Do', 'FAST-DONE', 'REVIEW-DONE', 'DEEP-WORK', 'DEEP-REVIEW', 'DEEP-DONE', 'Cancelled']

test.describe.configure({ mode: 'serial' })

test('доска: семь колонок, карточка, «Добавить», назад к списку', async ({ page }) => {
  const url = requireHarness()
  await openHarness(page, url)
  const aside = await openPanel(page)

  // 1. «Открыть доску требований» → семь колонок в порядке пайплайна, пустые тоже.
  await aside.getByRole('button', { name: 'Открыть доску требований' }).click()
  const board = page.locator('.bft-detail-page').filter({ hasText: 'Доска с требованиями' })
  await expect(board).toBeVisible()
  await expect(panel(page)).toBeHidden()
  const columns = board.locator('.bft-board-column')
  await expect(columns).toHaveCount(STAGES.length)
  const headers = await columns.locator('.bft-group-label').allInnerTexts()
  expect(headers).toEqual(STAGES)
  await shot(page, SCENARIO, '01-board')

  // 2. Карточка → детальная страница, «Назад» возвращает на доску, а не в список.
  const card = board.locator('.bft-item').first()
  await card.click()
  const detail = page.locator('.bft-detail-page').filter({ has: page.getByRole('tablist') })
  await expect(detail).toBeVisible()
  await detail.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(board).toBeVisible()

  // 3. «Добавить» в правом углу шапки. Активна ли — зависит от настроек, обе ветки честные:
  //    с ссылкой открывает форму на всю страницу (проверяется в сценарии 6), без — погашена
  //    с подсказкой, где её задать.
  const add = board.getByRole('button', { name: 'Добавить' })
  await expect(add).toBeVisible()
  await shot(page, SCENARIO, '02-add', add)
  if (await add.isDisabled()) {
    await expect(add).toHaveAttribute('title', /настройках/)
  } else {
    await add.click()
    const form = page.locator('.bft-detail-page').filter({ hasText: 'Новая инициатива' })
    await expect(form).toBeVisible()
    await form.getByRole('button', { name: 'Назад', exact: true }).click()
    await expect(board).toBeVisible()
  }

  // 4. «←» в шапке доски → список.
  await board.getByRole('button', { name: 'Назад', exact: true }).click()
  await expect(panel(page)).toBeVisible()
  await aside.getByRole('button', { name: 'Закрыть', exact: true }).click()
})
