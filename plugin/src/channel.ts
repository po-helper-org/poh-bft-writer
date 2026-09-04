/**
 * Канал между разделом в браузере и воркспейсом.
 *
 * Одна регистрация, подкоманды разбираются внутри. Наружу всегда уходит
 * значение: через провод исключения не летят, поэтому любая ошибка
 * оборачивается в ответ с кодом, а клиент показывает причину, а не пустой экран.
 */
import { BftReader } from './bft-reader.js'
import {
  DocumentOutsideWorkspaceError, DocumentUnreadableError, InvalidTaskIdError,
  TaskNotFoundError, WorkLogWriteError,
} from './errors.js'

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
        return ok(await reader.findDocument(id))
      }

      // Черновик для чата: продолжение с последнего закрытого отрезка работы.
      case 'handoff': {
        const id = stringField(payload, 'id')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        return ok(await reader.handoff(id))
      }

      case 'worklog':
        return ok(await reader.readWorkLog())

      // Закрытие отрезка: итог и ветка контекстного чата entire.io.
      case 'finishWork': {
        const id = stringField(payload, 'id')
        const summary = stringField(payload, 'summary')
        if (!id) return fail('bad-request', 'не передан идентификатор требования')
        if (!summary) return fail('bad-request', 'не передан итог отрезка работы')
        return ok(await reader.finishWork(id, summary, stringField(payload, 'contextRef') ?? undefined))
      }

      default:
        return fail('bad-request', `неизвестная подкоманда «${endpoint}»`)
    }
  } catch (error) {
    return failure(error)
  }
}
