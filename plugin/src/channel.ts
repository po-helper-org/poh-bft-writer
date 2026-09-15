/**
 * Канал между разделом в браузере и воркспейсом.
 *
 * Одна регистрация, подкоманды разбираются внутри. Наружу всегда уходит
 * значение: через провод исключения не летят, поэтому любая ошибка
 * оборачивается в ответ с кодом, а клиент показывает причину, а не пустой экран.
 */
import { BftReader } from './bft-reader.js'
import {
  ChatBusyError, ChatRunNotFoundError, ChatUnavailableError, DocumentOutsideWorkspaceError,
  DocumentUnreadableError, InvalidTaskIdError, OkrHandoffError, TaskNotFoundError, WorkLogWriteError,
} from './errors.js'
import { parseOkrHandoff } from './okr-handoff.js'

export const BFT_CHANNEL = '/bft'

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

/** Ошибки предметной области несут готовый текст для пользователя — он и едет наружу. */
const CODES: ReadonlyArray<[new (...args: never[]) => Error, string]> = [
  [TaskNotFoundError, 'task-not-found'],
  [InvalidTaskIdError, 'invalid-task-id'],
  [DocumentUnreadableError, 'document-unreadable'],
  [DocumentOutsideWorkspaceError, 'document-outside-workspace'],
  [WorkLogWriteError, 'worklog-write-failed'],
  [OkrHandoffError, 'okr-handoff-failed'],
  [ChatBusyError, 'chat-busy'],
  [ChatRunNotFoundError, 'chat-run-not-found'],
  [ChatUnavailableError, 'chat-unavailable'],
]

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value }
}

function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

function failure(error: unknown): RpcResult<never> {
  // Извлечение сообщения защищено отдельно: `error` — исключение из чужого кода,
  // и его форма не гарантирована. `String(error)` зовёт чужой `toString`, а
  // `.message` бывает бросающим геттером. Без этой защиты `failure` бросила бы
  // сама — а зовут её уже из `catch`, без внешней страховки.
  try {
    const message = error instanceof Error ? error.message : String(error)
    for (const [type, code] of CODES) {
      if (error instanceof type) return fail(code, message)
    }
    return fail('internal', message)
  } catch {
    return fail('internal', 'не удалось разобрать исключение')
  }
}

function stringField(payload: unknown, field: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === 'string' && value !== '' ? value : null
}

function numberField(payload: unknown, field: string): number | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function dispatch(
  reader: BftReader,
  endpoint: string,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  try {
    switch (endpoint) {
      case 'list':
        return ok(await reader.listTasks())

      case 'task': {
        const id = stringField(payload, 'id')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        return ok(await reader.getTask(id))
      }

      case 'document': {
        const path = stringField(payload, 'path')
        if (!path) return fail('bad-request', 'не передан путь к документу')
        return ok(await reader.readDocument(path))
      }

      case 'findDocument': {
        const id = stringField(payload, 'id')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        // Роль опциональна: старый клиент её не шлёт и получает документ требования,
        // как получал. Чужое значение не угадывается — оно отвергается.
        const kind = stringField(payload, 'kind')
        if (kind !== null && kind !== 'requirement' && kind !== 'custdev') {
          return fail('bad-request', `неизвестный вид документа «${kind}»`)
        }
        return ok(await reader.findDocument(id, kind ?? 'requirement'))
      }

      // Черновик для чата: команда следующего навыка и продолжение с последнего
      // закрытого отрезка работы. `note` — правка PO к документу, необязательна.
      case 'handoff': {
        const id = stringField(payload, 'id')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        return ok(await reader.handoff(id, stringField(payload, 'note') ?? undefined))
      }

      case 'worklog':
        return ok(await reader.readWorkLog())

      // Чат по требованию открыт в сессии харнесса: запомнить её, чтобы вернуться.
      case 'attachSession': {
        const id = stringField(payload, 'id')
        const sessionId = stringField(payload, 'sessionId')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        if (!sessionId) return fail('bad-request', 'не передан идентификатор сессии')
        await reader.attachSession(id, sessionId)
        return ok(true)
      }

      // Рабочее пространство чатов по требованиям: абсолютный путь или null, если выключено.
      case 'sessionWorkspace':
        return ok(await reader.sessionWorkspace())

      // Закрытие отрезка: итог и ветка контекстного чата entire.io.
      case 'finishWork': {
        const id = stringField(payload, 'id')
        const summary = stringField(payload, 'summary')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        if (!summary) return fail('bad-request', 'не передан итог отрезка работы')
        return ok(await reader.finishWork(id, summary, stringField(payload, 'contextRef') ?? undefined))
      }

      // Чат по требованию через Claude Code CLI (issue #41): ход, опрос, остановка,
      // состояние последнего хода — для детальной страницы.
      case 'chatStart': {
        const id = stringField(payload, 'id')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        return ok(await reader.chatStart(id, stringField(payload, 'note') ?? undefined))
      }

      case 'chatPoll': {
        const runId = stringField(payload, 'runId')
        if (!runId) return fail('bad-request', 'не передан идентификатор хода')
        return ok(reader.chatPoll(runId, numberField(payload, 'since') ?? 0))
      }

      case 'chatStop': {
        const runId = stringField(payload, 'runId')
        if (!runId) return fail('bad-request', 'не передан идентификатор хода')
        return ok(reader.chatStop(runId))
      }

      case 'chatStatus': {
        const id = stringField(payload, 'id')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        return ok({ available: reader.chatAvailable(), run: reader.chatStatus(id) })
      }

      // «Добавить в OKR» с доски: форма разбирается здесь, чтобы плохое тело
      // отвечало bad-request словами, а не падало внутри записи на доску.
      case 'addToOkr': {
        const id = stringField(payload, 'id')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        const parsed = parseOkrHandoff(payload)
        if (!parsed.ok) return fail('bad-request', parsed.error)
        return ok(await reader.addToOkr(id, parsed.value))
      }

      default:
        return fail('bad-request', `неизвестная подкоманда «${endpoint}»`)
    }
  } catch (error) {
    return failure(error)
  }
}
