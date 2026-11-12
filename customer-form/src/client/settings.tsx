/**
 * «Настройки → Портал» (ADR-0012): модель чата заказчика и модель полного БФТ.
 * Раздел штатных «Настроек» dsh (слот `settings.section`), его регистрирует
 * клиент только администратору; сохранение узел тоже принимает только от него.
 * Список моделей — каталог dsh (`session/modelCatalog`): провайдеры с ключом.
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'

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
}

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
}

function ModelSelect(props: { id: string; value: string; catalog: Catalog; empty: string; onChange(value: string): void; disabled?: boolean }): ReactElement {
  const groups = props.catalog.groups.filter((group) => props.catalog.routableProviders.includes(group.id))
  return (
    <select id={props.id} style={s.select} value={props.value} disabled={props.disabled} onChange={(event) => props.onChange(event.target.value)}>
      <option value="">{props.empty}</option>
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
  const group = catalog?.groups.find((g) => g.id === route.provider)
  const model = group?.models.find((m) => m.id === route.model)
  return `${group?.name ?? route.provider} · ${model?.name ?? route.model}`
}

export function PortalSettings(props: { call: Rpc }): ReactElement {
  const [state, setState] = useState<ModelsState | null>(null)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [chat, setChat] = useState('')
  const [deep, setDeep] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const [models, res] = await Promise.all([
      fetch(MODELS_ROUTE, { cache: 'no-store' }).then((r) => r.json() as Promise<ModelsState>),
      props.call('session/modelCatalog', { args: {} }),
    ])
    setState(models)
    setChat(key(models.chatChoice))
    setDeep(key(models.deep))
    if (res.ok) setCatalog(res.value as Catalog)
  }
  useEffect(() => { load().catch((e) => setStatus({ ok: false, text: `Не загрузилось: ${String(e)}` })) }, [])

  const save = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(MODELS_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Только изменённое: сохранение модели БФТ не трогает модель чата и наоборот.
        body: JSON.stringify({
          ...(chat !== key(state?.chatChoice) ? { chat: parse(chat) } : {}),
          ...(deep !== key(state?.deep) ? { deep: parse(deep) } : {}),
        }),
      })
      const body = await res.json() as ModelsState & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState(body)
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
      <div style={s.actions}>
        <button type="button" style={s.button} onClick={() => void save()} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        {status && <span role="status" style={status.ok ? s.ok : s.error}>{status.text}</span>}
      </div>
    </div>
  )
}
