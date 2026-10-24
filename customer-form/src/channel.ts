/**
 * Канал customer-form: пять подкоманд + бинарная выгрузка файлов.
 * Транспорт — тот же, что у poh-bft-plugin (client-request → server-response).
 */
export const CF_CHANNEL = '/customer-form'
export const CF_ENDPOINTS: readonly string[] = ['health', 'upload', 'submit', 'chat', 'finalize', 'state']

export type RpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; details: object } }

function ok<T>(value: T): RpcResult<T> { return { ok: true, value } }
function fail(code: string, message: string): RpcResult<never> {
  return { ok: false, error: { code, message, details: {} } }
}

export interface CfDeps {
  health(): Promise<unknown>
  upload(name: string, bytes: Uint8Array): Promise<{ ref: string; name: string }>
  submit(input: { name: string; email: string; text: string; links: string[]; files: string[] }): Promise<{ taskId: number; url: string }>
  chat(taskId: number, message: string): Promise<unknown>
  finalize(taskId: number): Promise<{ url: string; board: string }>
}

export async function cfDispatch(deps: CfDeps, endpoint: string, payload: unknown): Promise<RpcResult<unknown>> {
  try {
    const p = (payload ?? {}) as Record<string, unknown>
    switch (endpoint) {
      case 'health': return ok(await deps.health())
      case 'submit': {
        const str = (k: string): string => (typeof p[k] === 'string' ? p[k] as string : '')
        const arr = (k: string): string[] => (Array.isArray(p[k]) ? p[k].filter((x) => typeof x === 'string') as string[] : [])
        return ok(await deps.submit({ name: str('name'), email: str('email'), text: str('text'), links: arr('links'), files: arr('files') }))
      }
      case 'chat': {
        const taskId = typeof p.taskId === 'number' ? p.taskId : Number(p.taskId)
        const message = typeof p.message === 'string' ? p.message : ''
        if (!taskId || !message.trim()) return fail('bad-request', 'нужны taskId и message')
        return ok(await deps.chat(taskId, message))
      }
      case 'finalize': {
        const taskId = typeof p.taskId === 'number' ? p.taskId : Number(p.taskId)
        if (!taskId) return fail('bad-request', 'нужен taskId')
        return ok(await deps.finalize(taskId))
      }
      default: return fail('unknown-endpoint', `нет подкоманды ${endpoint}`)
    }
  } catch (e) {
    return fail('cf-error', e instanceof Error ? e.message : String(e))
  }
}
