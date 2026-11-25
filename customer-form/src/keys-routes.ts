/**
 * «Ключи и доступы» (ADR-0030): маршруты раздела настроек — только администратору.
 *
 *  GET  customer-form.keys            — статусы всех ключей (без значений)
 *  POST customer-form.keys {name, value} — задать или заменить; {name, reset: true} — вернуть окружение
 *  POST customer-form.keysCheck {name}   — проверить связь, итог запоминается
 *
 * Значение ключа приходит только в POST и никогда не возвращается: в ответе — статус.
 */
import { applyKeys, keyStatuses, KEY_GROUPS, specOf, validateKeyValue, type CheckResult, type KeyCheck, type KeyStore } from './keys.js'

type Register = (route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }) => () => void

export const KEYS_ROUTE = '/api/customer-form.keys'
export const KEYS_CHECK_ROUTE = '/api/customer-form.keysCheck'

export interface KeysDeps {
  store: KeyStore
  /** Окружение процесса до подстановки ключей из настроек. */
  baseline: NodeJS.ProcessEnv
  env: NodeJS.ProcessEnv
  isAdmin(request: Request): boolean
  who?(request: Request): string | undefined
  /** Проверки связи по виду; нет — ключ без проверки. */
  checks: Partial<Record<KeyCheck, () => Promise<{ ok: boolean; text: string }>>>
  now?(): string
  /** Ключи, заданные в других разделах настроек: имя → где (например, ключ агента — «Портал»). */
  external?(): Record<string, string>
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

/** Проверка ключа Google Drive API: неверный ключ — 400 «API key not valid», верный — 404 на несуществующий файл. */
export async function checkGoogleKey(key: string | undefined, fetchFn: typeof fetch = fetch): Promise<{ ok: boolean; text: string }> {
  if (!key) return { ok: false, text: 'ключ не задан — папки Google читаются открытым экспортом' }
  try {
    const res = await fetchFn(`https://www.googleapis.com/drive/v3/files/0000000000000000000000000000000?fields=id&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) })
    const body = await res.text()
    if (res.status === 404) return { ok: true, text: 'Google принял ключ (Drive API)' }
    if (res.status === 400 && /API key not valid/i.test(body)) return { ok: false, text: 'Google: ключ недействителен' }
    if (res.status === 403) return { ok: false, text: 'Google: ключ есть, но Drive API для него не включён или ограничен (403)' }
    return { ok: false, text: `Google ответил ${res.status}` }
  } catch (e) {
    return { ok: false, text: `Google не ответил: ${(e as Error).message.slice(0, 120)}` }
  }
}

export function registerKeys(register: Register, deps: KeysDeps): Array<() => void> {
  const now = deps.now ?? (() => new Date().toISOString())
  const view = () => ({ groups: KEY_GROUPS, keys: keyStatuses(deps.store.read(), deps.baseline, deps.external?.() ?? {}) })
  const deny = () => json({ error: 'Только администратор портала' }, 403)
  return [
    register({
      path: KEYS_ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: async (request) => {
        if (!deps.isAdmin(request)) return deny()
        if (request.method === 'GET') return json(view())
        const body = (await request.json().catch(() => ({}))) as { name?: unknown; value?: unknown; reset?: unknown }
        const spec = specOf(String(body.name ?? ''))
        if (!spec) return json({ error: 'Нет такого ключа' }, 404)
        if (!spec.editable) return json({ error: `«${spec.title}» задаётся не здесь: ${spec.elsewhere ?? 'окружение сервера'}` }, 409)
        if (body.reset === true) deps.store.unset(spec.name)
        else {
          let value: string
          try { value = validateKeyValue(spec, body.value) } catch (e) { return json({ error: (e as Error).message }, 400) }
          const by = deps.who?.(request)
          deps.store.set(spec.name, value, by, now())
        }
        applyKeys(deps.env, deps.baseline, deps.store.values())
        // Значение в журнал не пишем — только имя и действие.
        console.error(`[customer-form] ключи: ${spec.name} ${body.reset === true ? 'сброшен к окружению' : 'задан в настройках'}`)
        return json(view())
      },
    }),
    register({
      path: KEYS_CHECK_ROUTE, methods: ['POST'], requestBody: 'buffered',
      fetch: async (request) => {
        if (!deps.isAdmin(request)) return deny()
        const body = (await request.json().catch(() => ({}))) as { name?: unknown }
        const spec = specOf(String(body.name ?? ''))
        const check = spec?.check ? deps.checks[spec.check] : undefined
        if (!spec || !check) return json({ error: 'Для этого ключа нет проверки связи' }, 404)
        let result: CheckResult
        try {
          const r = await Promise.race([check(), new Promise<{ ok: boolean; text: string }>((resolve) => setTimeout(() => resolve({ ok: false, text: 'проверка не ответила за 30 с' }), 30_000))])
          result = { ok: r.ok, text: r.text.slice(0, 300), at: now() }
        } catch (e) {
          result = { ok: false, text: (e as Error).message.slice(0, 300), at: now() }
        }
        deps.store.saveCheck(spec.name, result)
        return json(view())
      },
    }),
  ]
}
