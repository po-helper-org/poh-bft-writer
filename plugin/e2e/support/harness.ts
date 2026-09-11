/**
 * Общий слой E2E-прогонов: где харнесс, как открыть раздел, как снять скриншот для плейбука.
 *
 * Прогоны идут против ЖИВОГО харнесса (`launchd`-агент `ru.poh.dsh-harness`), а не против
 * поднятого тестом экземпляра: собрать харнесс с профилем, плагинами и воркспейсом внутри
 * теста — отдельный проект, а живой уже стоит и ровно его видит PO. Отсюда два следствия,
 * которые определяют весь дизайн ниже:
 *
 * 1. Документ настроек общий с PO. Тест, которому нужны свои значения, ОБЯЗАН сначала
 *    снять текущие (`readCard`), а в конце вернуть их дословно (`restoreCard`) — не
 *    «сбросить», а именно вернуть: у PO там живые ссылки на форму и таблицу.
 * 2. Ничего не отправляется агенту. Кнопки раздела кладут черновик в композер, тест
 *    проверяет текст и стирает его (`clearComposer`), Enter не жмёт никогда.
 *
 * Адрес харнесса — `DSH_E2E_URL` (с токеном), а без неё — последняя строка `dsh web:` из
 * лога launchd-агента: на машине разработчика этого достаточно, чтобы прогон запускался
 * одной командой. Нет ни того, ни другого — прогоны пропускаются, а не падают.
 */
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { assertClean, markSafe, redactPage, registerSecrets } from './redact.ts'

/** Лог launchd-агента харнесса; туда же смотрит CLAUDE.md воркспейса. */
const HARNESS_LOG = '/tmp/dsh-harness-ui.log'

export function harnessUrl(): string | undefined {
  const fromEnv = process.env.DSH_E2E_URL?.trim()
  if (fromEnv) return fromEnv
  try {
    const lines = fs.readFileSync(HARNESS_LOG, 'utf8').split('\n')
    const last = lines.filter(line => line.includes('dsh web: http')).at(-1)
    return last?.slice(last.indexOf('http')).trim()
  } catch {
    return undefined
  }
}

/** Пропускает файл целиком, если харнесса нет: без него проверять нечего. */
export function requireHarness(): string {
  const url = harnessUrl()
  test.skip(url === undefined, `нет адреса харнесса: задайте DSH_E2E_URL или поднимите ru.poh.dsh-harness (${HARNESS_LOG})`)
  return url ?? ''
}

export async function openHarness(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await expect(sectionButton(page)).toBeVisible()
}

/** Кнопка раздела в подвале левой панели. */
export function sectionButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Управление требованиями' })
}

/** Панель списка — `<aside aria-label="Требования">`. */
export function panel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Требования', exact: true })
}

export async function openPanel(page: Page): Promise<Locator> {
  await sectionButton(page).click()
  const aside = panel(page)
  await expect(aside).toBeVisible()
  // Дожидаемся списка, а не скелета: дальше тесты кликают по строкам.
  await expect(aside.locator('.bft-item').first()).toBeVisible({ timeout: 20_000 })
  return aside
}

export function composer(page: Page): Locator {
  return page.getByRole('textbox', { name: /Describe what you want to build/ })
}

/** Стирает черновик, который положила в композер кнопка раздела. Отправки нет. */
export async function clearComposer(page: Page): Promise<void> {
  const input = composer(page)
  await input.click()
  await page.keyboard.press('Meta+A')
  await page.keyboard.press('Backspace')
  await expect(input).toHaveText('')
}

// ——— Карточка настроек раздела ———

/**
 * Демонстрационные значения для прогонов и скриншотов плейбуков: на картинках в docs не
 * должно быть живых ссылок PO. Ссылку на форму сценарий 6 подставляет свою — адрес
 * локального сервера из form-server.ts.
 */
export const DEMO_SETTINGS = {
  formUrl: 'https://forms.example.com/intake?embedded=true',
  sheetUrl: 'https://docs.google.com/spreadsheets/d/DEMO-INITIATIVES/edit',
  syncPrompt: '/bft-needed-list {sheet}\n\nЗаводи недостающие инициативы типом bft, стадии не двигай.',
} as const
markSafe(...Object.values(DEMO_SETTINGS))

export const CARD_LABELS = {
  formUrl: 'Ссылка на форму сбора требований',
  sheetUrl: 'Ссылка на таблицу требований',
  syncPrompt: 'Промт работы с требованиями',
} as const

export type CardKey = keyof typeof CARD_LABELS

export interface CardField {
  text: string
  /** Есть пометка «переопределено»: значение записано в пользовательский слой. */
  overridden: boolean
}

export type CardValues = Record<CardKey, CardField>

/** Что сделать с полем: записать текст или очистить («сбросить» к слою композиции). */
export type FieldPatch = string | { reset: true }

/** Открывает Настройки → Плагины и разворачивает карточку «Требования». */
export async function openSettingsCard(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Plugins' }).click()
  const card = dialog.getByRole('listitem').filter({ hasText: 'Требования' }).first()
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: /Требования/ }).first().click()
  await expect(card.getByLabel(CARD_LABELS.formUrl)).toBeVisible()
  return card
}

export async function closeSettings(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
}

function fieldBlock(card: Locator, key: CardKey): Locator {
  return card.locator('.bft-field').filter({ hasText: CARD_LABELS[key] })
}

/**
 * Читает карточку и регистрирует прочитанное как секреты прогона (redact.ts): живые значения
 * PO не должны попасть ни на один снимок, в каком бы порядке шаги ни шли.
 */
export async function readCard(card: Locator): Promise<CardValues> {
  const read = async (key: CardKey): Promise<CardField> => ({
    text: await card.getByLabel(CARD_LABELS[key]).inputValue(),
    overridden: (await fieldBlock(card, key).getByText('переопределено').count()) > 0,
  })
  const values = { formUrl: await read('formUrl'), sheetUrl: await read('sheetUrl'), syncPrompt: await read('syncPrompt') }
  registerSecrets(values.formUrl.text, values.sheetUrl.text, values.syncPrompt.text)
  return values
}

/**
 * Записывает правки и ждёт подтверждения: карточка схлопывается только после того, как
 * документ вернул то, что писали. Отказ хоста остаётся на экране текстом — тест на нём падает,
 * а не идёт дальше с чужими значениями.
 */
export async function applyCard(card: Locator, patch: Partial<Record<CardKey, FieldPatch>>): Promise<void> {
  for (const key of Object.keys(patch) as CardKey[]) {
    const value = patch[key]
    if (value === undefined) continue
    if (typeof value === 'string') {
      await card.getByLabel(CARD_LABELS[key]).fill(value)
    } else {
      await fieldBlock(card, key).getByRole('button', { name: 'сбросить' }).click()
    }
  }
  const save = card.getByRole('button', { name: 'Сохранить' })
  if (await save.isDisabled()) return
  await save.click()
  await expect(card.getByText('Не удалось сохранить')).toHaveCount(0)
  await expect(card.getByLabel(CARD_LABELS.formUrl)).toBeHidden({ timeout: 15_000 })
}

/** Возвращает документ к снятому состоянию: переопределённое — дословно, остальное — сбросом. */
export async function restoreCard(page: Page, backup: CardValues): Promise<void> {
  const card = await openSettingsCard(page)
  const current = await readCard(card)
  const patch: Partial<Record<CardKey, FieldPatch>> = {}
  for (const key of Object.keys(backup) as CardKey[]) {
    const want = backup[key]
    const have = current[key]
    if (want.overridden && (have.text !== want.text || !have.overridden)) patch[key] = want.text
    if (!want.overridden && have.overridden) patch[key] = { reset: true }
  }
  await applyCard(card, patch)
  await closeSettings(page)
}

/**
 * Резервная копия значений карточки на диске: если прогон упал до `restoreCard`, документ
 * PO восстанавливается по этому файлу руками (см. e2e/README.md).
 */
export function writeBackup(name: string, values: CardValues): string {
  const dir = path.resolve('e2e/.artifacts')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.settings-backup.json`)
  fs.writeFileSync(file, JSON.stringify(values, null, 2))
  return file
}

// ——— Скриншоты для плейбуков ———

/**
 * Снимок шага для плейбука. Пишется только при заданном `PLAYBOOK_SHOTS_DIR` — обычный
 * прогон проверяет поведение и картинок не производит. `highlight` обводит элемент, о
 * котором идёт речь на шаге, и снимает обводку после снимка.
 *
 * Перед снимком страница обезличивается (redact.ts): картинки публичны, а харнесс показывает
 * живой Backlog.md. Остался запрещённый фрагмент — снимка нет, прогон падает.
 */
export async function shot(page: Page, scenario: string, name: string, highlight?: Locator): Promise<void> {
  const root = process.env.PLAYBOOK_SHOTS_DIR
  if (!root) return
  const dir = path.resolve(root, scenario)
  fs.mkdirSync(dir, { recursive: true })
  const previous = highlight === undefined
    ? undefined
    : await highlight.evaluate((element) => {
      const el = element as HTMLElement
      const before = el.style.cssText
      el.style.outline = '3px solid #ff5f57'
      el.style.outlineOffset = '3px'
      return before
    })
  const restore = await redactPage(page)
  try {
    await assertClean(page)
    // Мгновенный переход анимаций: снимок не должен зависеть от того, в какой фазе
    // раскрытия застала его камера.
    await page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled' })
  } finally {
    await restore()
    if (highlight !== undefined) {
      await highlight.evaluate((element, before) => { (element as HTMLElement).style.cssText = before }, previous ?? '')
    }
  }
}
