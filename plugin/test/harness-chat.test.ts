import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { absorbWindow, textOf } from '../src/client/harness-chat.js'
import type { ChatEvent } from '../src/chat-events.js'

type Entry = { type: string; event: { type: string; seq: number; data: unknown } }
const ev = (seq: number, type: string, data: unknown): Entry => ({ type: 'event', event: { type, seq, data } })
const chunk = (attemptId: string, text: string): Entry => ({
  type: 'transient',
  event: { type: 'assistant/live-chunk', seq: 0, data: { attemptId, chunk: { type: 'text-delta', index: 0, text } } },
})
const fresh = (baseline = 0) => ({
  baseline,
  seen: new Set<string>(),
  chunks: new Map<string, number>(),
  started: false,
  events: [] as ChatEvent[],
  status: 'running' as 'running' | 'done' | 'failed' | 'stopped',
})

describe('textOf', () => {
  it('строка, блоки, сообщение с content', () => {
    assert.equal(textOf('привет'), 'привет')
    assert.equal(textOf([{ type: 'text', text: 'а' }, { type: 'image' }, { type: 'text', text: 'б' }]), 'а\nб')
    assert.equal(textOf({ role: 'user', content: [{ type: 'text', text: 'в' }] }), 'в')
    assert.equal(textOf(null), '')
  })
})

describe('absorbWindow', () => {
  it('история до запуска не попадает в транскрипт', () => {
    const run = fresh(5)
    absorbWindow(run, { entries: [ev(4, 'user/message', { content: 'старое', source: { kind: 'user' } })] })
    assert.deepEqual(run.events, [])
  })

  it('ход: сообщение PO, поток, ответ, инструмент, итог', () => {
    const run = fresh(0)
    const entries: Entry[] = [
      ev(1, 'user/message', { role: 'user', content: [{ type: 'text', text: 'правки' }], source: { kind: 'user' } }),
      ev(2, 'turn/start', { turn: 1 }),
      chunk('a1', 'Вношу '),
      chunk('a1', 'правки'),
    ]
    absorbWindow(run, { entries })
    assert.deepEqual(run.events, [
      { kind: 'user', text: 'правки' },
      { kind: 'delta', text: 'Вношу ' },
      { kind: 'delta', text: 'правки' },
    ])
    // Повторный разбор того же окна ничего не добавляет.
    absorbWindow(run, { entries })
    assert.equal(run.events.length, 3)

    absorbWindow(run, {
      entries: [
        ...entries.slice(0, 2),
        ev(3, 'assistant/message', { message: { role: 'assistant', content: [{ type: 'text', text: 'Вношу правки' }] } }),
        ev(4, 'tool/call', { callId: 'c1', name: 'edit_file', arguments: '{}' }),
        ev(5, 'tool/result', { message: { role: 'tool', toolCallId: 'c1', content: [] } }),
        ev(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ],
    })
    assert.deepEqual(run.events.slice(3), [
      { kind: 'assistant', text: 'Вношу правки' },
      { kind: 'tool-start', id: 'c1', name: 'edit_file' },
      { kind: 'tool-end', id: 'c1', isError: false },
      { kind: 'result', ok: true, text: '' },
    ])
    assert.equal(run.status, 'done')
  })

  it('подмешанный харнессом контекст в роли user — не в транскрипт', () => {
    const run = fresh(0)
    absorbWindow(run, { entries: [ev(1, 'user/message', { content: '<system-reminder>…', source: { kind: 'agent-instructions' } })] })
    assert.deepEqual(run.events, [])
  })

  it('ошибка и остановка хода', () => {
    const failed = fresh(0)
    absorbWindow(failed, { entries: [ev(1, 'turn/start', {}), ev(2, 'turn/end', { reason: { kind: 'error', error: { message: 'нет ключа' } } })] })
    assert.equal(failed.status, 'failed')
    assert.deepEqual(failed.events, [{ kind: 'result', ok: false, text: 'нет ключа' }])

    const stopped = fresh(0)
    absorbWindow(stopped, { entries: [ev(1, 'turn/start', {}), ev(2, 'turn/end', { reason: { kind: 'aborted' } })] })
    assert.equal(stopped.status, 'stopped')
  })
})
