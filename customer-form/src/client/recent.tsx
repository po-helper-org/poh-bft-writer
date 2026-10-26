/**
 * «Мои обращения» под формой стартового экрана (ADR-0007 rev12).
 *
 * Входа у заказчика нет, поэтому «мои» — сессии, которые открывал этот браузер
 * (localStorage); заявки и статусы по ним отдаёт узел (/api/customer-form.myRequests).
 * Клик по обращению открывает его чат dsh, «Смотреть все обращения» — доска
 * «Запросы» трекера.
 *
 * Слот hero.agentPreset рисуется только на пустом стартовом экране и стоит над
 * формой; сам список порталом уходит под форму — в конец места композера.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

const STORAGE_KEY = 'customer-form/sessions'
/** Потолок записей после чистки: сессии с заявкой не вытесняются пустыми. */
const MAX_REMEMBERED = 200
const SHOWN = 5

export interface RequestSummary {
  sessionId: string
  taskId: number
  url: string
  title: string
  created: string
  status?: string
  demoApproved: boolean
}

export interface MyRequests {
  items: RequestSummary[]
  boardUrl: string
}

/**
 * Сессия, которую открывал этот браузер. Каждый вход в портал — новая сессия,
 * а заявка появляется только после первого сообщения, поэтому пустые сессии
 * чистятся (pruneSessions), иначе частые входы вытеснили бы обращения.
 */
interface Remembered { id: string; at: number }

const EMPTY_TTL_MS = 24 * 60 * 60 * 1000

function readSessions(): Remembered[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    if (!Array.isArray(parsed)) return []
    // Ранний формат — просто id: считаем их старыми, с заявкой они уцелеют.
    return parsed.flatMap((entry): Remembered[] => typeof entry === 'string' ? [{ id: entry, at: 0 }]
      : entry && typeof entry.id === 'string' ? [{ id: entry.id, at: Number(entry.at) || 0 }] : [])
  } catch {
    return []
  }
}

function writeSessions(entries: Remembered[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch { /* приватное окно — список просто не запомнится */ }
}

/** Сессии этого браузера, свежие первыми. Хранилище может быть недоступно. */
export function rememberedSessions(): string[] {
  return readSessions().map((entry) => entry.id)
}

export function rememberSession(sessionId: string): void {
  writeSessions([{ id: sessionId, at: Date.now() }, ...readSessions().filter((entry) => entry.id !== sessionId)])
}

/** Оставить сессии с заявкой и свежие (их, может быть, ещё заполняют в другой вкладке). */
function pruneSessions(withTicket: ReadonlySet<string>): void {
  const now = Date.now()
  writeSessions(readSessions().filter((entry) => withTicket.has(entry.id) || now - entry.at < EMPTY_TTL_MS).slice(0, MAX_REMEMBERED))
}

interface Props {
  sessionId?: string
  loadRequests(sessionIds: string[]): Promise<MyRequests | undefined>
  openSession(sessionId: string): void
}

function when(iso: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export function RecentRequests({ sessionId, loadRequests, openSession }: Props): ReactElement {
  const anchor = useRef<HTMLSpanElement>(null)
  const [target, setTarget] = useState<HTMLElement>()
  const [data, setData] = useState<MyRequests>()
  const [width, setWidth] = useState<number>()

  // Контейнер под формой: последний ребёнок места композера (flex-колонка).
  useLayoutEffect(() => {
    const seat = anchor.current?.closest('[data-composer-seat]')
    if (!seat) return
    const box = document.createElement('div')
    box.setAttribute('data-customer-recent', '')
    seat.appendChild(box)
    setTarget(box)
    // Ширина — как у формы: список читается её продолжением.
    // Якорь слота — display: contents (ширина 0): меряем карточку формы внутри
    // него, без неё — колонку вокруг.
    const slot = seat.querySelector('[data-slot="conversation.composer.bar"]')
    const bar = slot?.firstElementChild?.firstElementChild ?? slot?.parentElement
    const observer = new ResizeObserver(() => {
      const w = bar?.getBoundingClientRect().width ?? 0
      if (w > 0) setWidth(w)
    })
    if (bar) observer.observe(bar)
    return () => { observer.disconnect(); box.remove() }
  }, [])

  useEffect(() => {
    const ids = rememberedSessions().filter((id) => id !== sessionId)
    if (!ids.length) return
    let alive = true
    void loadRequests(ids).then((value) => {
      if (!value) return
      pruneSessions(new Set(value.items.map((item) => item.sessionId)))
      if (alive) setData(value)
    }).catch(() => undefined)
    return () => { alive = false }
  }, [sessionId, loadRequests])

  const items = data?.items ?? []
  const list = items.length && target
    ? createPortal(
        <section aria-label="Мои обращения" style={{ width: width ?? '100%', maxWidth: '100%', margin: '28px auto 0', boxSizing: 'border-box' }}>
          <div style={{ fontSize: 13, opacity: 0.65, margin: '0 4px 8px' }}>Мои обращения</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: '1px solid rgba(127,127,127,.25)', borderRadius: 12, overflow: 'hidden' }}>
            {items.slice(0, SHOWN).map((item, i) => (
              <li key={item.sessionId} style={{ borderTop: i ? '1px solid rgba(127,127,127,.18)' : 'none' }}>
                <button
                  type="button"
                  data-request={item.taskId}
                  onClick={() => openSession(item.sessionId)}
                  title="Открыть диалог по обращению"
                  style={{ all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'baseline', gap: 10, width: '100%', padding: '10px 14px', cursor: 'pointer' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(127,127,127,.10)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.6, fontSize: 13, flex: 'none' }}>#{item.taskId}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{item.title}</span>
                  {item.status && <span style={{ flex: 'none', fontSize: 12, padding: '1px 8px', borderRadius: 999, border: '1px solid rgba(127,127,127,.35)', opacity: 0.85 }}>{item.status}</span>}
                  <span style={{ flex: 'none', fontSize: 12, opacity: 0.55, minWidth: 48, textAlign: 'right' }}>{when(item.created)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 4px 0', fontSize: 13 }}>
            <span style={{ opacity: 0.55 }}>{items.length > SHOWN ? `Показаны последние ${SHOWN} из ${items.length}` : ''}</span>
            <a href={data!.boardUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>Смотреть все обращения →</a>
          </div>
        </section>,
        target,
      )
    : null
  return <span ref={anchor} style={{ display: 'none' }}>{list}</span>
}
