/**
 * Служебные «📌 …» портала (заявка зарегистрирована, сценарий согласован) в чате.
 *
 * Узел вставляет их сообщением роли user (иначе чат dsh спрячет их как
 * контекст, а это ссылка заказчику на заявку). Пока ход идёт, такое сообщение
 * dsh рисует строкой steering, а у неё нет слота conversation.chat.user.before,
 * поэтому отметка ставится в самом тексте: правило userText ядра (как /команды
 * ui-goal) узнаёт ведущий «📌» и отдаёт его ключевому слоту
 * conversation.user.text.node — здесь он рисуется пометкой «Портал · …», а
 * стиль NOTE_CSS прижимает такую строку влево и снимает с неё пузырь
 * заказчика: это не его реплика.
 *
 * Только типы dsh (правило чистоты бандла, tsdown.config.ts).
 */
import type { ReactElement } from 'react'

export type PortalNoteKind = 'ticket' | 'demo' | 'note'

const PIN = '📌'

/** Какая строка портала: по тексту (узел пишет их сам, формулировки фиксированы). */
export function portalNoteKind(text: string): PortalNoteKind | undefined {
  if (!text.startsWith(PIN)) return undefined
  const rest = text.slice(PIN.length).trimStart()
  if (rest.startsWith('Заявка #')) return 'ticket'
  if (rest.startsWith('Сценарий приёмки')) return 'demo'
  return 'note'
}

/** Правило userText ядра: ведущий «📌» сообщения — узел portal-note. */
export const PORTAL_NOTE_RULE = {
  id: 'portal-note',
  order: 5,
  match(text: string, from: number): { id: 'portal-note'; start: number; end: number; data: { note: PortalNoteKind } } | undefined {
    if (from !== 0) return undefined
    const note = portalNoteKind(text)
    return note ? { id: 'portal-note', start: 0, end: PIN.length, data: { note } } : undefined
  },
}

const TITLES: Record<PortalNoteKind, string> = { ticket: 'Портал · заявка', demo: 'Портал · сценарий приёмки', note: 'Портал' }

/** Узел portal-note в тексте сообщения: пометка вместо «📌». */
export function PortalNoteMark({ node }: { node: { data: { note: PortalNoteKind } } }): ReactElement {
  return <span data-portal-note={node.data.note}>{TITLES[node.data.note] ?? TITLES.note}</span>
}

/** Строка портала — слева, без пузыря заказчика (и заказчику, и администратору). */
export const NOTE_CSS = `
[class*="_userRow"]:has([data-portal-note]) { align-items: flex-start !important; justify-content: flex-start !important; }
[class*="_userRow"]:has([data-portal-note]) > * { align-self: flex-start !important; margin-left: 0 !important; }
[class*="_userRow"]:has([data-portal-note]) [class*="_userStack"] { align-items: flex-start !important; max-width: 100% !important; }
[class*="_userRow"]:has([data-portal-note]) [data-message-bubble] {
  background: transparent !important; border: 0 !important; border-left: 2px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)) !important;
  border-radius: 0 !important; padding: 2px 0 2px 12px !important; font-size: 13px; opacity: .85;
}
[data-portal-note] {
  display: block; margin-bottom: 4px; font: 600 11px/1.2 system-ui, sans-serif; letter-spacing: .02em; text-transform: uppercase; opacity: .6;
}
`
