import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BOARD_TRANSITIONS, TRANSITION_RULES, parseTransition, transitionArgs, transitionNote, transitionSummary,
  type TransitionRequest,
} from '../src/board-transition.js'

function parsed(body: unknown): TransitionRequest {
  const result = parseTransition(body)
  assert.equal(result.ok, true, result.ok ? '' : result.error)
  return result.ok ? result.value : (undefined as never)
}

test('переходы: влёт и отказ — с DEEP-DONE, готово — с OKR-ADDED; отказ только с комментарием', () => {
  assert.deepEqual(BOARD_TRANSITIONS, ['vlet', 'okrDone', 'cancel'])
  assert.deepEqual(TRANSITION_RULES.vlet, { from: 'DEEP-DONE', to: 'OKR-VLET', commentRequired: false, notePrefix: 'Влёт' })
  assert.deepEqual(TRANSITION_RULES.okrDone, { from: 'OKR-ADDED', to: 'OKR-DONE', commentRequired: false, notePrefix: 'OKR-DONE' })
  assert.deepEqual(TRANSITION_RULES.cancel, { from: 'DEEP-DONE', to: 'BFT-CANCELED', commentRequired: true, notePrefix: 'Причина' })
})

test('форма разбирается: строки обрезаются, неизвестный переход и пустое тело — словами', () => {
  const value = parsed({ kind: 'vlet', who: ' Иванов ', comment: ' горит у заказчика ' })
  assert.deepEqual(value, { kind: 'vlet', who: 'Иванов', comment: 'горит у заказчика' })

  for (const [body, reason] of [
    [null, /переход/],
    [{ kind: 'nope' }, /nope/],
    [{}, /неизвестный переход/],
  ] as Array<[unknown, RegExp]>) {
    const result = parseTransition(body)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.error, reason)
  }
})

test('отказ без «кто» или без основания не проходит; влёт и готово — проходят пустыми', () => {
  const noWho = parseTransition({ kind: 'cancel', comment: 'тема закрыта' })
  assert.equal(noWho.ok, false)
  if (!noWho.ok) assert.match(noWho.error, /кто отменил/)

  const noWhy = parseTransition({ kind: 'cancel', who: 'Иванов' })
  assert.equal(noWhy.ok, false)
  if (!noWhy.ok) assert.match(noWhy.error, /основание/)

  assert.deepEqual(parsed({ kind: 'vlet' }), { kind: 'vlet', who: '', comment: '' })
  assert.deepEqual(parsed({ kind: 'okrDone' }), { kind: 'okrDone', who: '', comment: '' })
})

test('строка заметок: префикс, автор и текст через тире; пустые части опускаются', () => {
  assert.equal(transitionNote(parsed({ kind: 'cancel', who: 'Иванов', comment: 'заказчик отозвал' })), 'Причина: Иванов — заказчик отозвал')
  assert.equal(transitionNote(parsed({ kind: 'vlet', comment: 'горит' })), 'Влёт: горит')
  assert.equal(transitionNote(parsed({ kind: 'okrDone', who: 'Петров' })), 'OKR-DONE: Петров')
  assert.equal(transitionNote(parsed({ kind: 'vlet' })), undefined)
})

test('одна команда task edit: стадия и строка к заметкам, без строки — только стадия', () => {
  assert.deepEqual(transitionArgs('PO-140', parsed({ kind: 'cancel', who: 'Иванов', comment: 'заказчик отозвал' })), [
    'task', 'edit', 'PO-140', '-s', 'BFT-CANCELED', '--append-notes', 'Причина: Иванов — заказчик отозвал', '--plain',
  ])
  assert.deepEqual(transitionArgs('PO-140', parsed({ kind: 'vlet' })), ['task', 'edit', 'PO-140', '-s', 'OKR-VLET', '--plain'])
})

test('итог отрезка в журнале — стадия и та же строка, что ушла в заметки', () => {
  assert.equal(transitionSummary(parsed({ kind: 'vlet', comment: 'горит' })), 'OKR-VLET, Влёт: горит')
  assert.equal(transitionSummary(parsed({ kind: 'okrDone' })), 'OKR-DONE')
})
