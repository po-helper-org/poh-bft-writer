/**
 * Клиент Коробки для интейка (Т8, шов ADR-0001 rev 2: HTTP, 5 эндпоинтов).
 *
 * Только `start` — остальное (board/initiative) плагин читает в Полосе В.
 * Форма запроса — контракт 1.0.0 (StartRequest): goal обязателен,
 * idempotency_key обязателен; ответ — StartAck или Error-объект коробки,
 * который НЕ HTTP-ошибка: коробка возвращает 200 с {type:"Error"}.
 *
 * Чистая половина (построение и разбор) тестируется без сети; сам поход —
 * инъектированный fetch.
 */

export interface StartFile {
  name: string
  media_type: string
  /** Текстовые вложения едут телом; бинарные коробке не нужны — только имена. */
  text?: string
}

export interface StartPayloadInput {
  goal: string
  brief?: string
  files?: readonly StartFile[]
  team?: string
  externalRefs?: Readonly<Record<string, string>>
  idempotencyKey: string
}

export type StartAck =
  | { ok: true; initiativeId: string; iterationId?: string; state?: string }
  | { ok: false; code: string; message: string }

export function buildStartPayload(input: StartPayloadInput): { ok: true; value: object } | { ok: false; reason: string } {
  const goal = input.goal.trim()
  if (!goal) return { ok: false, reason: 'Пустая цель: интейк обязан дать хотя бы строку' }
  const key = input.idempotencyKey.trim()
  if (!key) return { ok: false, reason: 'Пустой ключ идемпотентности' }

  const payload: Record<string, unknown> = {
    schema_version: '1.0.0',
    goal,
    idempotency_key: key,
  }
  if (input.brief?.trim()) payload.brief = input.brief.trim()
  if (input.team?.trim()) payload.team = input.team.trim()
  if (input.files && input.files.length > 0) {
    payload.files = input.files.map((f) => {
      const item: Record<string, unknown> = { name: f.name, media_type: f.media_type }
      if (f.text?.trim()) item.text = f.text
      return item
    })
  }
  if (input.externalRefs && Object.keys(input.externalRefs).length > 0) {
    payload.external_refs = input.externalRefs
  }
  return { ok: true, value: payload }
}

/** Разбор ответа коробки: ack несёт initiative_id; Error — код и сообщение. */
export function classifyStartResponse(body: unknown): StartAck {
  const obj = body as { type?: string; initiative_id?: unknown; iteration_id?: unknown; state?: unknown; error?: { code?: unknown; message?: unknown } } | null
  if (!obj || typeof obj !== 'object') return { ok: false, code: 'bad_response', message: 'Коробка ответила не объектом' }
  if (obj.type === 'Error' || obj.error) {
    const err = obj.error ?? {}
    return {
      ok: false,
      code: typeof err.code === 'string' ? err.code : 'unknown',
      message: typeof err.message === 'string' ? err.message : 'Коробка вернула ошибку без сообщения',
    }
  }
  if (typeof obj.initiative_id === 'string' && obj.initiative_id) {
    return {
      ok: true,
      initiativeId: obj.initiative_id,
      iterationId: typeof obj.iteration_id === 'string' ? obj.iteration_id : undefined,
      state: typeof obj.state === 'string' ? obj.state : undefined,
    }
  }
  return { ok: false, code: 'bad_response', message: 'В ответе нет initiative_id' }
}

export type BoxFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; json(): Promise<unknown> }>

export class BoxClient {
  constructor(
    private readonly deps: { baseUrl: string; token: string; fetch?: BoxFetch },
  ) {}

  available(): boolean {
    return Boolean(this.deps.baseUrl && this.deps.token && this.deps.fetch)
  }

  async start(input: StartPayloadInput): Promise<StartAck> {
    const payload = buildStartPayload(input)
    if (!payload.ok) return { ok: false, code: 'bad_request', message: payload.reason }
    if (!this.available()) return { ok: false, code: 'box-unavailable', message: 'Коробка не настроена: адрес и ui-токен обязательны' }
    try {
      const res = await this.deps.fetch!(`${this.deps.baseUrl}/api/start`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.deps.token}`,
        },
        body: JSON.stringify(payload.value),
      })
      return classifyStartResponse(await res.json())
    } catch (e) {
      return { ok: false, code: 'network', message: `Коробка недоступна: ${String(e)}` }
    }
  }
}
