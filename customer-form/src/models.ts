/**
 * Модели портала (ADR-0012): выбор администратора в «Настройках → Портал».
 *
 * - модель чата — модель dsh по умолчанию (`agentDefaultModel`);
 * - модель полного БФТ — отдельно; не выбрана — та же, что у чата.
 *
 * `saveSelection` пишет в профиль, а профиль пересборка образа засевает
 * заново из customer.patch.yml. Поэтому выбор хранится в томе
 * (`$DSH_HOME/customer-form/models.json`) и применяется ещё и при старте узла:
 * переживает и перезапуск, и пересборку. Порядок для чата: выбор
 * администратора → PORTAL_PROVIDER/PORTAL_MODEL → первый ключ из окружения
 * (customer.patch.yml).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
}

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
    const chat = pick(raw.chat)
    const deep = pick(raw.deep)
    return { ...(chat ? { chat } : {}), ...(deep ? { deep } : {}) }
  } catch {
    return {}
  }
}

export async function writePortalModels(models: PortalModels): Promise<void> {
  await mkdir(dirname(FILE), { recursive: true })
  await writeFile(FILE, `${JSON.stringify(models, null, 2)}\n`, 'utf8')
}

/**
 * Тело POST от раздела «Портал»: `chat` и `deep` — маршрут или null
 * («как по умолчанию»); отсутствующее поле не меняется.
 */
export function mergePortalModels(current: PortalModels, body: unknown): PortalModels {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const next: PortalModels = { ...current }
  for (const key of ['chat', 'deep'] as const) {
    if (!(key in input)) continue
    const route = pick(input[key])
    if (route) next[key] = route
    else delete next[key]
  }
  return next
}

export const sameRoute = (a: ModelRoute | undefined, b: ModelRoute | undefined): boolean =>
  !!a && !!b && a.provider === b.provider && a.model === b.model
