/**
 * Клиент REST Vikunja — единственный движок оркестрации (ADR-0004, ADR-0009).
 *
 * Токен Vikunja 2.x живёт минуты, а узел — сутками: на 401 перелогиниваемся
 * один раз и повторяем запрос.
 */

export interface TrackerCfg {
  url: string
  publicUrl: string
  user: string
  password: string
}

export function trackerCfgFromEnv(env: NodeJS.ProcessEnv): TrackerCfg {
  return {
    url: (env.TRACKER_URL ?? 'http://tracker:3456/api/v1').replace(/\/$/, ''),
    publicUrl: (env.TRACKER_PUBLIC_URL ?? 'http://127.0.0.1:3456').replace(/\/$/, ''),
    user: env.TRACKER_USER ?? 'bft-admin',
    password: env.TRACKER_PASSWORD ?? '',
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export class TrackerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export class Tracker {
  private token = ''

  constructor(readonly cfg: TrackerCfg, private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {}

  get<T>(path: string): Promise<T> {
    return this.call<T>('GET', path)
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('PUT', path, body)
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.call<T>('POST', path, body)
  }

  delete<T>(path: string): Promise<T> {
    return this.call<T>('DELETE', path)
  }

  private async call<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.login()}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await this.fetchImpl(`${this.cfg.url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (res.status === 401 && !retried) {
      this.token = ''
      return this.call<T>(method, path, body, true)
    }
    const text = await res.text()
    if (!res.ok) throw new TrackerError(res.status, `трекер: ${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
    return (text ? JSON.parse(text) : {}) as T
  }

  private async login(): Promise<string> {
    if (this.token) return this.token
    const res = await this.fetchImpl(`${this.cfg.url}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.cfg.user, password: this.cfg.password }),
    })
    if (!res.ok) throw new TrackerError(res.status, `трекер: вход ${res.status}`)
    this.token = ((await res.json()) as { token: string }).token
    return this.token
  }
}
