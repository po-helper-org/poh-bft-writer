import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatOkrPlan, okrHandoffArgs, parseOkrHandoff, quarterOptions, type OkrHandoff,
} from '../src/okr-handoff.js'

const FORM = {
  confluence: 'https://confluence.mts.ru/pages/viewpage.action?pageId=1',
  epic: 'https://jira.mts.ru/browse/GDSLV-1',
  quarter: '2026-Q4',
  stages: {
    research: { sprint: null, resources: '' },
    analyze: { sprint: 2, resources: 'SA' },
    dev: { sprint: 3, resources: 'BE' },
    qa: { sprint: 4, resources: '' },
    release: { sprint: null, resources: 'RM' },
  },
  teams: 'GDS/Платформа',
  techLeads: '',
  executors: 'Иванов',
  comment: 'Ждём Финтех',
}

function parsed(body: unknown): OkrHandoff {
  const result = parseOkrHandoff(body)
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  return result.ok ? result.value : (undefined as never)
}

test('форма разбирается: строки обрезаются, план и комментарий как есть', () => {
  const value = parsed({ ...FORM, teams: '  GDS/Платформа ', comment: ' Ждём Финтех ' })
  assert.equal(value.teams, 'GDS/Платформа')
  assert.equal(value.comment, 'Ждём Финтех')
  assert.deepEqual(value.stages.analyze, { sprint: 2, resources: 'SA' })
})

test('без ссылок и квартала в OKR не передаётся — причина словами', () => {
  const cases: Array<[unknown, RegExp]> = [
    [null, /форма/],
    [{ ...FORM, confluence: '' }, /Confluence/],
    [{ ...FORM, epic: 'GDSLV-1' }, /эпик/],
    [{ ...FORM, quarter: 'Q4 2026' }, /2026-Q3/],
    [{ ...FORM, stages: { ...FORM.stages, dev: { sprint: 6, resources: '' } } }, /dev/],
  ]
  for (const [body, reason] of cases) {
    const result = parseOkrHandoff(body)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, reason)
  }
})

test('план и стадии необязательны: пустая форма со ссылками и кварталом проходит', () => {
  const value = parsed({ confluence: FORM.confluence, epic: FORM.epic, quarter: '2027-Q1' })
  assert.deepEqual(value.stages.research, { sprint: null, resources: '' })
  assert.equal(value.comment, '')
  assert.equal(formatOkrPlan(value), 'quarter: 2027-Q1')
})

test('блок плана — формат карточки KR плагина OKR плюс квартал; пустые фазы не пишутся', () => {
  assert.equal(formatOkrPlan(parsed(FORM)), [
    'quarter: 2026-Q4',
    'analyze: спринт 3 / SA',
    'dev: спринт 4 / BE',
    'qa: спринт 5',
    'release: — / RM',
    'teams: GDS/Платформа',
    'executors: Иванов',
  ].join('\n'))
})

test('одна команда task edit: стадия, план, комментарий к заметкам и только недостающие ссылки', () => {
  const args = okrHandoffArgs('PO-140', parsed(FORM), ['bft/documentation/po-140/po-140.html', FORM.epic.toUpperCase()])
  assert.deepEqual(args, [
    'task', 'edit', 'PO-140', '-s', 'OKR-ADDED',
    '--plan', formatOkrPlan(parsed(FORM)),
    '--append-notes', 'OKR: Ждём Финтех',
    '--add-ref', FORM.confluence,
    '--plain',
  ])
})

test('без комментария заметки не трогаются', () => {
  const args = okrHandoffArgs('PO-1', parsed({ ...FORM, comment: '' }), [])
  assert.equal(args.includes('--append-notes'), false)
})

test('кварталы на выбор — текущий и следующие, через границу года', () => {
  assert.deepEqual(quarterOptions(new Date('2026-09-15T12:00:00Z'), 3), ['2026-Q3', '2026-Q4', '2027-Q1'])
  assert.deepEqual(quarterOptions(new Date('2026-01-02T12:00:00Z'), 2), ['2026-Q1', '2026-Q2'])
})
