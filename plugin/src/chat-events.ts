/**
 * Чат по требованию через Claude Code CLI (issue #41): события прогона и их
 * проекция на экран.
 *
 * Общий модуль двух половин. Узел запускает `claude -p … --output-format
 * stream-json` и переводит его NDJSON-поток в события ниже (`parseStreamLine`);
 * браузер забирает события подкомандой `chatPoll` и складывает их в строки
 * транскрипта (`projectTranscript`). Здесь нет ни процесса, ни React — модуль
 * чистый и проверяется `test/chat-events.test.ts`.
 *
 * Почему свой формат, а не поток CLI как есть: формат stream-json — контракт
 * Claude Code, он шире, чем нужно PO рядом с документом, и меняется от версии к
 * версии. Узел знает его в одном месте; браузер видит только то, что рисует.
 */

export type ChatEvent =
  /** Сессия Claude Code, в которой идёт прогон: по ней следующий прогон продолжается (`--resume`). */
  | { kind: 'init'; sessionId: string }
  /** Сообщение PO — черновик, который узел отправил CLI. */
  | { kind: 'user'; text: string }
  /** Кусок текста ответа модели по мере набора. */
  | { kind: 'delta'; text: string }
  /** Завершённый текстовый блок ответа: закрывает накопленный поток; без потока — сам текст. */
  | { kind: 'assistant'; text: string }
  | { kind: 'tool-start'; id: string; name: string }
  | { kind: 'tool-end'; id: string; isError: boolean }
  /** Итог прогона от CLI: успех или отказ с текстом. */
  | { kind: 'result'; ok: boolean; text: string; sessionId?: string }
  /** Строка stderr CLI — причина, когда CLI не запустился или упал. */
  | { kind: 'stderr'; text: string }
  /** Процесс завершился. `error` — не удалось запустить (нет бинаря, нет прав). */
  | { kind: 'exit'; code: number | null; error?: string }

/** Строка транскрипта на экране. */
export type ChatLine =
  | { key: string; kind: 'user'; text: string }
  | { key: string; kind: 'assistant'; text: string; streaming: boolean }
  | { key: string; kind: 'tool'; name: string; running: boolean; failed: boolean }
  | { key: string; kind: 'error'; text: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Одна строка stream-json Claude Code — в события раздела. Строка бывает пустой,
 * не-JSON (предупреждение CLI в stdout) или незнакомого типа — тогда событий нет.
 * Формы взяты из вывода `claude -p --output-format stream-json --verbose
 * --include-partial-messages` (2.1.x): `system/init`, `stream_event` с сырыми
 * событиями Messages API, `assistant`/`user` с сообщением целиком, `result`.
 */
export function parseStreamLine(line: string): ChatEvent[] {
  const trimmed = line.trim()
  if (trimmed === '' || !trimmed.startsWith('{')) return []
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return []
  }
  const message = asRecord(raw)
  if (!message) return []

  switch (message.type) {
    case 'system': {
      // Прочие `system` (хуки, статус, счётчик рассуждений, итог хода) — не для экрана.
      const sessionId = str(message.session_id)
      return message.subtype === 'init' && sessionId ? [{ kind: 'init', sessionId }] : []
    }
    case 'stream_event': {
      const event = asRecord(message.event)
      if (!event) return []
      if (event.type === 'content_block_delta') {
        const delta = asRecord(event.delta)
        const text = delta?.type === 'text_delta' ? str(delta.text) : undefined
        return text ? [{ kind: 'delta', text }] : []
      }
      if (event.type === 'content_block_start') {
        const block = asRecord(event.content_block)
        const id = str(block?.id)
        const name = str(block?.name)
        return block?.type === 'tool_use' && id && name ? [{ kind: 'tool-start', id, name }] : []
      }
      return []
    }
    case 'assistant': {
      const content = asRecord(message.message)?.content
      if (!Array.isArray(content)) return []
      const events: ChatEvent[] = []
      const text = content
        .map(asRecord)
        .filter((block): block is Record<string, unknown> => block?.type === 'text')
        .map(block => str(block.text) ?? '')
        .join('')
      // Пустой текст тоже событие: блок из одних вызовов инструментов закрывает
      // накопленный поток, иначе он «дописывался» бы к следующему блоку.
      events.push({ kind: 'assistant', text })
      for (const block of content.map(asRecord)) {
        const id = str(block?.id)
        const name = str(block?.name)
        // Начало инструмента приходит и в потоке (`content_block_start`), и здесь;
        // проекция схлопывает повтор по id, поэтому дубль безопасен, а без потока
        // (нет `--include-partial-messages`) это единственный источник.
        if (block?.type === 'tool_use' && id && name) events.push({ kind: 'tool-start', id, name })
      }
      return events
    }
    case 'user': {
      const content = asRecord(message.message)?.content
      if (!Array.isArray(content)) return []
      const events: ChatEvent[] = []
      for (const block of content.map(asRecord)) {
        const id = str(block?.tool_use_id)
        if (block?.type === 'tool_result' && id) events.push({ kind: 'tool-end', id, isError: block.is_error === true })
      }
      return events
    }
    case 'result': {
      const ok = message.is_error !== true && message.subtype === 'success'
      const text = str(message.result) ?? (ok ? '' : str(message.subtype) ?? 'error')
      const sessionId = str(message.session_id)
      return [sessionId ? { kind: 'result', ok, text, sessionId } : { kind: 'result', ok, text }]
    }
    default:
      return []
  }
}

/**
 * События прогона — в строки экрана. Поток ответа копится в одну строку до
 * события `assistant`, которое её закрывает своим текстом; инструменты — по одной
 * строке на вызов, начало и конец схлопываются по id. Ошибка прогона — последней
 * строкой: отказ CLI (`result` не ok) или падение процесса без итога (код не 0,
 * хвост stderr — причина).
 */
export function projectTranscript(events: readonly ChatEvent[]): ChatLine[] {
  const lines: ChatLine[] = []
  const toolIndex = new Map<string, number>()
  let partial: { index: number } | null = null
  let sawResult = false
  const stderr: string[] = []
  let sequence = 0

  const closePartial = (text: string | null): void => {
    if (partial === null) {
      if (text) lines.push({ key: `assistant:${sequence++}`, kind: 'assistant', text, streaming: false })
      return
    }
    const line = lines[partial.index] as Extract<ChatLine, { kind: 'assistant' }>
    // Накопленные куски — истина о том, что уже показано: CLI шлёт `assistant`
    // по каждому завершённому блоку (2.1.x), и его текст бывает накопительным по
    // сообщению — заменять им поток значило бы дублировать предыдущий блок.
    // Итоговый текст берётся только когда потока не было. Строки не удаляются:
    // индексы инструментов в `toolIndex` держатся за позиции.
    lines[partial.index] = { ...line, streaming: false }
    partial = null
  }

  for (const event of events) {
    switch (event.kind) {
      case 'user':
        closePartial(null)
        lines.push({ key: `user:${sequence++}`, kind: 'user', text: event.text })
        break
      case 'delta':
        if (partial === null) {
          partial = { index: lines.length }
          lines.push({ key: `assistant:${sequence++}`, kind: 'assistant', text: event.text, streaming: true })
        } else {
          const line = lines[partial.index] as Extract<ChatLine, { kind: 'assistant' }>
          lines[partial.index] = { ...line, text: line.text + event.text }
        }
        break
      case 'assistant':
        closePartial(event.text)
        break
      case 'tool-start':
        if (toolIndex.has(event.id)) break
        // Инструмент идёт после текста шага: текст шага к этому моменту закрыт
        // событием `assistant`, а если поток без него — строка остаётся потоковой.
        toolIndex.set(event.id, lines.length)
        lines.push({ key: `tool:${event.id}`, kind: 'tool', name: event.name, running: true, failed: false })
        break
      case 'tool-end': {
        const index = toolIndex.get(event.id)
        if (index === undefined) break
        const line = lines[index] as Extract<ChatLine, { kind: 'tool' }>
        lines[index] = { ...line, running: false, failed: event.isError }
        break
      }
      case 'result':
        sawResult = true
        closePartial(null)
        if (!event.ok) lines.push({ key: `error:${sequence++}`, kind: 'error', text: event.text || 'error' })
        break
      case 'stderr':
        stderr.push(event.text)
        break
      case 'exit':
        closePartial(null)
        for (const [, index] of toolIndex) {
          const line = lines[index] as Extract<ChatLine, { kind: 'tool' }>
          if (line.running) lines[index] = { ...line, running: false, failed: true }
        }
        if (event.error) {
          lines.push({ key: `error:${sequence++}`, kind: 'error', text: event.error })
        } else if (!sawResult && event.code !== 0) {
          const tail = stderr.slice(-5).join('\n').trim()
          lines.push({ key: `error:${sequence++}`, kind: 'error', text: tail || `claude exited with code ${event.code ?? '?'}` })
        }
        break
      case 'init':
        break
    }
  }
  return lines
}

/** Идентификатор сессии Claude Code из событий прогона: из `init`, иначе из `result`. */
export function sessionIdOf(events: readonly ChatEvent[]): string | undefined {
  let found: string | undefined
  for (const event of events) {
    if (event.kind === 'init') return event.sessionId
    if (event.kind === 'result' && event.sessionId) found = event.sessionId
  }
  return found
}
