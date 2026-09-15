/**
 * Сессия по требованию на экране: подписи состояния, точка в строке списка и карточке
 * доски, блок «Последняя сессия» в превью и на детальной странице.
 *
 * Отдельный модуль, а не часть Panel.tsx: его импортируют и Panel, и Preview, и
 * DetailPage, и Board, а Panel рендерит остальные три — общий источник третьим модулем
 * убирает цикл импортов (тот же приём, что stage-tone.ts).
 */
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'
import type { SessionView } from './session-view.js'

/** Подпись состояния сессии — одна на все поверхности: строка, карточка, превью. */
export function sessionStateLabel(state: SessionView['state'], t: (key: BftLocaleKey) => string): string {
  switch (state) {
    case 'running': return t('sessionRunning')
    case 'idle': return t('sessionIdle')
    case 'failed': return t('sessionFailed')
    case 'gone': return t('sessionGone')
  }
}

/** «сегодня» / «3 д.» — коротко, для строки списка и карточки доски. */
export function sessionAgeShort(days: number, t: (key: BftLocaleKey) => string): string {
  return days === 0 ? t('sessionToday') : `${days} ${t('sessionDays')}`
}

/**
 * Точка состояния сессии и давность справа в строке. Состояние — про работу, не про
 * документ: полоса слева говорит, что собрано, точка справа — идёт ли по этому кто-то и
 * когда трогали. Сессии нет — ничего: пустая точка выглядела бы как «ждёт», а это неправда.
 */
export function SessionMark({ session, t }: { session: SessionView | null; t: (key: BftLocaleKey) => string }) {
  if (!session) return null
  const label = `${sessionStateLabel(session.state, t)} · ${sessionAgeShort(session.days, t)}`
  return (
    <span className={css.itemSession} title={label} aria-label={label}>
      <span className={css.sessionDot} data-state={session.state} aria-hidden="true" />
      {sessionAgeShort(session.days, t)}
    </span>
  )
}

/**
 * Блок «Последняя сессия» — общий для превью и детальной страницы. Сессии нет — прочерком не
 * обходимся: «из раздела ещё не работали» отвечает на вопрос, который PO задаёт этим блоком.
 */
export function SessionSummary(
  { session, t, onOpen }:
  { session: SessionView | null; t: (key: BftLocaleKey) => string; onOpen(sessionId: string): void },
) {
  if (!session) return <p>{t('previewSessionNone')}</p>
  const age = session.days === 0 ? t('sessionToday') : `${session.days} ${t('sessionDaysAgo')}`
  return (
    <>
      <p style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className={css.sessionDot} data-state={session.state} aria-hidden="true" />
        <span>{sessionStateLabel(session.state, t)}</span>
        <span>· {age}</span>
        {session.title && <span>· {session.title}</span>}
      </p>
      {session.canOpen
        ? (
          <button type="button" className={css.previewLinkButton} onClick={() => { onOpen(session.id) }}>
            {t('previewSessionOpen')}
          </button>
          )
        // Сессия Claude Code в харнессе не открывается — её чат на детальной странице.
        : <p>{t(session.kind === 'claude' ? 'previewSessionClaude' : 'previewSessionGone')}</p>}
    </>
  )
}
