/**
 * «Настройки → Портал» (ADR-0012): модель чата заказчика и модель полного БФТ.
 * Раздел штатных «Настроек» dsh (слот `settings.section`), его регистрирует
 * клиент только администратору; сохранение узел тоже принимает только от него.
 * Список моделей — каталог dsh (`session/modelCatalog`): провайдеры с ключом.
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { portalHref } from './url.js'

export const MODELS_ROUTE = '/api/customer-form.portalModels'

type Route = { provider: string; model: string }
type Rpc = (endpoint: string, payload: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>

interface ModelsState {
  /** Модель, которая работает сейчас. */
  chat: Route | null
  /** Выбор администратора; null — по ключам окружения. */
  chatChoice: Route | null
  profile: Route
  deep: Route | null
  deepEnv: Route | null
  /** ИИ-агент правок (ADR-0024): локальные правки и полное ревью. */
  local?: Route | null
  localDefault?: Route
  review?: Route | null
  reviewAgent?: { configured: boolean; model: string | null; url?: string | null; source?: 'settings' | 'env' | null }
  /** Провайдеры, у которых закончился баланс (последние минуты). */
  exhausted?: { provider: string; at: string }[]
}

/** Псевдо-провайдер: полное ревью делает внешний агент полного ревью (models.ts). */
const REVIEW_AGENT = 'review-agent'
const AGENT_KEY = `${REVIEW_AGENT}\u0000agent`

interface Catalog {
  routableProviders: string[]
  groups: { id: string; name: string; models: { id: string; name: string }[] }[]
}

const key = (route: Route | null | undefined) => (route ? `${route.provider}\u0000${route.model}` : '')
const parse = (value: string): Route | null => {
  const [provider, model] = value.split('\u0000')
  return provider && model ? { provider, model } : null
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 },
  title: { fontSize: 18, fontWeight: 600, margin: 0 },
  lead: { opacity: 0.7, margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 },
  row: { display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 16, borderTop: '1px solid color-mix(in srgb, currentColor 14%, transparent)' },
  label: { fontWeight: 500, fontSize: 14 },
  hint: { opacity: 0.65, fontSize: 12, lineHeight: 1.5 },
  select: { font: 'inherit', fontSize: 14, padding: '7px 10px', borderRadius: 8, border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', background: 'transparent', color: 'inherit', maxWidth: 420 },
  actions: { display: 'flex', alignItems: 'center', gap: 12, paddingTop: 4 },
  button: { font: 'inherit', fontSize: 14, fontWeight: 500, padding: '7px 16px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  ok: { fontSize: 13, color: '#16a34a' },
  error: { fontSize: 13, color: '#dc2626' },
  warn: { fontSize: 13, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, border: '1px solid color-mix(in srgb, #d97706 45%, transparent)', background: 'color-mix(in srgb, #d97706 10%, transparent)' },
}

function ModelSelect(props: { id: string; value: string; catalog: Catalog; empty: string; onChange(value: string): void; disabled?: boolean; extra?: { value: string; label: string } }): ReactElement {
  const groups = props.catalog.groups.filter((group) => props.catalog.routableProviders.includes(group.id))
  return (
    <select id={props.id} style={s.select} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">{props.empty}</option>
      {props.extra && <option value={props.extra.value}>{props.extra.label}</option>}
      {groups.map((group) => (
        <optgroup key={group.id} label={group.name}>
          {group.models.map((model) => <option key={model.id} value={key({ provider: group.id, model: model.id })}>{model.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

const label = (catalog: Catalog | null, route: Route | null | undefined): string => {
  if (!route) return '—'
  if (route.provider === REVIEW_AGENT) return 'агент из шлюза агентов'
  const group = catalog?.groups.find((g) => g.id === route.provider)
  const model = group?.models.find((m) => m.id === route.model)
  return `${group?.name ?? route.provider} · ${model?.name ?? route.model}`
}

export function PortalSettings(props: { call: Rpc }): ReactElement {
  const [state, setState] = useState<ModelsState | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [chat, setChat] = useState('')
  const [deep, setDeep] = useState('')
  const [local, setLocal] = useState('')
  const [review, setReview] = useState('')
  const [agentUrl, setAgentUrl] = useState('')
  const [agentKey, setAgentKey] = useState('')
  const [agentModel, setAgentModel] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [models, res] = await Promise.all([
      fetch(portalHref(MODELS_ROUTE), { cache: 'no-store' }).then((r) => r.json() as Promise<ModelsState>),
      props.call('session/modelCatalog', { args: {} }),
    ])
    setState(models)
    setChat(key(models.chatChoice))
    setDeep(key(models.deep))
    setLocal(key(models.local))
    setReview(key(models.review))
    setAgentUrl(models.reviewAgent?.source === 'settings' ? models.reviewAgent.url ?? '' : '')
    setAgentModel(models.reviewAgent?.source === 'settings' ? models.reviewAgent.model ?? '' : '')
    setAgentKey('')
    if (res.ok) setCatalog(res.value as Catalog)
  }
  useEffect(() => { load().catch((e) => setStatus({ ok: false, text: `Не загрузилось: ${String(e)}` })) }, [])

  const fromSettings = state?.reviewAgent?.source === 'settings'
  const agentChanged = !!agentKey.trim()
    || agentUrl.trim() !== (fromSettings ? state?.reviewAgent?.url ?? '' : '')
    || agentModel.trim() !== (fromSettings ? state?.reviewAgent?.model ?? '' : '')
  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(portalHref(MODELS_ROUTE), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Только изменённое: сохранение модели БФТ не трогает модель чата и наоборот.
        body: JSON.stringify({
          ...(chat !== key(state?.chatChoice) ? { chat: parse(chat) } : {}),
          ...(deep !== key(state?.deep) ? { deep: parse(deep) } : {}),
          ...(local !== key(state?.local) ? { local: parse(local) } : {}),
          ...(review !== key(state?.review) ? { review: parse(review) } : {}),
          ...(agentChanged ? { agent: agentUrl.trim() ? { url: agentUrl.trim(), key: agentKey, model: agentModel.trim() } : null } : {}),
        }),
      })
      const body = await res.json() as ModelsState & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState(body)
      setLocal(key(body.local))
      setReview(key(body.review))
      setAgentKey('')
      setStatus({ ok: true, text: 'Сохранено — действует для новых сообщений и следующей сборки БФТ.' })
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setSaving(false)
    }
  }

  if (!state || !catalog) return <div style={s.wrap} data-portal-settings><p style={s.lead}>{status?.text ?? 'Загружаю модели…'}</p></div>
  return (
    <div style={s.wrap} data-portal-settings>
      <div>
        <h2 style={s.title}>Портал</h2>
        <p style={s.lead}>Модели портала заказчика. В списке — провайдеры, у которых есть ключ: ключ задаётся в разделе «Модели».</p>
      </div>
      {!!state.exhausted?.length && (
        <div role="alert" style={s.warn} data-portal-exhausted>
          <strong>Закончился баланс: {state.exhausted.map((m) => `${catalog.groups.find((g) => g.id === m.provider)?.name ?? m.provider} (с ${new Date(m.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })})`).join(', ')}.</strong>{' '}
          Правки ИИ-агента идут через запасную модель, сборка полного БФТ на этом провайдере не пройдёт. Пополните баланс у провайдера или выберите модель другого провайдера и сохраните — после «Сохранить» портал попробует снова.
        </div>
      )}
      <div style={s.row}>
        <label style={s.label} htmlFor="portal-chat-model">Модель чата заказчика</label>
        <ModelSelect id="portal-chat-model" value={chat} catalog={catalog} empty={`По ключам окружения (${label(catalog, state.profile)})`} onChange={setChat} />
        <span style={s.hint}>Сейчас: {label(catalog, state.chat)}. Ведёт диалог, собирает сценарий приёмки и первичные требования.</span>
      </div>
      <div style={s.row}>
        <label style={s.label} htmlFor="portal-deep-model">Модель полного БФТ</label>
        <ModelSelect id="portal-deep-model" value={deep} catalog={catalog} empty="Как у чата" onChange={setDeep} disabled={!!state.deepEnv} />
        <span style={s.hint}>
          {state.deepEnv
            ? `Задана в окружении (PORTAL_DEEP_PROVIDER/MODEL): ${label(catalog, state.deepEnv)}.`
            : 'Пишет полный БФТ по корпоративному канону после «Да, согласен». Можно взять модель сильнее, чем у чата.'}
        </span>
      </div>
      <div style={s.row}>
        <label style={s.label} htmlFor="portal-local-model">ИИ-агент: локальные правки</label>
        <ModelSelect id="portal-local-model" value={local} catalog={catalog} empty={`По умолчанию (${label(catalog, state.localDefault)})`} onChange={setLocal}
          {...(state.reviewAgent?.configured ? { extra: { value: AGENT_KEY, label: 'Агент из шлюза агентов' } } : {})} />
        <span style={s.hint}>Одно замечание со страницы БФТ — одна правка его раздела. Нужна быстрая модель: секунды на замечание. Не ответила — правит модель полного БФТ.</span>
      </div>
      <div style={s.row}>
        <label style={s.label} htmlFor="portal-review-model">ИИ-агент: полное ревью</label>
        <ModelSelect id="portal-review-model" value={review} catalog={catalog}
          empty={state.reviewAgent?.configured ? 'По умолчанию (агент полного ревью)' : 'По умолчанию (модель полного БФТ)'} onChange={setReview}
          {...(state.reviewAgent?.configured ? { extra: { value: AGENT_KEY, label: 'Агент из шлюза агентов' } } : {})} />
        <span style={s.hint}>Проверяет согласованность всего документа после локальных правок (точка у «Комментариев»).</span>
      </div>
      <div style={s.row} data-portal-agent>
        <span style={s.label}>Подключение к шлюзу агентов</span>
        <span style={s.hint}>
          Агент из шлюза агентов (Responses API) — для ИИ-агента правок: выберите его выше в «локальных правках» или «полном ревью».
          Профиль агента — часть адреса: …/p/&lt;профиль&gt;/v1/responses. Агент должен быть без инструментов: в документе — текст заказчика.
          {state.reviewAgent?.source === 'env' ? ' Сейчас подключение задано в окружении сервера; сохранённое здесь его заменит.' : ''}
        </span>
        <label style={s.hint} htmlFor="portal-agent-url">Адрес</label>
        <input id="portal-agent-url" style={s.select} value={agentUrl} placeholder="http://…/p/<профиль>/v1/responses" onChange={(e) => setAgentUrl(e.target.value)} />
        <label style={s.hint} htmlFor="portal-agent-key">Ключ</label>
        <input id="portal-agent-key" type="password" autoComplete="new-password" style={s.select} value={agentKey}
          placeholder={fromSettings ? 'задан — оставьте пустым, чтобы не менять' : 'Bearer-ключ агента'} onChange={(e) => setAgentKey(e.target.value)} />
        <label style={s.hint} htmlFor="portal-agent-model">Модель (необязательно)</label>
        <input id="portal-agent-model" style={s.select} value={agentModel} placeholder="как у профиля" onChange={(e) => setAgentModel(e.target.value)} />
        <span style={s.hint}>{state.reviewAgent?.configured ? `Подключено${state.reviewAgent.source === 'env' ? ' (окружение сервера)' : ''}: ${state.reviewAgent.url ?? ''}` : 'Не подключено. Чтобы отключить сохранённое — очистите адрес и сохраните.'}</span>
      </div>
      <div style={s.actions}>
        <button type="button" style={s.button} onClick={() => void save()} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        {status && <span role="status" style={status.ok ? s.ok : s.error}>{status.text}</span>}
      </div>
    </div>
  )
}
