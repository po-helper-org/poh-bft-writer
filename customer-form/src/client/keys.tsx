/**
 * «Настройки → Ключи и доступы» (ADR-0030): все ключи портала одним списком.
 * У каждого — задан ли, откуда (настройки / окружение сервера), когда менялся, проверка связи.
 * Поле значения — только на запись: значение никогда не приходит в браузер.
 */
import { useEffect, useState, type CSSProperties, type ReactElement } from 'react'
import { portalHref } from './url.js'

export const KEYS_ROUTE = '/api/customer-form.keys'
export const KEYS_CHECK_ROUTE = '/api/customer-form.keysCheck'

interface KeyStatus {
  name: string
  title: string
  group: string
  purpose: string
  secret: boolean
  editable: boolean
  elsewhere?: string
  set: boolean
  source: 'settings' | 'env' | 'none'
  changedAt?: string
  by?: string
  envSet: boolean
  value?: string
  checkable: boolean
  lastCheck?: { ok: boolean; at: string; text: string }
  required?: boolean
}
interface KeysView { groups: Record<string, string>; keys: KeyStatus[] }

const line = 'color-mix(in srgb, currentColor 14%, transparent)'
const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 },
  title: { fontSize: 18, fontWeight: 600, margin: 0 },
  lead: { opacity: 0.7, margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 },
  group: { fontSize: 12, textTransform: 'uppercase', letterSpacing: '.05em', opacity: 0.6, margin: '8px 0 0' },
  key: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderTop: `1px solid ${line}` },
  head: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  name: { fontWeight: 500, fontSize: 14 },
  env: { fontFamily: 'ui-monospace, monospace', fontSize: 11, opacity: 0.55 },
  hint: { opacity: 0.65, fontSize: 12, lineHeight: 1.5 },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  input: { font: 'inherit', fontSize: 13, padding: '6px 9px', borderRadius: 8, border: `1px solid color-mix(in srgb, currentColor 22%, transparent)`, background: 'transparent', color: 'inherit', minWidth: 260, flex: 1 },
  button: { font: 'inherit', fontSize: 13, padding: '5px 12px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  ghost: { font: 'inherit', fontSize: 13, padding: '5px 12px', borderRadius: 8, border: `1px solid ${line}`, background: 'transparent', color: 'inherit', cursor: 'pointer' },
  ok: { color: '#16a34a', fontSize: 12 },
  bad: { color: '#dc2626', fontSize: 12 },
  pill: { fontSize: 11, padding: '1px 8px', borderRadius: 10, border: `1px solid ${line}` },
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

function sourceText(k: KeyStatus): string {
  if (k.source === 'settings') return `задан здесь${k.changedAt ? ` ${when(k.changedAt)}` : ''}${k.by ? ` · ${k.by}` : ''}${k.envSet ? ' · перекрывает окружение сервера' : ''}`
  if (k.source === 'env') return 'задан в окружении сервера (harness/.env) · дата смены неизвестна'
  return 'не задан'
}

async function send(path: string, body: unknown): Promise<KeysView> {
  const res = await fetch(portalHref(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json() as KeysView & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json
}

function KeyRow(props: { k: KeyStatus; onView(v: KeysView): void }): ReactElement {
  const { k } = props
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (body: unknown, path = KEYS_ROUTE) => {
    setBusy(true)
    setError('')
    try {
      props.onView(await send(path, body))
      setValue('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={s.key} data-key={k.name}>
      <div style={s.head}>
        <span style={s.name}>{k.title}</span>
        <span style={s.env}>{k.name}</span>
        <span style={{ ...s.pill, ...(k.set ? s.ok : k.required ? s.bad : {}) }} data-key-state>{k.set ? 'задан' : 'не задан'}</span>
      </div>
      <span style={s.hint}>{k.purpose}</span>
      <span style={s.hint} data-key-source>{sourceText(k)}{!k.secret && k.value ? ` · ${k.value}` : ''}</span>
      {k.lastCheck && <span style={k.lastCheck.ok ? s.ok : s.bad} data-key-check>Проверка {when(k.lastCheck.at)}: {k.lastCheck.text}</span>}
      {k.editable ? (
        <div style={s.row}>
          <input style={s.input} type={k.secret ? 'password' : 'text'} autoComplete="new-password" value={value} aria-label={`Новое значение: ${k.title}`}
            placeholder={k.secret ? (k.set ? 'задан — введите новый, чтобы заменить' : 'вставьте ключ') : (k.value ?? 'https://…')}
            onChange={(e) => setValue(e.target.value)} />
          <button type="button" style={s.button} disabled={busy || !value.trim()} onClick={() => void run({ name: k.name, value })}>{k.set ? 'Заменить' : 'Задать'}</button>
          {k.source === 'settings' && <button type="button" style={s.ghost} disabled={busy} onClick={() => void run({ name: k.name, reset: true })}>{k.envSet ? 'Вернуть из окружения' : 'Сбросить'}</button>}
          {k.checkable && <button type="button" style={s.ghost} disabled={busy} onClick={() => void run({ name: k.name }, KEYS_CHECK_ROUTE)}>Проверить связь</button>}
        </div>
      ) : (
        <div style={s.row}>
          <span style={s.hint}>Задаётся не здесь: {k.elsewhere ?? 'окружение сервера'}.</span>
          {k.checkable && <button type="button" style={s.ghost} disabled={busy} onClick={() => void run({ name: k.name }, KEYS_CHECK_ROUTE)}>Проверить связь</button>}
        </div>
      )}
      {!k.checkable && k.set && <span style={s.hint}>Проверки связи нет — ошибка ключа будет видна там, где он используется.</span>}
      {error && <span role="alert" style={s.bad}>{error}</span>}
    </div>
  )
}

export function KeysSettings(): ReactElement {
  const [view, setView] = useState<KeysView | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch(portalHref(KEYS_ROUTE), { cache: 'no-store' })
      .then(async (r) => { const j = await r.json() as KeysView & { error?: string }; if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setView(j) })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }, [])
  if (!view) return <div style={s.wrap} data-portal-keys><p style={s.lead}>{error || 'Загружаю ключи…'}</p></div>
  const groups = Object.keys(view.groups).filter((g) => view.keys.some((k) => k.group === g))
  return (
    <div style={s.wrap} data-portal-keys>
      <div>
        <h2 style={s.title}>Ключи и доступы</h2>
        <p style={s.lead}>
          Все ключи портала: задан ли, откуда взят, когда менялся, есть ли связь. Значения не показываются никогда — поле только на запись.
          Заданное здесь главнее окружения сервера и действует без перезапуска; «Вернуть из окружения» снимает его.
        </p>
      </div>
      {groups.map((g) => (
        <div key={g}>
          <h3 style={s.group}>{view.groups[g]}</h3>
          {view.keys.filter((k) => k.group === g).map((k) => <KeyRow key={k.name} k={k} onView={setView} />)}
        </div>
      ))}
    </div>
  )
}
