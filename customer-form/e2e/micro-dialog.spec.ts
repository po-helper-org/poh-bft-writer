/**
 * E2E · HowToDemo заказчика п.3–10 — обращение с вложением → вопросы формой →
 * раскадровка сценария приёмки → «Согласую» (полное согласие, без ИТОГ) →
 * постановка, сводка, согласование и контекст в задаче Vikunja → быстрая
 * версия БФТ в том же чате (rev14): страница документа и файлы в задаче.
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
  test.setTimeout(180_000)

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

  // rev16: «Согласую» — полное согласие. Ни ИТОГ, ни повторного «подтверждаю»:
  // ссылка на согласованный сценарий, «уже готовлю» и экран ожидания справа.
  await expect(page.getByText('Уже готовлю БФТ-документ на проверку').first(), 'сразу «уже готовлю»').toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/ИТОГ по заявке/), 'ИТОГ больше не собирается').toHaveCount(0)
  const doc = page.frameLocator('iframe[data-customer-bft]')
  await expect(doc.getByRole('heading', { name: 'Уже готовлю БФТ-документ' }), 'экран ожидания справа').toBeVisible({ timeout: 15_000 })
  await expect(doc.locator('#tipText'), 'совет на экране ожидания').not.toBeEmpty()
  await page.screenshot({ path: 'test-results/bft-fast-waiting.png' })

  // Документ сам сменяет экран ожидания: базовый bft-fast со слоем заказчика (rev21).
  await expect(doc.getByRole('heading', { name: new RegExp(`\\[БФТ\\] zayavka-${taskId}`) }), 'документ в правой панели').toBeVisible({ timeout: 60_000 })
  for (const head of ['How to demo', 'Критичные требования (скелет на цитатах)']) {
    await expect(doc.getByRole('heading', { name: head }), `раздел «${head}»`).toBeVisible()
  }
  // How to demo — путь приёмки и таблица «Где · Делаю · Вижу» (rev22).
  const howTo = doc.locator('#customer-howtodemo')
  await expect(howTo.locator('.hd-flow'), 'путь приёмки схемой').toBeVisible()
  await expect(howTo.getByRole('columnheader', { name: 'Вижу' }), 'шаги таблицей').toBeVisible()
  await expect(howTo.getByRole('columnheader', { name: 'Проверяю' }), 'без «Проверяю» — дублировал «Вижу»').toHaveCount(0)
  await expect(howTo.getByRole('cell', { name: 'Почта Outlook' }).first(), 'согласованный сценарий').toBeVisible()
  await expect(doc.getByRole('heading', { name: 'Чьи зоны затрагивает и к кому обращаться' }), 'зоны и контакты').toBeVisible()
  // Требования и персоны — таблицы документа.
  await expect(doc.getByRole('columnheader', { name: 'TOBE (после)' }), 'требования таблицей').toBeVisible()
  await expect(doc.getByRole('cell', { name: 'Система сама формирует CSV к 9:00 и присылает его' }).first(), 'требование со слов').toBeVisible()
  await expect(doc.getByRole('columnheader', { name: 'ФИО' }), 'персоны — только в разделе зон').toHaveCount(0)
  // SMART A — план реализации из видения заказчика (rev22).
  await expect(doc.getByRole('row', { name: /A \(Achievable\)/ }), 'Achievable — план').toContainText('Видение заказчика: «выгрузку настроит BI-команда')
  await expect(doc.getByRole('row', { name: /A \(Achievable\)/ })).toContainText('Специалисты: PO, BE')
  for (const cut of ['Где проверять', 'Раскадровка по шагам', 'Работа принята, если', 'Общая информация', 'Источники', 'Роль/влияние', 'Полный БФТ — в проработке', 'Всё ок — отгружай']) {
    await expect(doc.getByText(cut), `в документе заказчика нет «${cut}»`).toHaveCount(0)
  }
  await expect(page.getByText(new RegExp(`Отслеживание статуса: \\S+/tasks/${taskId}`)), 'ссылка на заявку в чате').toBeVisible()
  await page.screenshot({ path: 'test-results/bft-fast-panel.png' })

  // «Добавить требования» → фраза в поле ввода → заказчик досказывает → новая версия.
  await doc.getByRole('button', { name: 'Добавить требования' }).click()
  await expect(composer, 'фраза в поле ввода').toContainText('Добавь требования', { timeout: 5_000 })
  await page.getByRole('button', { name: 'Остановить и распознать' }).click({ timeout: 3_000 }).catch(() => undefined)
  await composer.click()
  await page.keyboard.press('End')
  await page.keyboard.type('в письме видна дата отчёта')
  await page.keyboard.press('Enter')
  await expect(doc.getByText('В письме видна дата отчёта').first(), 'документ пересобран с новым требованием').toBeVisible({ timeout: 30_000 })

  // «Да, согласен» → отметка на странице и сообщение в чате.
  await doc.locator('#csYes').click()
  await expect(doc.locator('#csYes'), 'согласовано на странице').toHaveText(/Согласовано/, { timeout: 10_000 })
  await expect(page.getByText('Да, согласен с документом БФТ').first(), 'согласование в чате').toBeVisible({ timeout: 10_000 })

  // Полный БФТ (ADR-0012): «Да, согласен» запускает bft-deep — та же вкладка показывает сборку, затем документ.
  await expect(doc.getByRole('heading', { name: 'Пишу полный БФТ-документ' }), 'сборка полного БФТ справа').toBeVisible({ timeout: 15_000 })
  await expect(doc.getByText('Полный БФТ · по согласованным первичным требованиям'), 'полный БФТ в панели').toBeVisible({ timeout: 60_000 })
  for (const head of ['Проблема которую решаем', 'План демонстрации', 'Функциональные требования*', 'Якоря истины']) {
    await expect(doc.getByRole('heading', { name: head, exact: true }), `раздел канона «${head}»`).toBeVisible()
  }
  await expect(doc.getByRole('heading', { name: 'Продолжить / уточнить БФТ' }), 'промт для PO заказчику не показан').toHaveCount(0)
  await page.screenshot({ path: 'test-results/bft-deep-panel.png' })
  // Шаг 5: скачать .docx / .pdf / .md.
  const sessionId = (await page.locator('iframe[data-customer-bft]').getAttribute('data-customer-bft')) ?? ''
  for (const [format, type] of [['docx', 'officedocument.wordprocessingml'], ['pdf', 'application/pdf'], ['md', 'text/markdown']] as const) {
    const res = await request.get(`${CUSTOMER_URL}/api/customer-form.bftDownload?session=${encodeURIComponent(sessionId)}&doc=deep&format=${format}`)
    expect(res.status(), `скачать .${format}`).toBe(200)
    expect(res.headers()['content-type'], `тип .${format}`).toContain(type)
    const body = await res.body()
    expect(body.length, `.${format} не пустой`).toBeGreaterThan(1000)
    // Схема сценария приёмки: в Word — картинкой (PlantUML в образе), в .md — исходником.
    if (format === 'docx') expect(body.includes('word/media/'), 'схема PlantUML картинкой в .docx').toBe(true)
    if (format === 'md') expect(body.toString('utf8'), 'PlantUML исходником в .md').toContain('```plantuml')
  }

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
  for (const name of [`zayavka-${taskId}-fast.html`, `zayavka-${taskId}-fast.md`, `zayavka-${taskId}-requirements.csv`]) {
    expect(files, `быстрая версия БФТ: ${name}`).toContain(name)
  }
  const comments = (await (await request.get(`${TRACKER_API}/tasks/${taskId}/comments`, { headers: auth })).json()) as { comment: string }[]
  const thread = comments.map((c) => c.comment).join(' ')
  expect(thread, 'сводка в комментарии').toContain('Сводка ассистента портала')
  expect(thread, 'согласование заказчика в комментарии').toContain('Заказчик согласовал сценарий приёмки')
  expect(thread, 'отметка о быстрой версии БФТ').toContain('Быстрая версия БФТ собрана')
  expect(thread, 'согласование документа заказчиком').toContain('Заказчик согласовал быструю версию БФТ')
  expect(files, 'согласованная страница').toContain(`zayavka-${taskId}-fast-soglasovan.html`)
  expect(files, 'карта контекста Кортекса').toContain(`zayavka-${taskId}-context-map.md`)
  for (const name of [`zayavka-${taskId}.md`, `zayavka-${taskId}.html`]) {
    expect(files, `полный БФТ в задаче: ${name}`).toContain(name)
  }
})
