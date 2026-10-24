/**
 * Т5: чистое ядро — слияние конвейера и стадии документа (conveyor.ts).
 * Две оси не притворяются друг другом: процесс без документа и документ без
 * процесса — оба легальны; боковые состояния — не колонки.
 */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { mergeConveyor } from '../src/conveyor.js'

test('конвейер из коробки + стадия документа — обе оси на месте', () => {
  const v = mergeConveyor('DEEP-REVIEW', { stage: 'verifying', waiting_for: ['po', 'addressee'] })
  assert.equal(v.conveyor, 'verifying')
  assert.deepEqual(v.waitingFor, ['po', 'addressee'])
  assert.equal(v.docStage, 'DEEP-REVIEW')
  assert.equal(v.note, undefined)
})

test('документ без процесса — колонки нет, честная пометка (до кнопки «Запустить»)', () => {
  const v = mergeConveyor('FAST-DONE', null)
  assert.equal(v.conveyor, null)
  assert.match(v.note ?? '', /Без процесса/)
})

test('процесс без документа — конвейер есть, docStage null (легально)', () => {
  const v = mergeConveyor(null, { stage: 'request', waiting_for: [] })
  assert.equal(v.conveyor, 'request')
  assert.equal(v.docStage, null)
})

test('чужое значение stage не попадает в колонки', () => {
  const v = mergeConveyor('To Do', { stage: 'something_new' })
  assert.equal(v.conveyor, null)
})

test('боковые состояния (paused/cancelled) — не колонка, пометка на детальный экран', () => {
  const v = mergeConveyor('DEEP-DONE', { stage: 'paused' })
  assert.equal(v.conveyor, null)
  assert.match(v.note ?? '', /паузе|отменена/)
})

test('validated — терминальная колонка конвейера', () => {
  const v = mergeConveyor('DEEP-DONE', { stage: 'validated' })
  assert.equal(v.conveyor, 'validated')
})
