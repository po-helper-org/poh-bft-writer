/**
 * Модели портала (ADR-0012): выбор администратора в «Настройках → Портал».
 *
 * - модель чата — модель dsh по умолчанию (`agentDefaultModel`);
 * - модель полного БФТ — отдельно; не выбрана — та же, что у чата;
 * - ИИ-агент правок (ADR-0024): локальные правки — быстрая модель (по умолчанию
 *   Haiku), полное ревью — агент полного ревью (`REVIEW_AGENT`, шлюз агентов из
 *   окружения) или любая модель dsh.
 *
 * `saveSelection` пишет в профиль, а профиль пересборка образа засевает
 * заново из customer.patch.yml. Поэтому выбор хранится в томе
 * (`$DSH_HOME/customer-form/models.json`) и применяется ещё и при старте узла:
 * переживает и перезапуск, и пересборку. Порядок для чата: выбор
 * администратора → PORTAL_PROVIDER/PORTAL_MODEL → первый ключ из окружения
 * (customer.patch.yml).
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const MODELS_ROUTE = '/api/customer-form.portalModels'

export interface ModelRoute {
  provider: string
  model: string
}

export interface PortalModels {
  /** Модель чата заказчика; нет — профиль (окружение). */
  chat?: ModelRoute
  /** Модель полного БФТ; нет — та же, что у чата. */
  deep?: ModelRoute
  /** Локальные правки ИИ-агента; нет — PORTAL_LOCAL_PROVIDER/MODEL или DEFAULT_LOCAL. */
  local?: ModelRoute
  /** Полное ревью; нет — агент полного ревью, если настроен, иначе модель полного БФТ. */
  review?: ModelRoute
  /**
   * Подключение к шлюзу агентов (Responses API) — из «Настройки → Портал»;
   * нет — из окружения (BFT_REVIEW_AGENT_*). Ключ наружу не отдаётся.
   */
  agent?: AgentConnection
}

export interface AgentConnection {
  /** Полный адрес метода ответа, профиль — в пути (…/p/<профиль>/v1/responses). */
  url: string
  key: string
  model?: string
}

const isUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\/\S+$/.test(value.trim()) && value.length <= 500
const pickAgent = (value: unknown): AgentConnection | undefined => {
  const v = value as Partial<AgentConnection> | null
  if (!v || typeof v !== 'object' || !isUrl(v.url) || typeof v.key !== 'string' || !v.key.trim()) return undefined
  const model = typeof v.model === 'string' ? v.model.trim().slice(0, 200) : ''
  return { url: v.url.trim(), key: v.key.trim(), ...(model ? { model } : {}) }
}

/** Быстрая модель локальных правок по умолчанию. */
export const DEFAULT_LOCAL: ModelRoute = { provider: 'requesty', model: 'anthropic/claude-haiku-5-5' }
/** Псевдо-провайдер: полное ревью делает внешний агент (review-agent.ts). */
export const REVIEW_AGENT = 'review-agent'
const KEYS = ['chat', 'deep', 'local', 'review'] as const

const FILE = join(process.env.DSH_HOME ?? '/data', 'customer-form', 'models.json')

const isRoute = (value: unknown): value is ModelRoute =>
  !!value && typeof value === 'object'
  && typeof (value as ModelRoute).provider === 'string' && (value as ModelRoute).provider.length > 0
  && typeof (value as ModelRoute).model === 'string' && (value as ModelRoute).model.length > 0

const pick = (value: unknown): ModelRoute | undefined =>
  isRoute(value) ? { provider: value.provider, model: value.model } : undefined

export async function readPortalModels(): Promise<PortalModels> {
  try {
    const raw = JSON.parse(await readFile(FILE, 'utf8')) as Record<string, unknown>
    const out: PortalModels = {}
    for (const key of KEYS) {
      const route = pick(raw[key])
      if (route) out[key] = route
    }
    const agent = pickAgent(raw.agent)
    if (agent) out.agent = agent
    return out
  } catch {
    return {}
  }
}

export async function writePortalModels(models: PortalModels): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true })
  // Ключ шлюза агентов — в этом файле: читать только узлу.
  await writeFile(FILE, `${JSON.stringify(models, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(FILE, 0o600).catch(() => undefined)
}

/**
 * Тело POST от раздела «Портал»: `chat`, `deep`, `local`, `review` — маршрут или null
 * («как по умолчанию»); отсутствующее поле не меняется.
 */
export function mergePortalModels(current: PortalModels, body: unknown): PortalModels {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const next: PortalModels = { ...current }
  for (const key of KEYS) {
    if (!(key in input)) continue
    const route = pick(input[key])
    if (route) next[key] = route
    else delete next[key]
  }
  if ('agent' in input) {
    // Ключ — только на запись: пустой при сохранении — прежний.
    const raw = input.agent as Partial<AgentConnection> | null
    const agent = raw && typeof raw === 'object' ? pickAgent({ ...raw, key: typeof raw.key === 'string' && raw.key.trim() ? raw.key : current.agent?.key }) : undefined
    if (agent) next.agent = agent
    else if (raw === null) delete next.agent
    else throw new Error('подключение к шлюзу агентов: нужен адрес http(s)://… и ключ')
  }
  return next
}

export const sameRoute = (a: ModelRoute | undefined, b: ModelRoute | undefined): boolean =>
  !!a && !!b && a.provider === b.provider && a.model === b.model
