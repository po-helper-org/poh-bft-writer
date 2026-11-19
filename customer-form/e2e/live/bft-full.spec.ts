/**
 * Живой E2E /bft (ADR-0016): настоящая модель портала, настоящие Кортекс
 * (память агента bft-creator) и шлюз источников Jira/Confluence.
 *
 * Путь заказчика целиком: обращение → вопросы формы → «Как я буду принимать
 * работу» → «Согласую» → первичные требования (fast) → «Да, согласен» → полный БФТ.
 * Тест проходит путь и проверяет то, что видит заказчик; что /bft опирался на
 * память и источники, а не начал с чистого листа, проверяет
 * harness/e2e-bft-live-check.py по артефактам заявки — тест пишет для него
 * test-results/live-run.json (заявка, сессия, документы).
 *
 * Запуск — harness/e2e-bft-live.sh на сервере (не в e2e-customer.sh: там
 * модель-двойник, а здесь ключи и квоты настоящей модели, 10–25 минут).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const PORTAL = (process.env.PORTAL_URL ?? 'http://127.0.0.1:3082').replace(/\/$/, '')
const UNIQUE = Date.now().toString(36)
const OUT = 'test-results'

/**
 * Обращение — из LIVE_REQUEST: раннер берёт его из приватного файла на сервере
 * (BFT_E2E_REQUEST_FILE) — обращение должно быть в домене, который знает память
 * bft-creator, а предметную область организации в публичный репозиторий не пишем.
 * Без него — нейтральное обращение (опору на память оно не покажет).
 */
const REQUEST = `[E2E ${UNIQUE}] ` + (process.env.LIVE_REQUEST || [
  'Партнёры после переезда на новую платформу продаж перестали видеть отчёт по возвратам.',
  'Раньше выгружали его сами раз в неделю, теперь пишут в поддержку, а мы собираем отчёт руками из двух систем — 2–3 часа на партнёра.',
  'Нужно, чтобы партнёр снова сам видел возвраты по своим продажам: дата, сумма, причина, способ возврата денег.',
  'Проверять буду так: захожу под тестовым партнёром, открываю отчёт за прошлую неделю и сверяю с выгрузкой поддержки.',
  'Заказчик — E2E Тестов, руководитель поддержки партнёров, e2e@test.local',
].join(' '))

/** Ответы на вопросы формы по ключевым словам вопроса; иначе — общий ответ (без имён систем). */
const ANSWERS: [RegExp, string][] = [
  [/кто|заказчик|контакт|обращаться/i, 'E2E Тестов, руководитель поддержки, e2e@test.local'],
  [/срок|когда|дедлайн/i, 'До конца квартала'],
  [/метрик|эффект|измер|сколько/i, 'Сейчас 2–3 часа ручной работы в неделю на каждого, хотим 0 — смотрят сами'],
  [/видите решение|каким вы видите|как.*реш/i, 'Отчёт в личном кабинете в новой платформе, данные берутся из неё же'],
  [/где|провер|стенд|принима/i, 'На тестовом стенде под тестовой учётной записью, сверка с выгрузкой поддержки'],
]
const DEFAULT_ANSWER = 'Как в описании обращения: видеть самим, без ручной работы поддержки'

async function answerForm(page: Page, round: number): Promise<void> {
  const question = await page.locator('h2').filter({ visible: true }).last().innerText().catch(() => '')
  const custom = page.getByPlaceholder('Свой ответ').filter({ visible: true }).first()
  const answer = ANSWERS.find(([re]) => re.test(question))?.[1] ?? DEFAULT_ANSWER
  if (await custom.count()) await custom.fill(answer)
  else {
    // Без поля «Свой ответ» — первый вариант в каждой группе.
    const groups = page.getByRole('radiogroup').filter({ visible: true })
    const n = await groups.count()
    if (n) for (let i = 0; i < n; i++) await groups.nth(i).getByRole('radio').first().click()
    else await page.getByRole('radio').filter({ visible: true }).first().click()
  }
  console.log(`▸ вопрос ${round + 1}: ${question.slice(0, 120)} → ${answer.slice(0, 60)}`)
  await page.getByRole('button', { name: /^(Отправить|Дальше)$/ }).filter({ visible: true }).last().click()
  await page.waitForTimeout(1_000)
}

test('живой /bft: обращение → первичные требования → полный БФТ', async ({ page, request }) => {
  test.setTimeout(45 * 60_000)
  mkdirSync(OUT, { recursive: true })
  const started = Date.now()
  const sec = () => `${Math.round((Date.now() - started) / 1000)} с`
  await page.setViewportSize({ width: 1500, height: 950 })
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text().slice(0, 160)) })

  await page.goto(PORTAL)
  const composer = page.locator("[data-composer-input][contenteditable='true']").first()
  await expect(composer, 'композер портала').toBeVisible({ timeout: 60_000 })
  await composer.click()
  await page.keyboard.type(REQUEST)
  await page.getByRole('button', { name: 'Отправить' }).click()
  const pin = page.getByText(/Заявка #\d+ зарегистрирована в беклоге/).first()
  await expect(pin, 'заявка в беклоге').toBeVisible({ timeout: 15_000 })
  const taskId = /#(\d+)/.exec((await pin.textContent()) ?? '')?.[1] ?? ''
  console.log(`▸ заявка #${taskId} (${sec()})`)

  // Вопросы формы — пока не появится сценарий приёмки (живая модель: число вопросов не фиксировано).
  const card = page.getByText('Как я буду принимать работу')
  const form = page.locator('textarea, [role="radiogroup"]').filter({ visible: true }).first()
  for (let round = 0; round < 8; round++) {
    const which = await Promise.race([
      card.waitFor({ timeout: 8 * 60_000 }).then(() => 'card'),
      form.waitFor({ timeout: 8 * 60_000 }).then(() => 'form'),
    ])
    if (which === 'card') break
    await answerForm(page, round)
  }
  await expect(card, 'сценарий приёмки').toBeVisible({ timeout: 8 * 60_000 })
  await page.screenshot({ path: `${OUT}/live-1-acceptance.png` })
  console.log(`▸ сценарий приёмки (${sec()})`)
  await page.getByRole('button', { name: 'Согласую' }).click()

  // Первичные требования (fast) — в правой панели; блоки из памяти организации.
  const doc = page.frameLocator('iframe[data-customer-bft]')
  await expect(doc.getByRole('heading', { name: new RegExp(`\\[БФТ\\] zayavka-${taskId}`) }), 'документ fast').toBeVisible({ timeout: 10 * 60_000 })
  console.log(`▸ первичные требования (${sec()})`)
  await expect(doc.getByRole('heading', { name: 'How to demo' }), 'How to demo').toBeVisible()
  const zones = doc.getByRole('heading', { name: 'Чьи зоны затрагивает и к кому обращаться' })
  await expect(zones, 'зоны влияния — из памяти').toBeVisible()
  await expect(doc.getByText(/память организации/).first(), 'пометка «память организации»').toBeVisible()
  await expect(doc.getByText(/демо/), 'память настоящая, не демо').toHaveCount(0)
  await page.screenshot({ path: `${OUT}/live-2-fast.png` })
  const sessionId = (await page.locator('iframe[data-customer-bft]').getAttribute('data-customer-bft')) ?? ''
  expect(sessionId, 'сессия заявки').not.toBe('')

  // «Да, согласен» на странице документа → полный БФТ.
  await doc.locator('#csYes').click({ timeout: 60_000 })
  await expect(doc.locator('#csYes'), 'согласовано').toHaveText(/Согласовано/, { timeout: 30_000 })
  console.log(`▸ согласовано, собирается полный БФТ (${sec()})`)
  let stage = 'building'
  for (let i = 0; i < 25 * 6 && stage === 'building'; i++) {
    await page.waitForTimeout(10_000)
    const res = await request.get(`${PORTAL}/api/customer-form.bftDeepStatus?session=${encodeURIComponent(sessionId)}`)
    stage = ((await res.json()) as { stage: string }).stage
    if (i % 6 === 5) console.log(`  … полный БФТ: ${stage} (${sec()})`)
    if (stage === 'none') stage = 'building'
  }
  expect(stage, 'полный БФТ собран').toBe('ready')
  await expect(doc.getByText('Полный БФТ · по согласованным первичным требованиям'), 'полный БФТ в панели').toBeVisible({ timeout: 120_000 })
  for (const head of ['Проблема которую решаем', 'Функциональные требования*', 'Якоря истины']) {
    await expect(doc.getByRole('heading', { name: head, exact: true }), `раздел «${head}»`).toBeVisible()
  }
  await page.screenshot({ path: `${OUT}/live-3-deep.png`, fullPage: false })
  console.log(`▸ полный БФТ готов (${sec()})`)

  const download = async (which: 'fast' | 'deep') => {
    const res = await request.get(`${PORTAL}/api/customer-form.bftDownload?session=${encodeURIComponent(sessionId)}&doc=${which}&format=md`)
    expect(res.status(), `скачать ${which}.md`).toBe(200)
    const text = await res.text()
    writeFileSync(`${OUT}/live-${which}.md`, text)
    return text
  }
  const deep = await download('deep')
  await download('fast')
  expect(deep.length, 'полный БФТ не пустой').toBeGreaterThan(5_000)
  writeFileSync(`${OUT}/live-run.json`, JSON.stringify({
    taskId, slug: `zayavka-${taskId}`, sessionId, request: REQUEST, seconds: Math.round((Date.now() - started) / 1000),
  }, null, 2))
})
