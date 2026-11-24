// ИИ-агент правок полного БФТ (ADR-0021, ADR-0024): замечание → правка раздела «найти → заменить» → проверки → страница, откат.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { applyEdits, applyScoped, canUndo, dshModel, mdSections, mergeResults, newErrors, newRevision, normalizeRemarks, parseEdits, queueRemarks, reviewDue, reviewPrompt, revisePrompt, reviseDeep, revisionsContext, scopeFor, sinceReview, undoRevision } from '../lib-test/bft-revise.js'
import { withAgent } from '../lib-test/agent-page.js'
import { check, checkContext } from '../lib-test/canon-check.js'

const SKILLS = resolve(import.meta.dirname, '../../skills')
const GOLDEN = join(SKILLS, 'bft-deep-swarm/examples/golden_deep_document.md')
const RISK_ROW = '| Состав технических развилок реализации блока не определён, оценка и слот разработки не подтверждены | Средняя | Высокое | Иван Орлов собирает развилки и даёт оценку до старта спринта; подтверждено PO на созвоне 08.07.2026 |'
const NEW_RISK = '| Фичефриз перед новым годом сдвигает выпуск | [УТОЧНИТЬ у PO: оценка вероятности?] | [УТОЧНИТЬ у PO: оценка влияния?] | [УТОЧНИТЬ у PO: план до фичефриза?] |'

test('замечания: обрезка, пустые мимо, лимиты', () => {
  assert.deepEqual(normalizeRemarks([{ section: ' Риски ', quote: ' «x» ', text: ' добавь риск ' }, { text: '  ' }]), [{ section: 'Риски', quote: '«x»', text: 'добавь риск' }])
  assert.equal(normalizeRemarks([]), 'нет замечаний')
  assert.match(normalizeRemarks(Array.from({ length: 31 }, () => ({ text: 'a' }))), /не больше 30/)
  assert.match(normalizeRemarks([{ text: 'x'.repeat(2001) }]), /длиннее/)
  assert.deepEqual(normalizeRemarks([{ text: 'без раздела' }]), [{ section: 'Документ', text: 'без раздела' }])
})

test('ответ модели → правки и отчёт; правка — только по уникальному фрагменту', () => {
  const answer = ['Вот правки.', '@@@ ПРАВКА', '<<<', 'строка А', '===', 'строка А2', '>>>', '@@@ ПРАВКА', '<<<', 'дубль', '===', '', '>>>',
    '@@@ ПРАВКА', '<<<', 'нет такой', '===', 'x', '>>>', '@@@ ОТЧЁТ', '```json', '[{"n":1,"status":"applied","note":"заменил"},{"n":2,"status":"bogus"}]', '```'].join('\n')
  const { edits, results } = parseEdits(answer)
  assert.equal(edits.length, 3)
  assert.deepEqual(edits[1], { find: 'дубль', replace: '' })
  assert.deepEqual(results, [{ n: 1, status: 'applied', note: 'заменил' }])
  const applied = applyEdits('строка А\nдубль\nдубль\n', edits)
  assert.equal(applied.doc, 'строка А2\nдубль\nдубль\n')
  assert.equal(applied.applied, 1)
  assert.deepEqual(applied.failed.map((f) => f.split(':')[0]), ['встречается не один раз', 'не найден'])
})

test('итог по замечаниям — последний круг главнее; без отчёта — «не отчитался»', () => {
  const merged = mergeResults(3, [[{ n: 1, status: 'skipped', note: 'не нашёл' }, { n: 2, status: 'applied', note: 'ok' }], [{ n: 1, status: 'applied', note: 'со второго раза' }]])
  assert.deepEqual(merged.map((r) => r.status), ['applied', 'applied', 'skipped'])
  assert.match(merged[2].note, /не отчитался/)
})

test('новые ошибки — только те, которых не было до правки', () => {
  const before = [{ code: 'CN001', level: 'ERROR', message: 'старое' }, { code: 'W1', level: 'WARN', message: 'w' }]
  const after = [{ code: 'CN001', level: 'ERROR', message: 'старое' }, { code: 'CT002', level: 'ERROR', message: 'новое' }, { code: 'W2', level: 'WARN', message: 'w2' }]
  assert.deepEqual(newErrors(before, after).map((f) => f.code), ['CT002'])
})

test('промт: замечания с номерами, документ без frontmatter, повтор — с причинами', () => {
  const p = revisePrompt('---\na: 1\n---\n# Док\n', [{ section: 'Риски', quote: 'фрагмент', text: 'добавь' }], { failed: ['не найден: «x»'], errors: ['ERROR CT002 y'] })
  assert.match(p.user, /1\. \[Риски\] \(по фрагменту: «фрагмент»\) добавь/)
  assert.ok(!p.user.includes('a: 1'))
  assert.match(p.user, /ДОПОЛНИТЕЛЬНЫЕ правки[\s\S]*не найден: «x»[\s\S]*ERROR CT002/)
  assert.match(p.system, /@@@ ПРАВКА/)
})

test('правки PO уходят в контекст полной пересборки', () => {
  const r = { ...newRevision([{ section: 'Риски', text: 'фичефриз' }], 'Алексей'), stage: 'ready', results: [{ n: 1, status: 'applied', note: 'строка в Рисках' }] }
  const failed = { ...newRevision([{ section: 'X', text: 'не вошло' }]), stage: 'failed' }
  const ctx = revisionsContext([r, failed])
  assert.match(ctx, /^Правки PO к прошлой версии/)
  assert.match(ctx, /\[Риски\] фичефриз → строка в Рисках \(Алексей\)/)
  assert.ok(!ctx.includes('не вошло'))
  assert.equal(revisionsContext([failed]), '')
})

/** Папка заявки с полным БФТ (эталон навыка) и страницей ревью. */
async function request() {
  const dir = await mkdtemp(join(tmpdir(), 'revise-'))
  const fast = { dir, md: join(dir, 'golden-fast.md'), html: join(dir, 'golden-fast.html'), personas: '', requirements: '', approval: join(dir, 'approval.json'), primary: join(dir, 'primary.json'), contextMap: '' }
  await copyFile(GOLDEN, fast.md)
  await copyFile(GOLDEN, join(dir, 'golden.md'))
  await writeFile(join(dir, 'golden.html'), '<html>старая</html>')
  await writeFile(join(dir, 'deep.json'), JSON.stringify({ stage: 'ready', startedAt: '2026-11-20T10:00:00Z', finishedAt: '2026-11-20T10:10:00Z' }))
  return fast
}
const fakeLlm = (answers) => {
  const calls = []
  return {
    calls,
    prepareCall: async () => ({
      config: {},
      stream: (opts) => (async function* () {
        calls.push(opts.messages[0].content[0].text)
        const text = answers[Math.min(calls.length - 1, answers.length - 1)]
        for (let i = 0; i < text.length; i += 500) yield { type: 'text-delta', text: text.slice(i, i + 500) }
        yield { type: 'finish', reason: 'stop' }
      })(),
    }),
  }
}
const edit = (find, replace) => `@@@ ПРАВКА\n<<<\n${find}\n===\n${replace}\n>>>`

test('правка документа: строка риска внесена, копия прежней версии, страница пересобрана, откат возвращает', { skip: !existsSync(GOLDEN) }, async () => {
  const fast = await request()
  const revision = newRevision([{ section: 'Риски', text: 'добавь фичефриз перед новым годом' }], 'Алексей')
  const llm = fakeLlm([`${edit(RISK_ROW, `${RISK_ROW}\n${NEW_RISK}`)}\n@@@ ОТЧЁТ\n[{"n":1,"status":"applied","note":"строка в Рисках"}]`])
  const progress = []
  const done = await reviseDeep({ model: dshModel(llm, { provider: 'x', model: 'y' }), skillsPath: SKILLS, fast, slug: 'golden', revision, onProgress: async (u) => { progress.push(u) } })
  assert.equal(done.stage, 'ready', done.error)
  assert.equal(done.edits, 1)
  assert.deepEqual(done.results.map((r) => r.status), ['applied'])
  assert.equal(done.scope, 'Риски')
  assert.deepEqual(done.changes, [{ find: RISK_ROW, replace: `${RISK_ROW}\n${NEW_RISK}` }])
  const md = await readFile(join(fast.dir, 'golden.md'), 'utf8')
  assert.ok(md.includes(NEW_RISK))
  assert.ok(!(await readFile(join(fast.dir, 'golden.html'), 'utf8')).includes('старая'), 'страница ревью пересобрана')
  assert.ok((await readdir(join(fast.dir, 'revisions'))).includes(`${revision.id}.md`), 'копия прежней версии')
  const deep = JSON.parse(await readFile(join(fast.dir, 'deep.json'), 'utf8'))
  assert.notEqual(deep.finishedAt, '2026-11-20T10:10:00Z')
  assert.ok(Array.isArray(deep.questions))
  assert.ok(progress.some((p) => p.stage === 'checking'))
  assert.match(llm.calls[0], /1\. \[Риски\] добавь фичефриз/)
  assert.ok(!llm.calls[0].includes('## Проблема которую решаем'), 'модель видит только свой раздел')
  assert.match(llm.calls[0], /Разделы документа:[\s\S]*- Проблема которую решаем/)
  await undoRevision(SKILLS, fast, 'golden', [done], done.id)
  assert.ok(!(await readFile(join(fast.dir, 'golden.md'), 'utf8')).includes(NEW_RISK), 'откат вернул прежнюю версию')
})

test('ненайденный фрагмент — второй круг; правка, ломающая шаблон, — документ не тронут', { skip: !existsSync(GOLDEN) }, async () => {
  const fast = await request()
  const before = await readFile(join(fast.dir, 'golden.md'), 'utf8')
  // 1-й круг: фрагмента нет → 2-й круг добирает.
  const two = fakeLlm([`${edit('нет такого фрагмента', 'x')}\n@@@ ОТЧЁТ\n[]`, `${edit(RISK_ROW, `${RISK_ROW}\n${NEW_RISK}`)}\n@@@ ОТЧЁТ\n[{"n":1,"status":"applied","note":"со второго круга"}]`])
  const ok = await reviseDeep({ model: dshModel(two, { provider: 'x', model: 'y' }), skillsPath: SKILLS, fast, slug: 'golden', revision: newRevision([{ section: 'Риски', text: 'фичефриз' }]), onProgress: async () => {} })
  assert.equal(ok.stage, 'ready', ok.error)
  assert.equal(two.calls.length, 2)
  assert.match(two.calls[1], /не найден: «нет такого фрагмента»/)
  // Удалить раздел целиком — шаблон ломается в обоих кругах → ошибка, документ прежний.
  const after = await readFile(join(fast.dir, 'golden.md'), 'utf8')
  const breaking = fakeLlm([`${edit('## Риски', '## Что-то другое')}\n@@@ ОТЧЁТ\n[]`])
  await assert.rejects(reviseDeep({ model: dshModel(breaking, { provider: 'x', model: 'y' }), skillsPath: SKILLS, fast, slug: 'golden', revision: newRevision([{ section: 'Риски', text: 'переименуй' }]), onProgress: async () => {} }), /не прошли проверку шаблона/)
  assert.equal(await readFile(join(fast.dir, 'golden.md'), 'utf8'), after)
  assert.notEqual(after, before)
})

test('колонка агента: перед </body>, адреса и ключ замечаний, конфиг не ломает скрипт', () => {
  const page = withAgent('<html><body><main>док</main></body></html>', { sessionId: 's</script><b>', store: 'bft-comments-zayavka-1', reviseUrl: 'customer-form.bftRevise', statusUrl: 'customer-form.bftReviseStatus', undoUrl: 'customer-form.bftReviseUndo', sectionUrl: 'customer-form.bftReviseSection', reviewUrl: 'customer-form.bftReview', deepAt: null })
  assert.ok(page.indexOf('id="bftAgentBtn"') < page.indexOf('</body>'))
  assert.match(page, /"store":"bft-comments-zayavka-1"/)
  assert.ok(!page.includes('s</script><b>'))
  assert.match(page, /Отправить ИИ-агенту/)
  assert.match(page, /Проведите полное ревью требований для согласованности/)
  assert.match(page, /"sectionUrl":"customer-form.bftReviseSection"/)
})

const DOC = ['---', 'a: 1', '---', '# Док', 'вступление', '## Проблема которую решаем', 'текст про витрину', '## Функциональные требования', '| ФТ-1 | витрина | x |', '| ФТ-2 | отчёт | y |', '```', '## не заголовок', '```', '## Риски', '| r | — | — | — |', ''].join('\n')

test('разделы: ## вне ```, раздел замечания — по заголовку, строке или цитате; «Документ» без цитаты — весь', () => {
  assert.deepEqual(mdSections(DOC).map((s) => s.title), ['', 'Проблема которую решаем', 'Функциональные требования', 'Риски'])
  const title = (r) => scopeFor(DOC, r).map((s) => s.title)
  assert.deepEqual(title({ section: 'Риски', text: 'x' }), ['Риски'])
  assert.deepEqual(title({ section: 'Функциональные требования* · ФТ-2', text: 'x' }), ['Функциональные требования'])
  assert.deepEqual(title({ section: 'Документ', quote: 'про витрину', text: 'x' }), ['Проблема которую решаем'])
  assert.deepEqual(title({ section: 'Документ', text: 'x' }), [])
  assert.deepEqual(title({ section: 'Документ', text: 'В разделе «Риски» добавь риск' }), ['Риски'])
  assert.deepEqual(title({ section: 'Нет такого', text: 'x' }), [])
})

test('правка в пределах раздела: уникальность — в разделе, чужой раздел не трогается', () => {
  const doc = DOC.replace('| r | — | — | — |', '| r | — | — | — |\n| ФТ-2 | отчёт | y |')
  const risks = scopeFor(doc, { section: 'Риски', text: 'x' })
  const out = applyScoped(doc, risks, [{ find: '| ФТ-2 | отчёт | y |', replace: '| ФТ-2 | отчёт | z |' }, { find: 'текст про витрину', replace: 'чужое' }])
  assert.equal(out.applied, 1)
  assert.match(out.failed[0], /не найден/)
  assert.ok(out.doc.includes('| ФТ-2 | отчёт | y |\n```'), 'строка в ФТ не тронута')
  assert.ok(out.doc.endsWith('| ФТ-2 | отчёт | z |\n'))
  assert.deepEqual(out.changes, [{ find: '| ФТ-2 | отчёт | y |', replace: '| ФТ-2 | отчёт | z |' }])
  // Весь документ: frontmatter не правится.
  assert.equal(applyScoped(doc, [], [{ find: 'a: 1', replace: 'a: 2' }]).applied, 0)
})

test('очередь: одно замечание — одна задача; точка ревью — после локальных правок; откат — последней по копии, иначе обратной заменой', () => {
  const tasks = queueRemarks([{ section: 'Риски', text: 'a' }, { section: 'ФТ', text: 'b' }], 'PO')
  assert.equal(tasks.length, 2)
  assert.deepEqual(tasks.map((t) => [t.kind, t.stage, t.remarks.length]), [['revise', 'queued', 1], ['revise', 'queued', 1]])
  const ready = (r, extra) => ({ ...r, stage: 'ready', edits: 1, backup: `${r.id}.md`, ...extra })
  const a = ready(tasks[0], { changes: [{ find: 'x', replace: 'x2' }] })
  const b = ready(tasks[1], { changes: [{ find: 'y', replace: '' }] })
  assert.equal(reviewDue([a, b]), true)
  assert.deepEqual(sinceReview([a, b]).map((r) => r.id), [a.id, b.id])
  assert.equal(canUndo([a, b], b.id), true, 'последняя — по копии')
  assert.equal(canUndo([a, b], a.id), true, 'из середины — обратной заменой')
  const c = ready(newRevision([{ section: 'X', text: 'c' }]), { changes: [{ find: 'z', replace: '' }] })
  assert.equal(canUndo([c, a], c.id), false, 'удаление из середины обратной заменой не найти')
  const review = { ...newRevision([], 'PO', 'review'), stage: 'ready', edits: 0 }
  assert.equal(reviewDue([a, b, review]), false)
  const undo = { ...newRevision([], 'PO', 'undo'), stage: 'ready', undoOf: b.id }
  assert.equal(canUndo([a, b, undo], b.id), false, 'откаченное второй раз не откатить')
  assert.match(reviewPrompt('# Док\n', [a]).user, /Локальные правки с прошлого ревью:\n- \[Риски\] a/)
})

test('правки подряд: вторая знает изменённые разделы страницы; откат первой из середины — обратной заменой', { skip: !existsSync(GOLDEN) }, async () => {
  const fast = await request()
  const first = newRevision([{ section: 'Риски', text: 'фичефриз' }])
  const one = await reviseDeep({ model: dshModel(fakeLlm([`${edit(RISK_ROW, `${RISK_ROW}\n${NEW_RISK}`)}\n@@@ ОТЧЁТ\n[{"n":1,"status":"applied","note":"ok"}]`]), { provider: 'x', model: 'y' }), skillsPath: SKILLS, fast, slug: 'golden', revision: first, onProgress: async () => {} })
  assert.equal(one.stage, 'ready', one.error)
  assert.equal(one.sections, undefined, 'прежней страницы не было — перезагрузка целиком')
  const SECOND = '| Второй риск от PO | [УТОЧНИТЬ у PO: вероятность?] | [УТОЧНИТЬ у PO: влияние?] | [УТОЧНИТЬ у PO: митигация?] |'
  const two = await reviseDeep({ model: dshModel(fakeLlm([`${edit(NEW_RISK, `${NEW_RISK}\n${SECOND}`)}\n@@@ ОТЧЁТ\n[{"n":1,"status":"applied","note":"ok"}]`]), { provider: 'x', model: 'y' }), skillsPath: SKILLS, fast, slug: 'golden', revision: newRevision([{ section: 'Риски', text: 'второй риск от PO' }]), onProgress: async () => {} })
  assert.equal(two.stage, 'ready', two.error)
  assert.equal(two.sections?.length, 1, 'изменился один раздел')
  const html = await readFile(join(fast.dir, 'golden.html'), 'utf8')
  assert.match(html, new RegExp(`<h2 id="${two.sections[0]}">[^<]*Риски`))
  // Откат первой: её вставка (строка NEW_RISK) с тех пор не менялась — вернуть RISK_ROW без неё.
  const res = await undoRevision(SKILLS, fast, 'golden', [one, two], one.id)
  const md = await readFile(join(fast.dir, 'golden.md'), 'utf8')
  assert.ok(!md.includes(NEW_RISK), 'первая правка отменена')
  assert.ok(md.includes(SECOND), 'вторая правка осталась')
  assert.deepEqual(res.sections, two.sections)
})

test('модель не ответила — правит запасная', { skip: !existsSync(GOLDEN) }, async () => {
  const fast = await request()
  const broken = { label: 'haiku', complete: async () => { throw new Error('нет ключа') } }
  const spare = dshModel(fakeLlm([`${edit(RISK_ROW, `${RISK_ROW}\n${NEW_RISK}`)}\n@@@ ОТЧЁТ\n[{"n":1,"status":"applied","note":"ok"}]`]), { provider: 'deep', model: 'm' })
  const done = await reviseDeep({ model: broken, fallback: spare, skillsPath: SKILLS, fast, slug: 'golden', revision: newRevision([{ section: 'Риски', text: 'фичефриз' }]), onProgress: async () => {} })
  assert.equal(done.stage, 'ready', done.error)
  assert.equal(done.model, 'deep · m')
})

test('риск, названный PO, — законная строка «Рисков» (RK003); без замечания PO — нет', { skip: !existsSync(GOLDEN) }, async () => {
  const golden = await readFile(GOLDEN, 'utf8')
  const doc = golden.replace(RISK_ROW, `${RISK_ROW}\n${NEW_RISK}`)
  const rk = (po) => check(doc, checkContext({ fastMd: golden, primary: { args: {} }, ...(po ? { po } : {}) })).errors.filter((f) => f.code === 'RK003' && /Фичефриз/.test(f.message))
  assert.equal(rk().length, 1, 'без слов PO строка риска без источника')
  assert.equal(rk(['Открытый риск: фичефриз перед новым годом сдвигает выпуск']).length, 0)
})
