/**
 * data-sources · браузерная половина: «Настройки → Источники данных».
 * Раздел штатных «Настроек» dsh (слот `settings.section`) — только
 * администратору портала: подключить/отключить источник, пробный поиск.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { useEffect, useState, type ComponentType, type CSSProperties, type ReactElement } from 'react'
import { portalHref } from './url.js'

// Имена СЛУЖБ cordis, не пакетов.
export const inject = ['slots']

interface SlotsLike {
  inject(name: string, register: () => () => void): void
  register(options: Record<string, unknown>, component: ComponentType<never>): () => void
}

interface SourceStatus {
  id: string
  name: string
  url: string
  connected: boolean
  /** service — служебный токен моста Hermes: подключать и отключать не нужно. */
  mode?: 'oauth' | 'service'
  label?: string
  connectedAt?: string
  error?: string
  tools: string[]
}

interface Finding {
  kind: 'confluence' | 'jira'
  id: string
  title: string
  url: string
  container?: string
  type?: string
  status?: string
  updated?: string
  snippet: string
}

const s: Record<string, CSSProperties> = {
  wrap: { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 680 },
  title: { fontSize: 18, fontWeight: 600, margin: 0 },
  lead: { opacity: 0.7, margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 },
  card: { border: '1px solid color-mix(in srgb, currentColor 16%, transparent)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 },
  head: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  name: { fontWeight: 600, fontSize: 15 },
  dot: { width: 8, height: 8, borderRadius: 999, display: 'inline-block' },
  muted: { opacity: 0.65, fontSize: 12, lineHeight: 1.5, wordBreak: 'break-all' },
  error: { color: '#dc2626', fontSize: 12, lineHeight: 1.5 },
  button: { font: 'inherit', fontSize: 13, fontWeight: 500, padding: '6px 14px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer', textDecoration: 'none', marginLeft: 'auto' },
  row: { display: 'flex', gap: 8 },
  input: { flex: 1, font: 'inherit', fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid color-mix(in srgb, currentColor 22%, transparent)', background: 'transparent', color: 'inherit' },
  list: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 },
  meta: { opacity: 0.6, fontSize: 11 },
}

function SourceCard(props: { source: SourceStatus; onChange(): void }): ReactElement {
  const { source } = props
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ findings: Finding[]; errors: string[] } | null>(null)

  const disconnect = async () => {
    setBusy(true)
    await fetch(portalHref('/api/data-sources.disconnect'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: source.id }) }).catch(() => undefined)
    setBusy(false)
    props.onChange()
  }
  const search = async () => {
    if (!query.trim()) return
    setBusy(true)
    setFound(null)
    try {
      const res = await fetch(portalHref('/api/data-sources.search'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })
      const body = await res.json() as { findings?: Finding[]; errors?: string[]; error?: string }
      setFound({ findings: body.findings ?? [], errors: body.errors ?? (body.error ? [body.error] : []) })
    } catch (e) {
      setFound({ findings: [], errors: [String(e)] })
    } finally {
      setBusy(false)
      props.onChange()
    }
  }

  return (
    <div style={s.card} data-source={source.id}>
      <div style={s.head}>
        <span style={{ ...s.dot, background: source.connected ? '#16a34a' : '#dc2626' }} aria-hidden />
        <span style={s.name}>{source.name}</span>
        <span style={s.muted} data-source-mode={source.mode ?? 'oauth'}>{source.mode === 'service'
          ? source.label ?? 'подключён служебным токеном Hermes'
          : source.connected ? `подключён${source.connectedAt ? ` ${new Date(source.connectedAt).toLocaleDateString('ru-RU')}` : ''}` : 'не подключён'}</span>
        {source.mode === 'service'
          ? null
          : source.connected
          ? <button type="button" style={s.button} disabled={busy} onClick={() => void disconnect()}>Отключить</button>
          : <a style={s.button} href={portalHref(`/api/data-sources.connect?source=${encodeURIComponent(source.id)}`)}>Подключить</a>}
      </div>
      <span style={s.muted}>MCP: {source.url} · только чтение: {source.tools.join(', ')}</span>
      {source.error && <span style={s.error} role="alert">{source.error}</span>}
      {source.connected && (
        <>
          <div style={s.row}>
            <input style={s.input} aria-label={`Пробный поиск в ${source.name}`} placeholder="Пробный поиск: например, «заявление на отпуск»" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void search() }} />
            <button type="button" style={{ ...s.button, marginLeft: 0 }} disabled={busy || !query.trim()} onClick={() => void search()}>{busy ? 'Ищу…' : 'Найти'}</button>
          </div>
          {found && (
            <div data-source-results>
              {found.errors.map((error) => <div key={error} style={s.error}>{error}</div>)}
              {found.findings.length === 0 && found.errors.length === 0 && <span style={s.muted}>Ничего не нашлось.</span>}
              <ol style={s.list}>
                {found.findings.map((finding) => (
                  <li key={`${finding.kind}:${finding.id}`}>
                    <a href={finding.url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{finding.kind === 'jira' ? `${finding.id} · ` : ''}{finding.title}</a>
                    <div style={s.meta}>{[finding.kind === 'jira' ? 'Jira' : 'Confluence', finding.container, finding.type, finding.status, finding.updated?.slice(0, 10)].filter(Boolean).join(' · ')}</div>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SourcesSection(): ReactElement {
  const [sources, setSources] = useState<SourceStatus[] | null>(null)
  const load = () => fetch(portalHref('/api/data-sources.status'), { cache: 'no-store' })
    .then((res) => res.json() as Promise<{ sources: SourceStatus[] }>)
    .then((body) => setSources(body.sources))
    .catch(() => setSources([]))
  useEffect(() => { void load() }, [])
  return (
    <div style={s.wrap} data-sources-settings>
      <div>
        <h2 style={s.title}>Источники данных</h2>
        <p style={s.lead}>Корпоративные Jira и Confluence. Перед сборкой полного БФТ портал ищет по ним связанные эпики, задачи и страницы и даёт модели как указатель со ссылками — в разделе «Якоря истины» они появятся ссылками. Порталу доступно только чтение.</p>
      </div>
      {sources === null ? <span style={s.muted}>Загружаю…</span> : sources.map((source) => <SourceCard key={source.id} source={source} onChange={() => void load()} />)}
    </div>
  )
}

export function apply(ctx: ClientContext): void {
  const slots = ctx.get('slots') as SlotsLike
  // Раздел — только администратору: статус узла говорит, вошёл ли он.
  void fetch(portalHref('/api/data-sources.status'), { cache: 'no-store', credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() as Promise<{ admin?: boolean }> : undefined))
    .then((status) => {
      if (!status?.admin) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'data-sources', order: 16, label: () => 'Источники данных' },
        SourcesSection as ComponentType<never>,
      ))
    })
    .catch(() => { /* без статуса — раздела нет */ })
}
