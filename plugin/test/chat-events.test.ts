import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseStreamLine, projectTranscript, sessionIdOf, type ChatEvent } from '../src/chat-events.js'

const SID = 'ac464da1-c225-42ea-b1b0-815232e67bd0'
const line = (value: unknown): string => JSON.stringify(value)

describe('parseStreamLine', () => {
  it('пустое, не-JSON и незнакомые типы — без событий', () => {
    assert.deepEqual(parseStreamLine(''), [])
    assert.deepEqual(parseStreamLine('warning: something'), [])
    assert.deepEqual(parseStreamLine('{not json'), [])
    assert.deepEqual(parseStreamLine(line({ type: 'rate_limit_event' })), [])
    assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'hook_started', session_id: SID })), [])
    assert.deepEqual(parseStreamLine(line({ type: 'stream_event', event: { type: 'message_start' } })), [])
  })

  it('сообщения субагентов (parent_tool_use_id) в транскрипт не идут', () => {
    const sub = { parent_tool_use_id: 'toolu_task' }
    assert.deepEqual(parseStreamLine(line({ type: 'assistant', ...sub, message: { content: [{ type: 'text', text: 'внутри' }] } })), [])
    assert.deepEqual(parseStreamLine(line({ type: 'user', ...sub, message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } })), [])
    assert.deepEqual(parseStreamLine(line({ type: 'stream_event', ...sub, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } })), [])
    // Основной ход: поле есть, но null.
    assert.deepEqual(parseStreamLine(line({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a' } } })), [{ kind: 'delta', text: 'a' }])
  })

  it('init — сессия Claude Code', () => {
    assert.deepEqual(parseStreamLine(line({ type: 'system', subtype: 'init', session_id: SID, cwd: '/x' })), [{ kind: 'init', sessionId: SID }])
  })

  it('поток: текстовые куски — delta, рассуждения опускаются, начало инструмента — tool-start', () => {
    assert.deepEqual(parseStreamLine(line({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'При' } } })), [{ kind: 'delta', text: 'При' }])
    assert.deepEqual(parseStreamLine(line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } } })), [])
    assert.deepEqual(parseStreamLine(line({ type: 'stream_event', event: { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} } } })), [{ kind: 'tool-start', id: 'toolu_1', name: 'Read' }])
    assert.deepEqual(parseStreamLine(line({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } })), [])
  })

  it('assistant — текст блока и вызовы инструментов; блок из одних рассуждений — пустой текст', () => {
    assert.deepEqual(
      parseStreamLine(line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Привет' }] } })),
      [{ kind: 'assistant', text: 'Привет' }],
    )
    assert.deepEqual(
      parseStreamLine(line({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'x' }] } })),
      [{ kind: 'assistant', text: '' }],
    )
    assert.deepEqual(
      parseStreamLine(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_2', name: 'Bash', input: { command: 'ls' } }] } })),
      [{ kind: 'assistant', text: '' }, { kind: 'tool-start', id: 'toolu_2', name: 'Bash' }],
    )
  })

  it('user с результатом инструмента — tool-end', () => {
    assert.deepEqual(
      parseStreamLine(line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }, { type: 'tool_result', tool_use_id: 'toolu_3', is_error: true, content: 'boom' }] } })),
      [{ kind: 'tool-end', id: 'toolu_2', isError: false }, { kind: 'tool-end', id: 'toolu_3', isError: true }],
    )
  })

  it('result — успех с текстом и отказ с причиной', () => {
    assert.deepEqual(
      parseStreamLine(line({ is_error: false, subtype: 'success', result: 'Готово', type: 'result', session_id: SID })),
      [{ kind: 'result', ok: true, text: 'Готово', sessionId: SID }],
    )
    assert.deepEqual(
      parseStreamLine(line({ type: 'result', subtype: 'error_max_turns', is_error: true })),
      [{ kind: 'result', ok: false, text: 'error_max_turns' }],
    )
  })
})

describe('projectTranscript', () => {
  it('поток копится в одну строку и закрывается блоком; текст блока поток не заменяет', () => {
    const events: ChatEvent[] = [
      { kind: 'user', text: '/bft-deep po-22' },
      { kind: 'init', sessionId: SID },
      { kind: 'assistant', text: '' },
      { kind: 'delta', text: 'Чи' },
      { kind: 'delta', text: 'таю.' },
    ]
    assert.deepEqual(projectTranscript(events), [
      { key: 'user:0', kind: 'user', text: '/bft-deep po-22' },
      { key: 'assistant:1', kind: 'assistant', text: 'Читаю.', streaming: true },
    ])
    events.push({ kind: 'assistant', text: 'Читаю.' })
    assert.deepEqual(projectTranscript(events).at(-1), { key: 'assistant:1', kind: 'assistant', text: 'Читаю.', streaming: false })
  })

  it('без потока текст блока — своя строка', () => {
    assert.deepEqual(projectTranscript([{ kind: 'assistant', text: 'Готово' }]), [
      { key: 'assistant:0', kind: 'assistant', text: 'Готово', streaming: false },
    ])
  })

  it('инструмент: начало из потока и повтор из блока схлопываются, конец меняет состояние', () => {
    const events: ChatEvent[] = [
      { kind: 'delta', text: 'Смотрю' },
      { kind: 'tool-start', id: 'toolu_1', name: 'Read' },
      { kind: 'assistant', text: 'Смотрю' },
      { kind: 'assistant', text: '' },
      { kind: 'tool-start', id: 'toolu_1', name: 'Read' },
    ]
    assert.deepEqual(projectTranscript(events), [
      { key: 'assistant:0', kind: 'assistant', text: 'Смотрю', streaming: false },
      { key: 'tool:toolu_1', kind: 'tool', name: 'Read', running: true, failed: false },
    ])
    events.push({ kind: 'tool-end', id: 'toolu_1', isError: true })
    assert.deepEqual(projectTranscript(events)[1], { key: 'tool:toolu_1', kind: 'tool', name: 'Read', running: false, failed: true })
  })

  it('отказ CLI — строка ошибки; успех — без неё', () => {
    assert.deepEqual(projectTranscript([{ kind: 'result', ok: false, text: 'error_max_turns' }, { kind: 'exit', code: 1 }]), [
      { key: 'error:0', kind: 'error', text: 'error_max_turns' },
    ])
    assert.deepEqual(projectTranscript([{ kind: 'delta', text: 'ok' }, { kind: 'result', ok: true, text: 'ok' }, { kind: 'exit', code: 0 }]), [
      { key: 'assistant:0', kind: 'assistant', text: 'ok', streaming: false },
    ])
  })

  it('падение процесса без итога — хвост stderr; не удалось запустить — причина', () => {
    assert.deepEqual(projectTranscript([{ kind: 'stderr', text: 'first' }, { kind: 'stderr', text: 'Error: no api key' }, { kind: 'exit', code: 1 }]), [
      { key: 'error:0', kind: 'error', text: 'first\nError: no api key' },
    ])
    assert.deepEqual(projectTranscript([{ kind: 'exit', code: 1 }]), [{ key: 'error:0', kind: 'error', text: 'claude exited with code 1' }])
    assert.deepEqual(projectTranscript([{ kind: 'exit', code: null, error: 'spawn claude ENOENT' }]), [{ key: 'error:0', kind: 'error', text: 'spawn claude ENOENT' }])
  })

  it('выход процесса закрывает поток и гасит незавершённые инструменты как упавшие', () => {
    assert.deepEqual(projectTranscript([{ kind: 'delta', text: 'a' }, { kind: 'tool-start', id: 't', name: 'Bash' }, { kind: 'exit', code: 0 }]), [
      { key: 'assistant:0', kind: 'assistant', text: 'a', streaming: false },
      { key: 'tool:t', kind: 'tool', name: 'Bash', running: false, failed: true },
    ])
  })
})

describe('sessionIdOf', () => {
  it('из init, иначе из result, иначе нет', () => {
    assert.equal(sessionIdOf([{ kind: 'init', sessionId: 'a' }, { kind: 'result', ok: true, text: '', sessionId: 'b' }]), 'a')
    assert.equal(sessionIdOf([{ kind: 'result', ok: true, text: '', sessionId: 'b' }]), 'b')
    assert.equal(sessionIdOf([{ kind: 'user', text: 'x' }]), undefined)
  })
})
