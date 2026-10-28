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
 *  - BftTab / BftWatcher — быстрая версия БФТ в правой панели (rev15): новая
 *    версия документа открывается сама, страница отправляет замечания и
 *    согласование сообщением в чат.
 */
import { useEffect, useState, type ReactElement } from 'react'

export const ACCEPTANCE_TAB = 'customer-form/acceptance'
export const ACCEPTANCE_PREFIX = 'dsh-resource://customer-acceptance/'

export interface InputActionsLike {
  captureInsertion(): unknown
  insertText(text: string, span: unknown): boolean
  /** Заменить черновик целиком и отправить — сообщения со страницы документа БФТ. */
  setDraft(text: string): void
  submit(): void
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

export const BFT_TAB = 'customer-form/bft-fast'
export const BFT_PREFIX = 'dsh-resource://customer-bft/'

/** Сессия по адресу вкладки документа: customer-bft/<session>/<метка>. */
export function sessionOfBftAddress(address: string): string | undefined {
  const m = /^dsh-resource:\/\/customer-bft\/([^/]+)/.exec(address)
  return m ? decodeURIComponent(m[1]) : undefined
}

/** Правая панель: быстрая версия БФТ со слоем заказчика (rev15). */
export function BftTab({ useTabInfo }: { useTabInfo: () => TabInfo }): ReactElement {
  const address = useTabInfo().tab.navigation.address
  const sessionId = sessionOfBftAddress(address)
  if (!sessionId) return <div style={{ padding: 16, opacity: 0.7 }}>Документ не найден.</div>
  const src = `/api/customer-form.bftFast?session=${encodeURIComponent(sessionId)}&v=${encodeURIComponent(address)}`
  return (
    <iframe
      key={src}
      src={src}
      title="Документ БФТ"
      data-customer-bft={sessionId}
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: '#fff' }}
    />
  )
}

export function BftTitle(): ReactElement {
  return <>Документ БФТ</>
}

/** Задаёт клиент при старте: чем читать состояние сессии и как открыть документ. */
export const bftWatch: { loadInfo?: (sessionId: string) => Promise<SessionInfo | undefined>; openBft?: (sessionId: string) => void } = {}

/**
 * Невидимый наблюдатель чата: началась сборка документа (заказчик нажал
 * «Согласую» — справа экран ожидания, rev16) или собралась новая версия —
 * открыть правую панель. Уже открытый чат со старым документом панель не
 * трогает: открывает только смена состояния.
 */
export function BftWatcher({ sessionId }: { sessionId?: string }): null {
  useEffect(() => {
    if (!sessionId) return
    let alive = true
    let seen: string | null | undefined
    const tick = () => {
      void bftWatch.loadInfo?.(sessionId).then((info) => {
        if (!alive || !info) return
        const fast = info.bftFast
        const key = fast ? (fast.building ? 'building' : fast.rev) : null
        // Сборку показываем и при первом опросе: заказчик только что нажал «Согласую».
        const opened = key === 'building' ? seen !== 'building' : seen !== undefined && !!key && key !== seen
        if (opened) bftWatch.openBft?.(sessionId)
        seen = key
      }).catch(() => undefined)
    }
    tick()
    const timer = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [sessionId])
  return null
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
  /** Быстрая версия БФТ, если документ собран (rev14): версия — хэш, согласование — этой версии. */
  bftFast?: { url: string; rev: string | null; approvedAt: string | null; building: boolean } | null
}

interface InfoProps {
  sessionId: string
  loadInfo(sessionId: string): Promise<SessionInfo | undefined>
  openAcceptance(sessionId: string): void
  openBft(sessionId: string): void
}

const muted = { opacity: 0.65, fontSize: 13 }
const card = { border: '1px solid rgba(127,127,127,.28)', borderRadius: 12, padding: '12px 14px', margin: '0 0 14px' }

export function InfoView({ sessionId, loadInfo, openAcceptance, openBft }: InfoProps): ReactElement {
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
        <div style={muted}>Быстрая версия БФТ</div>
        {info?.bftFast
          ? <div style={{ marginTop: 4 }}>
              {info.bftFast.building ? 'собирается…' : info.bftFast.approvedAt ? `согласован ${new Date(info.bftFast.approvedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` : 'на согласовании'}
              <button type="button" data-bft-fast onClick={() => openBft(sessionId)} style={{ marginLeft: 10, cursor: 'pointer', borderRadius: 8, padding: '2px 10px', border: '1px solid rgba(127,127,127,.4)', background: 'transparent', color: 'inherit' }}>Открыть</button>
            </div>
          : <div style={{ marginTop: 4 }}>Соберётся в чате после подтверждения заявки.</div>}
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
