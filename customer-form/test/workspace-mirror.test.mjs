// Заявки в «Файлах рабочей области» портала (workspace-mirror.ts) и русские названия чатов (session-title.ts).
// Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// FAST_ROOT и реестр сценариев читают DSH_HOME при загрузке модулей — задаём до импорта.
const HOME = mkdtempSync(join(tmpdir(), 'mirror-'))
process.env.DSH_HOME = HOME
const mirror = await import('../lib-test/workspace-mirror.js')
const { sharedDemos } = await import('../lib-test/demo.js')
const titles = await import('../lib-test/session-title.js')

test.after(() => rmSync(HOME, { recursive: true, force: true }))

test('имя папки: «Заявка N — название», без запрещённых символов, длинное — по границе слова', () => {
  assert.equal(mirror.folderName(12, 'Промокоды за покупку через PartnerX'), 'Заявка 12 — Промокоды за покупку через PartnerX')
  assert.equal(mirror.folderName(3, '  Отчёт: план/факт?  '), 'Заявка 3 — Отчёт план факт')
  assert.equal(mirror.folderName(5, undefined), 'Заявка 5')
  const long = mirror.folderName(7, 'слово '.repeat(30))
  assert.ok(long.endsWith('…') && long.length < 90, long)
})

test('папка своей заявки: «Заявка 1» не путается с «Заявка 12»', () => {
  assert.ok(mirror.isFolderOf(1, 'Заявка 1'))
  assert.ok(mirror.isFolderOf(1, 'Заявка 1 — Промокоды'))
  assert.ok(!mirror.isFolderOf(1, 'Заявка 12 — Промокоды'))
  assert.ok(!mirror.isFolderOf(1, 'Заявка 12'))
})

test('название: сдача заявки → документ fast → первая строка обращения', () => {
  assert.equal(mirror.requestTitle({ title: 'Из сдачи' }, 'Из fast', 'Текст'), 'Из сдачи')
  assert.equal(mirror.requestTitle({}, 'Из fast', 'Текст'), 'Из fast')
  assert.equal(mirror.requestTitle(undefined, undefined, '\n  Нужны промокоды  \nещё строка'), 'Нужны промокоды')
  assert.equal(mirror.requestTitle(undefined, undefined, ''), undefined)
})

test('запрос заказчика: дословная цитата, понимание ассистента и где сейчас заявка', () => {
  const md = mirror.requestMarkdown({
    taskId: 9, title: 'Промокоды', firstText: 'Хочу промокоды\nза покупку', fastBuilt: true, fastApprovedAt: '2026-11-18T10:00:00Z',
    intake: { summary: 'Промокод после оплаты', gap: 'Нет повторных покупок', openQuestions: ['Срок действия промокода'] },
  })
  assert.match(md, /^# Заявка 9 — Промокоды/)
  assert.match(md, /> Хочу промокоды\n> за покупку/)
  assert.match(md, /## Суть\n\nПромокод после оплаты/)
  assert.match(md, /## Открытые вопросы\n\n- Срок действия промокода/)
  assert.match(md, /Первичные требования: согласованы/)
  assert.match(md, /Сценарий приёмки: ещё не составлен/)
  assert.doesNotMatch(md, /## ASIS/)
})

test('папка заявки: запрос, сценарий, fast; переименование по названию; документы копиями', async () => {
  const taskId = 41
  const sessionId = 'session-mirror-1'
  // Регистрация: только первое сообщение.
  const dir1 = await mirror.mirrorRequest(taskId, sessionId, 'Нужны промокоды за покупку билетов')
  assert.equal(dir1, join(HOME, 'Customer-requests', 'Заявка 41 — Нужны промокоды за покупку билетов'))
  assert.deepEqual(readdirSync(dir1), [mirror.MIRROR_FILES.request])
  assert.ok(existsSync(join(HOME, 'bft-fast', 'zayavka-41', 'request.txt')))

  // Сценарий, сдача (название), документ fast.
  sharedDemos().set(sessionId, { rev: 1, approvedAt: '2026-11-18T09:00:00Z', demo: { title: 'Промокод в письме', where: 'почта', steps: [{ screen: 'Почта', action: 'Открываю письмо', expect: 'Вижу промокод' }], done: ['Вижу промокод'] } })
  const fastDir = join(HOME, 'bft-fast', 'zayavka-41')
  writeFileSync(join(fastDir, 'intake.json'), JSON.stringify({ title: 'Промокоды за покупку через PartnerX', summary: 'Промокод после оплаты' }))
  writeFileSync(join(fastDir, 'zayavka-41-fast.md'), '# Первичные требования\n')
  writeFileSync(join(fastDir, 'sources.md'), '# Карта находок\n')
  const dir2 = await mirror.mirrorRequest(taskId, sessionId)
  assert.equal(dir2, join(HOME, 'Customer-requests', 'Заявка 41 — Промокоды за покупку через PartnerX'))
  assert.ok(!existsSync(dir1), 'старая папка переименована, а не оставлена рядом')
  const files = readdirSync(dir2).sort()
  assert.deepEqual(files, [mirror.MIRROR_FILES.request, mirror.MIRROR_FILES.sources, mirror.MIRROR_FILES.fast, mirror.MIRROR_FILES.demo].sort())
  assert.match(readFileSync(join(dir2, mirror.MIRROR_FILES.request), 'utf8'), /> Нужны промокоды за покупку билетов/)
  assert.match(readFileSync(join(dir2, mirror.MIRROR_FILES.demo), 'utf8'), /Согласован заказчиком/)
  assert.equal(readFileSync(join(dir2, mirror.MIRROR_FILES.fast), 'utf8'), '# Первичные требования\n')

  // Полный БФТ — только готовый и только после согласования fast.
  writeFileSync(join(fastDir, 'zayavka-41.md'), '# БФТ\n')
  writeFileSync(join(fastDir, 'deep.json'), JSON.stringify({ stage: 'ready', startedAt: '2026-11-18T10:00:00Z' }))
  await mirror.mirrorRequest(taskId, sessionId)
  assert.ok(!existsSync(join(dir2, mirror.MIRROR_FILES.deep)), 'fast не согласован — полного БФТ в папке нет')

  // Чужие файлы в workspace не трогаем; временных файлов в нём нет.
  mkdirSync(join(HOME, 'Customer-requests', 'Заявка 4 — чужая'), { recursive: true })
  await mirror.mirrorAll([{ taskId, sessionId }])
  assert.ok(existsSync(join(HOME, 'Customer-requests', 'Заявка 4 — чужая')))
  assert.ok(readdirSync(join(HOME, 'Customer-requests')).every((name) => name.startsWith('Заявка ')))
})

test('название чата: «Заявка #N — …» по-русски, без службы — ничего', () => {
  assert.equal(titles.requestSessionTitle(12, 'Промокоды за покупку'), 'Заявка #12 — Промокоды за покупку')
  assert.equal(titles.requestSessionTitle(12), 'Заявка #12')
  assert.equal(titles.requestSessionTitle(3, 'первая строка\nвторая'), 'Заявка #3 — первая строка')
  const renamed = []
  titles.titleSession({ id: 's' }, 1, 'Без службы')
  titles.useSessionTitles({ rename: (_s, t) => renamed.push(t), get: () => ({ title: 'Заявка #1 — Уже так' }) })
  titles.titleSession({ id: 's' }, 1, 'Уже так')
  titles.titleSession({ id: 's' }, 1, 'Новое')
  titles.useSessionTitles(undefined)
  assert.deepEqual(renamed, ['Заявка #1 — Новое'])
})
