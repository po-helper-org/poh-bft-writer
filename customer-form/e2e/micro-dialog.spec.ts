/**
 * E2E · HowToDemo заказчика п.3–10 — обращение с вложением → вопросы формой →
 * раскадровка сценария приёмки → «Согласую» → ИТОГ → подтверждение →
 * постановка, сводка, согласование и контекст в задаче Vikunja.
 *
 * Модель — двойник (e2e/llm-double.mjs, его подключает harness/e2e-customer.sh):
 * сценарий детерминирован и не зависит от квоты ключа. Проверяется всё, что
 * делает портал вокруг модели: заявка, вложения, форма dsh, инструмент сдачи.
 */
import { expect, test } from '@playwright/test'

const CUSTOMER_URL = process.env.CUSTOMER_URL ?? 'http://127.0.0.1:3080'
const TRACKER_API = process.env.TRACKER_API ?? 'http://127.0.0.1:3456/api/v1'
const UNIQUE = Date.now().toString(36)

test('микродиалог: вложение → вопросы → согласование приёмки → постановка в задаче', async ({ page, request }) => {
  test.skip(process.env.LLM_DOUBLE !== '1', 'нужна модель-двойник: запускайте через harness/e2e-customer.sh')
  test.setTimeout(120_000)

  await page.goto(CUSTOMER_URL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer).toBeVisible({ timeout: 30_000 })

  // п.3: прикрепляю файл штатным «+» → «Файл» композера dsh.
  await page.getByRole('button', { name: 'Прикрепить файлы' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('option', { name: /^Файл/ }).click()
  await (await chooser).setFiles({ name: `interview-${UNIQUE}.txt`, mimeType: 'text/plain', buffer: Buffer.from('Интервью: отчёт к 9:00') })
  await expect(page.getByText(`interview-${UNIQUE}.txt`).first()).toBeVisible()

  // п.4–6: текст обращения → отправка → ссылка на заявку.
  await composer.click()
  await page.keyboard.type(`Диалог ${UNIQUE}: нужна утренняя выгрузка отчётов в CSV. Заказчик E2E Тестов, e2e@test.local`)
  await page.getByRole('button', { name: 'Отправить' }).click()
  const link = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(link).toBeVisible({ timeout: 5_000 })
  const taskId = Number(/#(\d+)/.exec((await link.textContent()) ?? '')?.[1])

  // п.8: уточняющие вопросы — штатная форма dsh (ask_user_question), по-русски.
  await page.getByRole('radio', { name: 'Вручную в Excel' }).click()
  await page.getByRole('radio', { name: 'В почте утром' }).click()
  await page.getByRole('button', { name: 'Отправить' }).last().click()

  // HowToDemo: «как я буду принимать работу» — карточка согласования dsh
  // (intent plan-review) и раскадровка по экранам в правой панели.
  await expect(page.getByText('Как я буду принимать работу'), 'карточка согласования').toBeVisible({ timeout: 30_000 })
  const panel = page.frameLocator('iframe[data-customer-acceptance]')
  await expect(panel.getByRole('heading', { name: 'Путь приёмки' }), 'сценарий в панели').toBeVisible({ timeout: 15_000 })
  await expect(panel.locator('.step h3', { hasText: 'Почта Outlook' }).first(), 'шаг раскадровки').toBeAttached()
  await page.screenshot({ path: 'test-results/acceptance-demo.png' })
  await page.getByRole('button', { name: 'Согласую' }).click()

  // ИТОГ → подтверждение текстом → сдача заявки → финальная ссылка (п.9–10).
  await expect(page.getByText(/ИТОГ по заявке/)).toBeVisible({ timeout: 30_000 })
  await composer.click()
  await page.keyboard.type('подтверждаю')
  await page.keyboard.press('Enter')
  await expect(page.getByText(new RegExp(`Отслеживание статуса: \\S+/tasks/${taskId}`))).toBeVisible({ timeout: 30_000 })

  // Задача: постановка по разделам, сводка в комментарии, вложение + контекст.
  const login = await request.post(`${TRACKER_API}/login`, {
    data: { username: process.env.TRACKER_USER ?? 'bft-admin', password: process.env.TRACKER_PASSWORD ?? '' },
  })
  test.skip(!login.ok(), 'нет TRACKER_PASSWORD — проверку задачи в Vikunja пропускаем')
  const auth = { authorization: `Bearer ${((await login.json()) as { token: string }).token}` }
  const task = (await (await request.get(`${TRACKER_API}/tasks/${taskId}`, { headers: auth })).json()) as {
    description: string; attachments: { file: { name: string } }[] | null
  }
  for (const section of ['ASIS', 'GAP', 'TOBE', 'HowToDemo', 'согласован заказчиком', 'Глоссарий', 'e2e@test.local']) {
    expect(task.description, `раздел «${section}» в постановке`).toContain(section)
  }
  const files = (task.attachments ?? []).map((a) => a.file.name)
  expect(files, 'вложение заказчика в задаче').toContain(`interview-${UNIQUE}.txt`)
  expect(files, 'файл полного контекста').toContain(`context-${taskId}.md`)
  expect(files, 'раскадровка сценария приёмки').toContain(`howtodemo-${taskId}.md`)
  const comments = (await (await request.get(`${TRACKER_API}/tasks/${taskId}/comments`, { headers: auth })).json()) as { comment: string }[]
  const thread = comments.map((c) => c.comment).join(' ')
  expect(thread, 'сводка в комментарии').toContain('Сводка ассистента портала')
  expect(thread, 'согласование заказчика в комментарии').toContain('Заказчик согласовал сценарий приёмки')
})
