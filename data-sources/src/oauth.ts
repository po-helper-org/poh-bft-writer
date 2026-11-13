/**
 * OAuth 2.1 для удалённого MCP (спецификация авторизации MCP): метаданные
 * защищённого ресурса → сервер авторизации → динамическая регистрация клиента
 * → authorization code + PKCE (S256) → access/refresh-токены.
 *
 * Токены и секрет клиента лежат в томе (`$DSH_HOME/data-sources/<id>.json`,
 * права 600) и наружу не отдаются: статус показывает только «подключено».
 */
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface AuthServer {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
  revocation_endpoint?: string
  scopes_supported?: string[]
}

/** Сохранённое подключение одного источника. */
export interface Connection {
  clientId: string
  clientSecret?: string
  redirectUri: string
  tokenEndpoint: string
  revocationEndpoint?: string
  accessToken: string
  refreshToken?: string
  /** Момент истечения access-токена, мс. */
  expiresAt?: number
  connectedAt: string
}

/** Незавершённый вход: живёт в памяти узла до возврата из окна авторизации. */
export interface PendingAuth {
  sourceId: string
  verifier: string
  redirectUri: string
  clientId: string
  clientSecret?: string
  server: AuthServer
  scope?: string
  createdAt: number
}

const ROOT = join(process.env.DSH_HOME ?? '/data', 'data-sources')
const file = (sourceId: string) => join(ROOT, `${sourceId.replace(/[^a-z0-9_-]/gi, '_')}.json`)

export async function loadConnection(sourceId: string): Promise<Connection | undefined> {
  try {
    return JSON.parse(await readFile(file(sourceId), 'utf8')) as Connection
  } catch {
    return undefined
  }
}

export async function saveConnection(sourceId: string, connection: Connection): Promise<void> {
  await mkdir(dirname(file(sourceId)), { recursive: true, mode: 0o700 })
  await writeFile(file(sourceId), JSON.stringify(connection, null, 2), { encoding: 'utf8', mode: 0o600 })
  await chmod(file(sourceId), 0o600)
}

export async function dropConnection(sourceId: string): Promise<void> {
  await rm(file(sourceId), { force: true })
}

async function json<T>(response: Response, what: string): Promise<T> {
  const text = await response.text()
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status} ${text.slice(0, 300)}`)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${what}: ответ не JSON`)
  }
}

/** RFC 9728 → RFC 8414: сервер авторизации ресурса `resourceUrl`. */
export async function discover(resourceUrl: string): Promise<AuthServer> {
  const resource = new URL(resourceUrl)
  const prm = await json<{ authorization_servers?: string[] }>(
    await fetch(`${resource.origin}/.well-known/oauth-protected-resource${resource.pathname.replace(/\/$/, '')}`, { signal: AbortSignal.timeout(15_000) }),
    'метаданные ресурса',
  )
  const issuer = prm.authorization_servers?.[0]
  if (!issuer) throw new Error('ресурс не назвал сервер авторизации')
  const as = new URL(issuer)
  const candidates = [
    `${as.origin}/.well-known/oauth-authorization-server${as.pathname.replace(/\/$/, '')}`,
    `${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
  ]
  let lastError: unknown
  for (const url of candidates) {
    try {
      return await json<AuthServer>(await fetch(url, { signal: AbortSignal.timeout(15_000) }), 'метаданные сервера авторизации')
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('метаданные сервера авторизации не найдены')
}

/** RFC 7591: регистрация клиента портала на сервере авторизации. */
export async function register(server: AuthServer, redirectUri: string, scope?: string): Promise<{ clientId: string; clientSecret?: string }> {
  if (!server.registration_endpoint) throw new Error('сервер авторизации не поддерживает регистрацию клиентов')
  const body = await json<{ client_id: string; client_secret?: string }>(await fetch(server.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Портал БФТ — источники данных',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      ...(scope ? { scope } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  }), 'регистрация клиента')
  return { clientId: body.client_id, ...(body.client_secret ? { clientSecret: body.client_secret } : {}) }
}

const base64url = (buffer: Buffer) => buffer.toString('base64url')

export function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

export function newState(): string {
  return base64url(randomBytes(24))
}

export function authorizeUrl(pending: PendingAuth, challenge: string, state: string, resource: string): string {
  const url = new URL(pending.server.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', pending.clientId)
  url.searchParams.set('redirect_uri', pending.redirectUri)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('resource', resource)
  if (pending.scope) url.searchParams.set('scope', pending.scope)
  return url.toString()
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

async function token(endpoint: string, params: Record<string, string>): Promise<TokenResponse> {
  return json<TokenResponse>(await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  }), 'выдача токена')
}

const expiry = (response: TokenResponse) => (response.expires_in ? Date.now() + response.expires_in * 1000 : undefined)

/** Код из окна авторизации → подключение. */
export async function exchange(pending: PendingAuth, code: string, resource: string): Promise<Connection> {
  const response = await token(pending.server.token_endpoint, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: pending.clientId,
    code_verifier: pending.verifier,
    resource,
    ...(pending.clientSecret ? { client_secret: pending.clientSecret } : {}),
  })
  const expiresAt = expiry(response)
  return {
    clientId: pending.clientId,
    ...(pending.clientSecret ? { clientSecret: pending.clientSecret } : {}),
    redirectUri: pending.redirectUri,
    tokenEndpoint: pending.server.token_endpoint,
    ...(pending.server.revocation_endpoint ? { revocationEndpoint: pending.server.revocation_endpoint } : {}),
    accessToken: response.access_token,
    ...(response.refresh_token ? { refreshToken: response.refresh_token } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    connectedAt: new Date().toISOString(),
  }
}

/** Новый access-токен по refresh-токену; refresh-токен сервер может сменить. */
export async function refresh(connection: Connection, resource: string): Promise<Connection> {
  if (!connection.refreshToken) throw new Error('нет refresh-токена — подключите источник заново')
  const response = await token(connection.tokenEndpoint, {
    grant_type: 'refresh_token',
    refresh_token: connection.refreshToken,
    client_id: connection.clientId,
    resource,
    ...(connection.clientSecret ? { client_secret: connection.clientSecret } : {}),
  })
  const expiresAt = expiry(response)
  return {
    ...connection,
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? connection.refreshToken,
    ...(expiresAt ? { expiresAt } : {}),
  }
}

/** Отзыв токенов при отключении; ошибка отзыва отключению не мешает. */
export async function revoke(connection: Connection): Promise<void> {
  if (!connection.revocationEndpoint) return
  for (const [value, hint] of [[connection.refreshToken, 'refresh_token'], [connection.accessToken, 'access_token']] as const) {
    if (!value) continue
    await fetch(connection.revocationEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: value, token_type_hint: hint, client_id: connection.clientId, ...(connection.clientSecret ? { client_secret: connection.clientSecret } : {}) }).toString(),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  }
}
