/**
 * Секция «Указания» вверху списка панели (Т13, US-24–25): открытые указания
 * всех инициатив из борда Коробки (open_directives, Т12) — карточками
 * (directives.ts, ядро Т5). PO отвечает прямо здесь (boxSubmit); агентные —
 * статусом (handoff-сессия); трекерные/матриксные — статусом диалога.
 *
 * Поллинг редкий (30с, как остальная панель): указания не горячие на запись,
 * а ответ человека коробка примет когда угодно (accumulate, Т12).
 */
import { useEffect, useState } from 'react'

import type { RpcResult } from '../channel.js'
import { badgeCount, directiveCard, type DirectiveCard } from '../directives.js'
import { panelClassNames as css } from './Panel.styles.js'

interface BoardDirective {
  id: string
  kind: string
  to?: { role?: string; person?: string }
  text?: string
  due?: string
  state?: string
}

interface BoardCard {
  initiative_id: string
  goal?: string
  stage?: string
  waiting_for?: string[]
  latest_iteration_id?: string
  open_directives?: BoardDirective[]
}

export interface DirectivesSectionProps {
  call: (endpoint: string, payload?: unknown) => Promise<RpcResult<unknown>>
}

const EXECUTOR_LABEL: Record<string, string> = {
  human: 'человек', agent: 'агент', box: 'коробка',
}
const ADDRESSEE_LABEL: Record<string, string> = {
  po: 'PO', employee: 'сотрудник', customer: 'заказчик', agent: 'агент',
}

export function badgeOfCards(cards: readonly DirectiveCard[]): number {
  return badgeCount(cards)
}

export function toCards(board: { initiatives?: BoardCard[] }): { card: DirectiveCard; initiative: string; base: string }[] {
  const out: { card: DirectiveCard; initiative: string; base: string }[] = []
  for (const i of board.initiatives ?? []) {
    for (const d of i.open_directives ?? []) {
      out.push({
        card: directiveCard({
          id: d.id, kind: d.kind, to: d.to, text: d.text, due: d.due, state: d.state,
        }),
        initiative: i.initiative_id,
        base: i.latest_iteration_id ?? '',
      })
    }
  }
  return out
}

export function DirectivesSection({ call }: DirectivesSectionProps) {
  const [items, setItems] = useState<ReturnType<typeof toCards>>([])
  const [answering, setAnswering] = useState<{ initiative: string; base: string; id: string } | null>(null)
  const [answer, setAnswer] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      const res = await call('boxBoard')
      if (!alive) return
      if (res.ok) setItems(toCards((res.value as { initiatives?: BoardCard[] }).initiatives ? (res.value as object) : { initiatives: [] }))
      // ошибка — молча: секция не ломает список, повтор через цикл
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 30000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [call])

  const send = async () => {
    if (!answering || !answer.trim()) return
    const res = await call('boxSubmit', {
      initiativeId: answering.initiative,
      baseIteration: answering.base,
      directiveId: answering.id,
      content: answer.trim(),
      idempotencyKey: `ui-${answering.id}-${Date.now()}`,
    })
    setNote(res.ok ? 'Ответ отправлен — конвейер продолжится' : `Не ушло: ${res.error.message}`)
    if (res.ok) { setAnswering(null); setAnswer('') }
  }

  if (items.length === 0 && !note) return null

  return (
    <section className={css.group} style={{ borderColor: 'var(--dsh-accent, #0f62fe)' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '13px' }}>
        Указания <span className={css.badge}>{badgeOfCards(items.map((x) => x.card))}</span>
      </h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map(({ card, initiative, base }) => (
          <li key={`${initiative}-${card.directiveId}`} style={{
            padding: '8px 10px', marginBottom: 6, borderRadius: 8,
            border: card.status === 'overdue' ? '1px solid #b91c1c' : '1px solid var(--dsh-border, #cbd5e1)',
          }}>
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              {card.executor === 'human' ? ADDRESSEE_LABEL[card.addressee] : EXECUTOR_LABEL[card.executor]}
              {card.person ? ` · ${card.person}` : ''} · {initiative.slice(0, 12)}
              {card.deadline ? ` · до ${card.deadline.slice(0, 10)}` : ''}
              {card.status === 'overdue' ? ' · ПРОСРОЧЕНО' : ''}
            </div>
            <div style={{ fontSize: 12.5, margin: '3px 0' }}>{card.title}</div>
            {card.executor === 'human' && card.addressee === 'po' && card.actions.includes('reply') && (
              answering && answering.id === card.directiveId ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    autoFocus
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void send() }}
                    placeholder="Ответ PO…"
                    style={{ flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsh-border, #cbd5e1)', background: 'var(--dsh-bg, #fff)', color: 'inherit' }}
                  />
                  <button type="button" className={css.iconButton} onClick={() => void send()}>→</button>
                </div>
              ) : (
                <button type="button" className={css.iconButton} style={{ fontSize: 12 }}
                        onClick={() => { setAnswering({ initiative, base, id: card.directiveId }); setNote('') }}>
                  Ответить
                </button>
              )
            )}
            {card.executor === 'agent' && <span style={{ fontSize: 11, opacity: 0.7 }}>работа агента (сессия по указанию)</span>}
            {card.executor === 'human' && card.addressee !== 'po' && (
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {card.addressee === 'customer' ? 'ждём ответ в Matrix-комнате' : 'ждём задачу в Трекере'}
              </span>
            )}
          </li>
        ))}
      </ul>
      {note && <p style={{ fontSize: 12, margin: '4px 0 0', color: '#047857' }}>{note}</p>}
    </section>
  )
}
