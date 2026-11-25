/**
 * «Ключи и доступы» (ADR-0030): все ключи портала в одном месте.
 *
 * - Реестр `KEY_SPECS`: какие ключи есть, зачем, кто ими пользуется, можно ли задать из
 *   настроек и как проверить связь.
 * - Хранилище `KeyStore`: значения, заданные администратором в «Настройках», — файл на томе
 *   данных портала (`<DSH_HOME>/portal-keys/keys.json`, каталог 700, файл 600). Его читают
 *   портал и исполнитель публикации (общий том). Значение, заданное здесь, главнее окружения
 *   сервера; «Сбросить» возвращает значение окружения.
 * - Статус ключа — без значения: задан ли, откуда (настройки / окружение сервера), когда
 *   менялся и кем, результат последней проверки. Значение наружу не отдаётся никогда:
 *   ни в браузер, ни в журнал, ни в историю Temporal.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type KeyGroup = 'models' | 'sources' | 'confluence' | 'tracker' | 'materials' | 'agents' | 'access'
export type KeyCheck = 'confluence-write' | 'data-sources' | 'google'

export interface KeySpec {
  name: string
  title: string
  group: KeyGroup
  /** Что даёт ключ и кто им пользуется. */
  purpose: string
  /** Секрет (поле только на запись) или настройка (адрес — показывается). */
  secret: boolean
  /** Можно задать здесь: потребитель читает значение при каждом использовании. */
  editable: boolean
  /** Где задаётся, если не здесь (раздел, скрипт). */
  elsewhere?: string
  check?: KeyCheck
  /** Нужен ли ключ обязательно, чтобы работала функция (для подсказки «не задан»). */
  required?: boolean
}

export const KEY_GROUPS: Record<KeyGroup, string> = {
  models: 'Модели',
  sources: 'Источники: Jira и Confluence (чтение)',
  confluence: 'Confluence: публикация БФТ',
  tracker: 'Трекер',
  materials: 'Материалы заявки',
  agents: 'ИИ-агенты',
  access: 'Вход и доступ',
}

export const KEY_SPECS: readonly KeySpec[] = [
  { name: 'ANTHROPIC_API_KEY', title: 'Anthropic', group: 'models', secret: true, editable: false, purpose: 'Модели чата, полного БФТ и правок', elsewhere: '«Настройки → Модели» (ключи провайдеров) или harness/set-key.sh' },
  { name: 'ZAI_CODING_API_KEY', title: 'Z.AI Coding', group: 'models', secret: true, editable: false, purpose: 'Модели GLM для чата и БФТ', elsewhere: '«Настройки → Модели» или harness/set-key.sh' },
  { name: 'REQUESTY_API_KEY', title: 'Requesty', group: 'models', secret: true, editable: false, purpose: 'Шлюз моделей (быстрые правки ИИ-агента по умолчанию)', elsewhere: '«Настройки → Модели» или harness/set-key.sh' },
  { name: 'DATA_SOURCES_URL_ATLASSIAN', title: 'Адрес шлюза источников', group: 'sources', secret: false, editable: false, purpose: 'Поиск и чтение Jira/Confluence для чата и разведки', elsewhere: 'server.env → deploy-server.sh' },
  { name: 'DATA_SOURCES_TOKEN_ATLASSIAN', title: 'Токен шлюза источников', group: 'sources', secret: true, editable: false, check: 'data-sources', purpose: 'Доступ портала к шлюзу только на чтение', elsewhere: 'выпускает harness/deploy/install-sources-gateway.sh (шлюз хранит только хэш)' },
  { name: 'CONFLUENCE_PUBLISH_URL', title: 'Адрес Confluence', group: 'confluence', secret: false, editable: true, purpose: 'Куда публикуется БФТ («⇪ В Confluence»); для Cloud — с /wiki' },
  { name: 'CONFLUENCE_PUBLISH_USER', title: 'Пользователь (только Cloud)', group: 'confluence', secret: false, editable: true, purpose: 'Email владельца API-токена; для Server/DC — пусто' },
  { name: 'CONFLUENCE_PUBLISH_TOKEN', title: 'Ключ записи', group: 'confluence', secret: true, editable: true, check: 'confluence-write', required: true, purpose: 'Создание и обновление страниц БФТ; есть только у исполнителя публикации' },
  { name: 'TRACKER_PASSWORD', title: 'Пароль служебной учётки трекера', group: 'tracker', secret: true, editable: false, purpose: 'Заявки, комментарии, вложения', elsewhere: 'harness/.env (TRACKER_ADMIN_PASSWORD, ставит start.sh)' },
  { name: 'GOOGLE_DRIVE_API_KEY', title: 'Google Drive API', group: 'materials', secret: true, editable: true, check: 'google', purpose: 'Ссылки на папки Google — список файлов через API (без ключа — открытый экспорт)' },
  { name: 'BFT_REVIEW_AGENT_KEY', title: 'Ключ агента полного ревью', group: 'agents', secret: true, editable: true, purpose: 'ИИ-агент правок: полное ревью через шлюз агентов (адрес — «Настройки → Портал»)' },
  { name: 'ADMIN_PASSWORD', title: 'Секрет входа администратора', group: 'access', secret: true, editable: false, purpose: 'Подпись куки администратора (при входе через Authentik пароль не вводится)', elsewhere: 'harness/.env (создаёт start.sh); смена гасит все входы' },
]

export const specOf = (name: string): KeySpec | undefined => KEY_SPECS.find((k) => k.name === name)

interface Stored { value: string; changedAt: string; by?: string }
export interface CheckResult { ok: boolean; at: string; text: string }
interface StoreFile { keys: Record<string, Stored>; checks?: Record<string, CheckResult> }

export interface KeyStatus {
  name: string
  title: string
  group: KeyGroup
  purpose: string
  secret: boolean
  editable: boolean
  elsewhere?: string
  /** Задан (значение не пустое). */
  set: boolean
  /** settings — задан здесь; env — окружение сервера (harness/.env); none — не задан. */
  source: 'settings' | 'env' | 'none'
  changedAt?: string
  by?: string
  /** Окружение тоже задаёт ключ — «Сбросить» вернёт его. */
  envSet: boolean
  /** Несекретная настройка (адрес) — показывается как есть. */
  value?: string
  checkable: boolean
  lastCheck?: CheckResult
  required?: boolean
}

const MAX_VALUE = 4096

/** Значение ключа: без пробелов и переводов строк внутри, не длиннее 4 КБ. */
export function validateKeyValue(spec: KeySpec, raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('значение — строка')
  const value = raw.trim()
  if (!value) throw new Error('пустое значение — для сброса есть «Сбросить»')
  if (value.length > MAX_VALUE) throw new Error('слишком длинное значение')
  if (/[\s\u0000-\u001f]/.test(value) && spec.secret) throw new Error('в ключе пробелы или переводы строк')
  if (/[\r\n\u0000]/.test(value)) throw new Error('перевод строки в значении')
  if (spec.name.endsWith('_URL') && !/^https?:\/\/[^\s]+$/.test(value)) throw new Error('адрес — http(s)://…')
  return value
}

export class KeyStore {
  constructor(readonly dir = join(process.env.DSH_HOME ?? '/data', 'portal-keys')) {}

  private get file(): string { return join(this.dir, 'keys.json') }

  read(): StoreFile {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile
      return { keys: data.keys ?? {}, ...(data.checks ? { checks: data.checks } : {}) }
    } catch {
      return { keys: {} }
    }
  }

  private write(data: StoreFile): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    try { chmodSync(this.dir, 0o700) } catch { /* чужой каталог — не наш случай */ }
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
    chmodSync(tmp, 0o600)
    renameSync(tmp, this.file)
  }

  /** Значения, заданные в настройках (для подстановки в окружение процесса). */
  values(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [name, s] of Object.entries(this.read().keys)) if (s.value) out[name] = s.value
    return out
  }

  set(name: string, value: string, by?: string, at = new Date().toISOString()): void {
    const data = this.read()
    data.keys[name] = { value, changedAt: at, ...(by ? { by } : {}) }
    if (data.checks) delete data.checks[name]
    this.write(data)
  }

  unset(name: string): void {
    const data = this.read()
    delete data.keys[name]
    if (data.checks) delete data.checks[name]
    this.write(data)
  }

  saveCheck(name: string, result: CheckResult): void {
    const data = this.read()
    data.checks = { ...(data.checks ?? {}), [name]: result }
    this.write(data)
  }

  exists(): boolean { return existsSync(this.file) }
}

/** Статусы всех ключей; `baseline` — окружение процесса до подстановки значений из настроек. */
export function keyStatuses(store: StoreFile, baseline: NodeJS.ProcessEnv): KeyStatus[] {
  return KEY_SPECS.map((spec) => {
    const saved = store.keys[spec.name]
    const envValue = (baseline[spec.name] ?? '').trim()
    const source = saved?.value ? 'settings' as const : envValue ? 'env' as const : 'none' as const
    const value = saved?.value ?? envValue
    const check = store.checks?.[spec.name]
    return {
      name: spec.name, title: spec.title, group: spec.group, purpose: spec.purpose, secret: spec.secret, editable: spec.editable,
      ...(spec.elsewhere ? { elsewhere: spec.elsewhere } : {}),
      set: !!value, source, envSet: !!envValue,
      ...(saved ? { changedAt: saved.changedAt, ...(saved.by ? { by: saved.by } : {}) } : {}),
      ...(!spec.secret && value ? { value } : {}),
      checkable: !!spec.check,
      ...(check ? { lastCheck: check } : {}),
      ...(spec.required ? { required: true } : {}),
    }
  })
}

/**
 * Подставить значения из настроек в окружение процесса: потребители, которые читают ключ при
 * каждом использовании (process.env), сразу видят новое значение. Сброшенный ключ возвращается
 * к значению окружения сервера (`baseline`).
 */
export function applyKeys(env: NodeJS.ProcessEnv, baseline: NodeJS.ProcessEnv, values: Record<string, string>): void {
  for (const spec of KEY_SPECS) {
    if (!spec.editable) continue
    const v = values[spec.name]
    if (v) env[spec.name] = v
    else if (baseline[spec.name] !== undefined) env[spec.name] = baseline[spec.name]
    else delete env[spec.name]
  }
}
