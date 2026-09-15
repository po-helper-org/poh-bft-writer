import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ClaudeChatService, claudeArgs, type ChatRun } from '../src/claude-chat.js'
import { DEFAULT_CLAUDE_ARGS } from '../src/config.js'
import { ChatBusyError } from '../src/errors.js'
import type { SpawnStreaming, StreamSink } from '../src/ports.js'

interface Spawned {
  bin: string
  args: string[]
  cwd: string
  input: string
  sink: StreamSink
  killed: boolean
}

/** Порт запуска, который ничего не запускает: тест сам диктует вывод и завершение. */
function fakeSpawn(): { spawn: SpawnStreaming; spawned: Spawned[] } {
  const spawned: Spawned[] = []
  const spawn: SpawnStreaming = (bin, args, cwd, input, sink) => {
    const record: Spawned = { bin, args, cwd, input, sink, killed: false }
    spawned.push(record)
    return { kill() { record.killed = true; sink.exit(null) } }
  }
  return { spawn, spawned }
}

const CONFIG = { bin: '/usr/local/bin/claude', args: DEFAULT_CLAUDE_ARGS }
const line = (value: unknown): string => JSON.stringify(value)

describe('claudeArgs', () => {
  it('новая сессия — свой UUID, продолжение — --resume; корень воркспейса — --add-dir; права из конфига', () => {
    assert.deepEqual(claudeArgs(CONFIG, { newSessionId: 'u-1', addDir: '/ws' }), [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--session-id', 'u-1', '--add-dir', '/ws',
      '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(python3:*)', 'Bash(backlog:*)', 'Bash(sleep:*)',
    ])
    const resumed = claudeArgs({ bin: 'claude', args: ['--model', 'opus'] }, { resume: 'u-0', newSessionId: 'ignored' })
    assert.deepEqual(resumed.slice(5), ['--resume', 'u-0', '--model', 'opus'])
  })
})

describe('ClaudeChatService', () => {
  it('ход: черновик в stdin, cwd — рабочее пространство, события копятся и отдаются с позиции since', () => {
    const { spawn, spawned } = fakeSpawn()
    const finished: ChatRun[] = []
    const service = new ClaudeChatService(CONFIG, spawn, run => finished.push(run))

    const started = service.start('PO-22', '/bft-deep po-22\n\nПравка', '/ws/bft', { newSessionId: 'u-1', addDir: '/ws' })
    assert.equal(spawned.length, 1)
    assert.deepEqual([spawned[0].bin, spawned[0].cwd, spawned[0].input], ['/usr/local/bin/claude', '/ws/bft', '/bft-deep po-22\n\nПравка'])
    assert.ok(spawned[0].args.includes('--session-id'))

    const first = service.poll(started.runId, 0)!
    assert.deepEqual([first.status, first.sessionId, first.total], ['running', 'u-1', 1])
    assert.deepEqual(first.events, [{ kind: 'user', text: '/bft-deep po-22\n\nПравка' }])

    spawned[0].sink.line(line({ type: 'system', subtype: 'init', session_id: 'u-1' }))
    spawned[0].sink.line(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Читаю' } } }))
    spawned[0].sink.line('not json at all')
    const tail = service.poll(started.runId, first.total)!
    assert.deepEqual(tail.events, [{ kind: 'init', sessionId: 'u-1' }, { kind: 'delta', text: 'Читаю' }])
    assert.equal(tail.total, 3)

    spawned[0].sink.line(line({ type: 'result', subtype: 'success', is_error: false, result: 'Готово', session_id: 'u-1' }))
    spawned[0].sink.exit(0)
    const done = service.poll(started.runId, 3)!
    assert.equal(done.status, 'done')
    assert.deepEqual(done.events.map(event => event.kind), ['result', 'exit'])
    assert.equal(finished.length, 1)
    assert.deepEqual([finished[0].runId, finished[0].status, finished[0].sessionId], [started.runId, 'done', 'u-1'])
    assert.ok(finished[0].finishedAt)
  })

  it('второй ход по тому же требованию, пока идёт первый, — ChatBusyError; по другому — можно', () => {
    const { spawn, spawned } = fakeSpawn()
    const service = new ClaudeChatService(CONFIG, spawn)
    service.start('PO-1', 'a', '/ws')
    assert.throws(() => service.start('PO-1', 'b', '/ws'), ChatBusyError)
    service.start('PO-2', 'c', '/ws')
    assert.equal(spawned.length, 2)
    spawned[0].sink.exit(0)
    // Первый завершился (без result — failed), теперь можно снова.
    assert.equal(service.poll(service.latestFor('PO-1')!.runId, 0)!.status, 'failed')
    service.start('PO-1', 'd', '/ws')
    assert.equal(spawned.length, 3)
  })

  it('не удалось запустить — failed с причиной; отказ CLI — failed; ненулевой код без result — failed', () => {
    const { spawn, spawned } = fakeSpawn()
    const service = new ClaudeChatService(CONFIG, spawn)
    const a = service.start('A', 'x', '/ws')
    spawned[0].sink.exit(null, 'spawn claude ENOENT')
    assert.deepEqual(service.poll(a.runId, 1)!.events, [{ kind: 'exit', code: null, error: 'spawn claude ENOENT' }])
    assert.equal(service.poll(a.runId, 0)!.status, 'failed')

    const b = service.start('B', 'x', '/ws')
    spawned[1].sink.line(line({ type: 'result', subtype: 'error_during_execution', is_error: true }))
    spawned[1].sink.exit(0)
    assert.equal(service.poll(b.runId, 0)!.status, 'failed')

    const c = service.start('C', 'x', '/ws')
    spawned[2].sink.stderr('Error: not logged in')
    spawned[2].sink.exit(1)
    const events = service.poll(c.runId, 1)!.events
    assert.deepEqual(events, [{ kind: 'stderr', text: 'Error: not logged in' }, { kind: 'exit', code: 1 }])
    assert.equal(service.poll(c.runId, 0)!.status, 'failed')
  })

  it('остановка: процесс убит, ход stopped по выходу процесса, повторная остановка — false; неизвестный ход — null', () => {
    const { spawn, spawned } = fakeSpawn()
    const service = new ClaudeChatService(CONFIG, spawn)
    const run = service.start('A', 'x', '/ws')
    assert.equal(service.stop(run.runId), true)
    assert.equal(spawned[0].killed, true)
    assert.equal(service.poll(run.runId, 0)!.status, 'stopped')
    assert.equal(service.stop(run.runId), false)
    assert.equal(service.poll('nope', 0), null)
    assert.equal(service.activeFor('A'), undefined)
  })

  it('пока процесс после «Остановить» жив, ход остаётся running и второй по требованию не запускается', () => {
    const spawned: Spawned[] = []
    // Порт, чей kill не завершает процесс сразу: SIGTERM ещё в пути.
    const spawn: SpawnStreaming = (bin, args, cwd, input, sink) => {
      const record: Spawned = { bin, args, cwd, input, sink, killed: false }
      spawned.push(record)
      return { kill() { record.killed = true } }
    }
    const service = new ClaudeChatService(CONFIG, spawn)
    const run = service.start('A', 'x', '/ws')
    assert.equal(service.stop(run.runId), true)
    assert.equal(service.poll(run.runId, 0)!.status, 'running')
    assert.throws(() => service.start('A', 'y', '/ws'), ChatBusyError)
    spawned[0].sink.exit(null)
    assert.equal(service.poll(run.runId, 0)!.status, 'stopped')
    assert.equal(service.activeFor('A'), undefined)
  })

  it('stopAll гасит все живые ходы; продолжение сессии помечает ход resumed', () => {
    const { spawn, spawned } = fakeSpawn()
    const finished: ChatRun[] = []
    const service = new ClaudeChatService(CONFIG, spawn, run => finished.push(run))
    service.start('A', 'x', '/ws', { resume: 'u-0' })
    service.start('B', 'y', '/ws', { newSessionId: 'u-1' })
    service.stopAll()
    assert.deepEqual(spawned.map(item => item.killed), [true, true])
    assert.deepEqual(finished.map(run => [run.taskId, run.status, run.resumed]), [['A', 'stopped', true], ['B', 'stopped', false]])
  })

  it('идентификатор сессии подхватывается из потока, когда до запуска его не было', () => {
    const { spawn, spawned } = fakeSpawn()
    const service = new ClaudeChatService(CONFIG, spawn)
    const run = service.start('A', 'x', '/ws')
    assert.equal(service.poll(run.runId, 0)!.sessionId, undefined)
    spawned[0].sink.line(line({ type: 'system', subtype: 'init', session_id: 'from-cli' }))
    assert.equal(service.poll(run.runId, 0)!.sessionId, 'from-cli')
  })
})

describe('extendPath', () => {
  it('дописывает обычные каталоги бинарей в конец, не дублируя уже имеющиеся', async () => {
    const { extendPath } = await import('../src/ports.js')
    const result = extendPath('/usr/bin:/bin:/usr/local/bin')
    assert.ok(result.startsWith('/usr/bin:/bin:/usr/local/bin:'), result)
    assert.equal(result.split(':').filter(dir => dir === '/usr/local/bin').length, 1)
    assert.ok(result.split(':').includes('/opt/homebrew/bin'))
    // PATH не задан вовсе — системный минимум впереди, иначе не найдутся sh и python3.
    const bare = extendPath(undefined).split(':')
    assert.ok(bare.includes('/usr/bin') && bare.includes('/bin') && bare.includes('/opt/homebrew/bin'), bare.join(':'))
  })
})
