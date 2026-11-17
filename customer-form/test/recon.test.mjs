// Разведка: запросы с предметом заявки, фильтр Кортекса, карта для модели (план качества, C3 и C4).
// Запуск: npm test (tsc в lib-test, затем node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coreQueries, fixQueries, nameQueries, reconSubject, sourcesForModel, subjectNoun, titleNouns } from '../lib-test/bft-deep.js'
import { relevantBrief, contextMapMarkdown } from '../lib-test/cortex.js'
import { contentTerms } from '../lib-test/stems.js'

const FAST = [
  '---', 'stage: fast', '---', '',
  '# [БФТ] zayavka-1: Абонемент в фитнес-клуб через мобильное приложение',
  '| A (Achievable) | Видение заказчика: «…» · Команды: Касса Fitly, CRM (карточка клиента), [УТОЧНИТЬ] · Специалисты: PO |',
  '<!-- BFT-HEAD-END · ГРАНИЦА ШАПКИ · выше bft-fast, ниже bft-deep · шапку не затирать -->',
  'ниже границы: Команды: Чужая',
].join('\n')

test('предмет заявки: название и системы из «Команды:» шапки, без пояснений в скобках', () => {
  assert.deepEqual(reconSubject(FAST), { title: 'Абонемент в фитнес-клуб через мобильное приложение', systems: ['Касса Fitly', 'CRM'], object: 'Абонемент' })
  assert.equal(subjectNoun('Абонемент в фитнес-клуб'), 'Абонемент')
  assert.equal(subjectNoun('Согласование абонемента'), 'абонемента')
})

test('запросы: первым голое название, запрос без якоря получает предмет, дубли — вон, не больше шести', () => {
  const subject = reconSubject(FAST)
  const out = fixQueries(['маршрут согласования руководитель', 'Касса Fitly оплата', 'абонемент продление', 'АБОНЕМЕНТ ПРОДЛЕНИЕ', 'CRM', 'карта клиента', 'ещё запрос'], subject)
  assert.equal(out[0], subject.title)
  // Раунд 5: ядро «объект + система» — сразу за названием, до запросов модели.
  assert.deepEqual(out.slice(1, 3), ['Абонемент Fitly', 'Абонемент CRM'])
  assert.ok(out.includes('маршрут согласования руководитель Абонемент'))
  assert.ok(out.includes('Касса Fitly оплата'))
  assert.ok(!out.includes('CRM'), 'второй запрос только о платформе — вон')
  assert.equal(out.filter((q) => q.toLowerCase() === 'абонемент продление').length, 1)
  assert.ok(out.length <= 6)
  // Модель не ответила — название и ядро.
  assert.deepEqual(fixQueries([], subject), [subject.title, 'Абонемент Fitly', 'Абонемент CRM'])
})

test('раунд 4: короткие запросы по именам из названия — «объект + Продукт» и пара имён; без имён — ничего', () => {
  // Длинное название в JQL ищет все слова сразу; эпик про тот же поток без слова «скидка» им не находится.
  assert.deepEqual(nameQueries('Скидка RideGo за поездку через агрегатор CityMove'), ['Скидка RideGo', 'агрегатор CityMove', 'RideGo CityMove'])
  assert.deepEqual(nameQueries('Электронная заявка на аренду в портале'), [])
  assert.deepEqual(nameQueries('Выгрузка в 1С:ЗУП'), [])
  const out = fixQueries(['скидка RideGo', 'поездки агрегатора'], { title: 'Скидка RideGo за поездку через агрегатор CityMove', systems: [] })
  // Раунд 5: «{признак} {Платформа}» («агрегатор CityMove») — запрос о платформе, не о заявке; ядро — объект с каждым именем.
  assert.deepEqual(out.slice(0, 3), ['Скидка RideGo за поездку через агрегатор CityMove', 'Скидка RideGo', 'Скидка CityMove'])
  assert.ok(!out.includes('агрегатор CityMove'))
  assert.ok(out.includes('поездки агрегатора'))
  assert.equal(out.filter((q) => q.toLowerCase() === 'скидка ridego').length, 1)
})

test('процессные слова не дают якоря; аббревиатуры и латиница — целиком', () => {
  assert.deepEqual(contentTerms(['согласование маршрута руководителем']), [])
  assert.deepEqual(contentTerms(['1С:ЗУП TicketsCloud']).map((t) => t.key), ['1с', 'зуп', 'ticketscloud'])
})

const node = (id, title, summary = '', owner) => ({ node_id: id, title, summary, sources: [], ...(owner ? { owner } : {}) })

test('Кортекс: остаются узлы по теме, зоны — заново из оставшихся, владельцы систем — отдельно', () => {
  const brief = {
    vault: { name: 'v', nodes: 10, demo: false },
    people: [
      { ...node('p-1', 'Иванов'), name: 'Иванов', role: 'владелец кассы', zones: ['касса'], contact_for: [] },
      { ...node('p-2', 'Петров'), name: 'Петров', role: 'CTO стрима', zones: ['шлюзы'], contact_for: [] },
    ],
    processes: [node('pr-1', 'Продажа абонемента в кассе Fitly', 'как продают'), node('pr-2', 'Контроль инициатив', 'общий процесс')],
    domains: [{ owner: 'Иванов', zones: ['касса'], nodes: ['pr-1'] }, { owner: 'Петров', zones: ['шлюзы'], nodes: ['sys-2'] }],
    landscape: [
      { ...node('sys-1', 'Касса Fitly: абонементы', 'касса клуба', 'Иванов'), where_to_check: ['стенд'], environments: [] },
      { ...node('sys-2', 'Перевод шлюзов', 'шлюзы', 'Петров'), where_to_check: [], environments: [] },
    ],
  }
  const kept = relevantBrief(brief, 'Абонемент в фитнес-клуб: продажа в кассе Fitly')
  assert.deepEqual(kept.processes.map((p) => p.node_id), ['pr-1'])
  assert.deepEqual(kept.landscape.map((s) => s.node_id), ['sys-1'])
  assert.deepEqual(kept.domains.map((d) => d.owner), ['Иванов'])
  assert.deepEqual(kept.people.map((p) => p.name), ['Иванов'])
  const md = contextMapMarkdown(kept, 'z')
  assert.match(md, /## Владельцы систем\n\n- Касса Fitly: абонементы → Иванов/)
  assert.doesNotMatch(md, /шлюз/)
  const empty = contextMapMarkdown(relevantBrief(brief, 'Отпуск сотрудника'), 'z')
  assert.match(empty, /Память по этой теме ничего не знает/)
})

test('карта для модели — без хвоста «Отсеяно триажем»', () => {
  const md = '# Корпоративные источники\n\n## A-1 · x\nJira\nСсылка для БФТ: [Jira A-1](u)\n\n## Отсеяно триажем (не использовать)\n\n- B-1 · чужое\n'
  assert.doesNotMatch(sourcesForModel(md), /Отсеяно|B-1/)
  assert.match(sourcesForModel(md), /A-1/)
  assert.equal(sourcesForModel('# x\n'), '# x\n')
})

test('карта data-sources с триажем разбирается проверками портала: вердикт, второй шаг, отсеянные', async () => {
  const { readFileSync } = await import('node:fs')
  const { droppedSources, parseSources } = await import('../lib-test/canon-check.js')
  // Вывод findingsMarkdown плагина data-sources (сгенерирован его кодом) — контракт двух пакетов.
  const md = readFileSync(new URL('./fixtures/sources-triaged.md', import.meta.url), 'utf8')
  const parsed = parseSources(md)
  assert.deepEqual(parsed.map((f) => [f.id, f.relevance, f.via, f.type]), [
    ['KP-1', 'same_function', undefined, 'Ошибка (дефект)'],
    ['9', 'adjacent', undefined, 'Страница вики'],
    ['10', undefined, 'KP-1', 'Страница вики'],
  ])
  assert.equal(parsed[0].container, 'KP')
  assert.equal(droppedSources(md), 1)
  assert.doesNotMatch(sourcesForModel(md), /KP-2/)
})

test('раунд 5: ядро запросов — объект с каждой названной системой; прилагательное — не объект; модель ядро не вытесняет', () => {
  assert.equal(subjectNoun('Электронное заявление на аренду в портале'), 'заявление')
  assert.deepEqual(titleNouns('Электронное заявление на аренду в портале'), ['заявление', 'аренду'])
  const one = { title: 'Электронное заявление на аренду в портале', systems: ['Команда портала', 'Команда 1С:ЗУП'] }
  assert.deepEqual(coreQueries(one), ['заявление 1С:ЗУП', 'аренду 1С:ЗУП'])
  const many = { title: 'Скидка RideGo за поездку через агрегатор CityMove', systems: ['RideGo BE', 'ЛОЯЛ', 'CityMove (поток заказов)'] }
  const core = coreQueries(many)
  assert.deepEqual(core, ['Скидка RideGo', 'Скидка CityMove', 'Скидка ЛОЯЛ'])
  const raw = ['агрегатор CityMove', 'поток заказов CityMove', 'скидка лояльность ЛОЯЛ', 'RideGo', 'скидка за поездку', 'ещё скидка', 'и ещё скидка']
  const out = fixQueries(raw, many)
  for (const q of core) assert.ok(out.includes(q), q)
  for (const name of ['RideGo', 'CityMove', 'ЛОЯЛ']) assert.ok(out.some((q) => q.includes(name)), name)
  assert.equal(out.filter((q) => !/скидк/i.test(q) && /RideGo|CityMove|ЛОЯЛ/.test(q)).length, 1, 'запрос только о платформе — не больше одного')
  assert.ok(out.length <= 6)
})
