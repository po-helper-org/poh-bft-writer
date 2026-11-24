/**
 * Доступ к MCP портала (ADR-0023): кто пользователь и какие у него токены.
 *
 * Личность — два режима (PORTAL_AUTH):
 *  - `sso` — сервер за Authentik: nginx передаёт X-authentik-username (как вход
 *    администратора, ADMIN_LOGIN=sso); портал своих паролей не хранит.
 *  - `local` (по умолчанию, коробка без Authentik) — пользователи портала:
 *    администратор заводит логин и пароль на странице «Пользователи», человек
 *    входит на странице входа (кука на 12 часов, подписана секретом портала).
 *
 * Токен MCP — личный: человек выпускает его себе сам, видит один раз, может
 * отозвать. Хранится только SHA-256 токена; MCP проверяет Authorization: Bearer.
 * Модель агента — его, токены модели портал не тратит.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'

const DATA = () => join(process.env.DSH_HOME ?? '/data', 'customer-form')

export type AuthMode = 'sso' | 'local'
export const authMode = (env = process.env): AuthMode => (env.PORTAL_AUTH === 'sso' ? 'sso' : 'local')

/** JSON-файл тома: читается при каждом обращении (записей десятки), пишется атомарно. */
class JsonFile<T> {
  constructor(private readonly path: () => string, private readonly empty: () => T) {}
  read(): T {
    try { return JSON.parse(readFileSync(this.path(), 'utf8')) as T } catch { return this.empty() }
  }
  write(value: T): void {
    const file = this.path()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(value, undefined, 1), { encoding: 'utf8', mode: 0o600 })
    renameSync(`${file}.tmp`, file)
  }
}

// ── Пользователи портала (режим local) ──────────────────────────────────────

export interface PortalUser { login: string; name: string; hash: string; createdAt: string; disabled?: boolean }

const LOGIN = /^[a-z0-9][a-z0-9._-]{1,39}$/

function hashPassword(password: string, salt = randomBytes(16).toString('hex')): string {
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString('hex')}`
}

function samePassword(password: string, stored: string): boolean {
  const [kind, salt, hex] = stored.split(':')
  if (kind !== 'scrypt' || !salt || !hex) return false
  const want = Buffer.from(hex, 'hex')
  const got = scryptSync(password, salt, want.length)
  return got.length === want.length && timingSafeEqual(got, want)
}

export class Users {
  private readonly file: JsonFile<PortalUser[]>
  constructor(path = () => join(DATA(), 'users.json')) { this.file = new JsonFile(path, () => []) }

  list(): Omit<PortalUser, 'hash'>[] {
    return this.file.read().map(({ hash: _hash, ...rest }) => rest)
  }

  /** Новый пользователь или новый пароль существующего; ошибка — текстом. */
  save(login: string, name: string, password: string): string | undefined {
    const id = login.trim().toLowerCase()
    if (!LOGIN.test(id)) return 'логин — латиница, цифры, точка, дефис, от 2 до 40 знаков'
    if (password.length < 10) return 'пароль — не короче 10 знаков'
    const all = this.file.read()
    const known = all.find((u) => u.login === id)
    const user: PortalUser = { login: id, name: name.trim().slice(0, 120) || id, hash: hashPassword(password), createdAt: known?.createdAt ?? new Date().toISOString() }
    this.file.write([...all.filter((u) => u.login !== id), user].sort((a, b) => a.login.localeCompare(b.login)))
    return undefined
  }

  setDisabled(login: string, disabled: boolean): boolean {
    const all = this.file.read()
    const user = all.find((u) => u.login === login)
    if (!user) return false
    if (disabled) user.disabled = true
    else delete user.disabled
    this.file.write(all)
    return true
  }

  verify(login: string, password: string): PortalUser | undefined {
    const user = this.file.read().find((u) => u.login === login.trim().toLowerCase())
    // Неизвестный логин — та же работа scrypt: по времени ответа логины не перебрать.
    if (!user) { samePassword(password, hashPassword('x')); return undefined }
    return !user.disabled && samePassword(password, user.hash) ? user : undefined
  }

  active(login: string): boolean {
    return this.file.read().some((u) => u.login === login && !u.disabled)
  }
}

// ── Кука входа (режим local) ────────────────────────────────────────────────

export const SESSION_COOKIE = 'portal_user'
const SESSION_TTL_MS = 12 * 3600_000

/** Секрет подписи куки: свой файл на томе (0600), создаётся при первом входе. */
function secret(path = join(DATA(), 'session-secret')): Buffer {
  try { return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex') } catch { /* нет — создаём */ }
  const fresh = randomBytes(32)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, fresh.toString('hex'), { encoding: 'utf8', mode: 0o600 })
  return fresh
}

export function sessionCookie(login: string, now = Date.now(), key = secret()): string {
  const body = `${login}|${now + SESSION_TTL_MS}`
  const sig = createHmac('sha256', key).update(body).digest('base64url')
  return `${Buffer.from(body).toString('base64url')}.${sig}`
}

export function sessionLogin(value: string | undefined, now = Date.now(), key?: Buffer): string | undefined {
  const [body64, sig] = (value ?? '').split('.')
  if (!body64 || !sig) return undefined
  key ??= secret()
  const body = Buffer.from(body64, 'base64url').toString('utf8')
  const want = createHmac('sha256', key).update(body).digest()
  const got = Buffer.from(sig, 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return undefined
  const [login, expires] = body.split('|')
  return login && Number(expires) > now ? login : undefined
}

export function cookieOf(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return undefined
}

/** Кто открыл страницу портала: SSO — заголовок Authentik, local — подписанная кука действующего пользователя. */
export function whoIs(request: Request, users: Users, mode: AuthMode = authMode()): string | undefined {
  if (mode === 'sso') return (request.headers.get('x-authentik-username') ?? '').trim() || undefined
  const login = sessionLogin(cookieOf(request, SESSION_COOKIE))
  return login && users.active(login) ? login : undefined
}

// ── Токены MCP ──────────────────────────────────────────────────────────────

export interface McpToken { id: string; user: string; name: string; hash: string; prefix: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }
export type McpTokenView = Omit<McpToken, 'hash'>

const TOKEN = /^bftmcp_[A-Za-z0-9_-]{43}$/
const sha = (token: string) => createHash('sha256').update(token).digest('hex')
const MAX_PER_USER = 10

export class McpTokens {
  private readonly file: JsonFile<McpToken[]>
  constructor(path = () => join(DATA(), 'mcp-tokens.json')) { this.file = new JsonFile(path, () => []) }

  list(user: string): McpTokenView[] {
    return this.file.read().filter((t) => t.user === user).map(({ hash: _hash, ...rest }) => rest)
  }

  /** Новый токен: возвращается один раз, на томе — только хэш. */
  issue(user: string, name: string): { token: string; view: McpTokenView } | { error: string } {
    const all = this.file.read()
    if (all.filter((t) => t.user === user && !t.revokedAt).length >= MAX_PER_USER) return { error: `не больше ${MAX_PER_USER} действующих токенов — отзовите ненужный` }
    const token = `bftmcp_${randomBytes(32).toString('base64url')}`
    const record: McpToken = {
      id: randomBytes(6).toString('hex'), user, name: name.trim().slice(0, 80) || 'MCP-клиент', hash: sha(token),
      prefix: token.slice(0, 12), createdAt: new Date().toISOString(),
    }
    this.file.write([...all, record])
    const { hash: _hash, ...view } = record
    return { token, view }
  }

  revoke(user: string, id: string): boolean {
    const all = this.file.read()
    const token = all.find((t) => t.id === id && t.user === user && !t.revokedAt)
    if (!token) return false
    token.revokedAt = new Date().toISOString()
    this.file.write(all)
    return true
  }

  /** Владелец действующего токена; lastUsedAt — не чаще раза в минуту (не пишем файл на каждый вызов). */
  verify(bearer: string | undefined, now = new Date()): string | undefined {
    const token = (bearer ?? '').replace(/^Bearer\s+/i, '').trim()
    if (!TOKEN.test(token)) return undefined
    const want = Buffer.from(sha(token), 'hex')
    const all = this.file.read()
    const found = all.find((t) => !t.revokedAt && timingSafeEqual(Buffer.from(t.hash, 'hex'), want))
    if (!found) return undefined
    if (!found.lastUsedAt || now.getTime() - Date.parse(found.lastUsedAt) > 60_000) {
      found.lastUsedAt = now.toISOString()
      this.file.write(all)
    }
    return found.user
  }
}
