/**
 * Панели портала заказчика (ADR-0007 rev10).
 *
 *  - AcceptanceTab — правая панель: страница сценария приёмки с узла
 *    (/api/customer-form.demo: UserFlow + раскадровка + замечания). Тип
 *    вкладки забирает адреса plan-review у ui-plan (полоса extension выше
 *    builtin) — карточка согласования сама открывает нашу страницу.
 *  - InputBridge — невидимый участник слота поля ввода (input.right): запоминает
 *    inputActions сессии, чтобы замечание со страницы сразу встало в строку
 *    ввода (как голосовой ввод dsh вставляет распознанный текст).
 *  - InfoView — вкладка Information рядом с Chat: ссылка на заявку и все
 *    материалы диалога — не надо листать переписку.
 */
import { useEffect, useState, type ReactElement } from 'react'

export const ACCEPTANCE_TAB = 'customer-form/acceptance'
export const ACCEPTANCE_PREFIX = 'dsh-resource://customer-acceptance/'

export interface InputActionsLike {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
}

/** Поле ввода каждой сессии, последнее активное — первым. */
export const bridges = new Map<string, InputActionsLike>()
export let lastSessionId: string | undefined

/** Сессия по адресу вкладки: plan-review/<session>/… или customer-acceptance/<session>. */
export function sessionOfAddress(address: string): string | undefined {
  const m = /^dsh-resource:\/\/(?:plan-review|customer-acceptance)\/([^/]+)/.exec(address)
  return m ? decodeURIComponent(m[1]) : undefined
}

interface TabInfo { tab: { navigation: { address: string }; title?: string } }

export function AcceptanceTab({ useTabInfo }: { useTabInfo: () => TabInfo }): ReactElement {
  const address = useTabInfo().tab.navigation.address
  const sessionId = sessionOfAddress(address)
  // Новый адрес (новая версия сценария) — новая загрузка страницы.
  const src = sessionId ? `/api/customer-form.demo?session=${encodeURIComponent(sessionId)}&v=${encodeURIComponent(address)}` : undefined
  if (!src) return <div style={{ padding: 16, opacity: 0.7 }}>Сценарий приёмки не найден.</div>
  return (
    <iframe
      key={src}
      src={src}
      title="Сценарий приёмки"
      data-customer-acceptance={sessionId}
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: 'transparent' }}
    />
  )
}

export function AcceptanceTitle(): ReactElement {
  return <>Сценарий приёмки</>
}

export function InputBridge({ sessionId, inputActions }: { sessionId?: string; inputActions?: InputActionsLike }): null {
  useEffect(() => {
    if (!sessionId || !inputActions) return
    bridges.set(sessionId, inputActions)
    lastSessionId = sessionId
  }, [sessionId, inputActions])
  return null
}

export interface SessionInfo {
  ticket: { taskId: number; url: string; demoApprovedAt?: string } | null
  files: { id: string; name: string; status: 'ready' | 'pending' | 'error'; label: string; error?: string }[]
  demo: { rev: number; title: string; approved: boolean } | null
}

interface InfoProps {
  sessionId: string
  loadInfo(sessionId: string): Promise<SessionInfo | undefined>
  openAcceptance(sessionId: string): void
}

const muted = { opacity: 0.65, fontSize: 13 }
const card = { border: '1px solid rgba(127,127,127,.28)', borderRadius: 12, padding: '12px 14px', margin: '0 0 14px' }

export function InfoView({ sessionId, loadInfo, openAcceptance }: InfoProps): ReactElement {
  const [info, setInfo] = useState<SessionInfo | undefined>()
  useEffect(() => {
    let alive = true
    const tick = () => { void loadInfo(sessionId).then((value) => { if (alive && value) setInfo(value) }).catch(() => undefined) }
    tick()
    const timer = setInterval(tick, 3000) // материалы разбираются в фоне — статус догоняет
    return () => { alive = false; clearInterval(timer) }
  }, [sessionId, loadInfo])
  return (
    <div style={{ padding: '20px 24px', maxWidth: 820, margin: '0 auto', lineHeight: 1.5 }} data-customer-info={sessionId}>
      <div style={card}>
        <div style={muted}>Обращение</div>
        {info?.ticket
          ? <div style={{ fontSize: 16, marginTop: 4 }}>
              <a href={info.ticket.url} target="_blank" rel="noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>Заявка #{info.ticket.taskId}</a>
              <span style={{ ...muted, marginLeft: 8 }}>{info.ticket.url}</span>
            </div>
          : <div style={{ marginTop: 4 }}>{info ? 'Заявка появится после первого сообщения.' : 'Загружаю…'}</div>}
      </div>
      <div style={card}>
        <div style={muted}>Сценарий приёмки</div>
        {info?.demo
          ? <div style={{ marginTop: 4 }}>
              «{info.demo.title}» — {info.demo.approved ? 'согласован' : 'на согласовании'}
              <button type="button" onClick={() => openAcceptance(sessionId)} style={{ marginLeft: 10, cursor: 'pointer', borderRadius: 8, padding: '2px 10px', border: '1px solid rgba(127,127,127,.4)', background: 'transparent', color: 'inherit' }}>Открыть</button>
            </div>
          : <div style={{ marginTop: 4 }}>Ещё не составлен.</div>}
      </div>
      <div style={card}>
        <div style={muted}>Материалы диалога ({info?.files.length ?? 0})</div>
        {info?.files.length
          ? <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {info.files.map((file) => (
                <li key={file.id} data-material={file.name} style={{ margin: '4px 0' }}>
                  <b>{file.id}</b> {file.name}
                  <div style={muted}>{file.status === 'pending' ? 'разбирается…' : file.status === 'error' ? `не разобран: ${file.error ?? ''}` : file.label}</div>
                </li>
              ))}
            </ul>
          : <div style={{ marginTop: 4 }}>Файлов и ссылок пока нет.</div>}
        {info?.ticket && info.files.length ? <div style={{ ...muted, marginTop: 8 }}>Исходные файлы и расшифровки лежат в заявке — по ссылке выше.</div> : null}
      </div>
    </div>
  )
}
