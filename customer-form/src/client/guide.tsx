/**
 * Карточки правой панели «Старт» портала заказчика.
 *
 *  - «Информация» — вкладка-страница с тем же InfoView, что и вкладка
 *    «Информация» рядом с чатом: заявка, сценарий, документы, материалы.
 *  - «Смотреть все заявки» — ссылка на доску всех заявок портала
 *    (/api/customer-form.requests — та же, что под формой стартового экрана),
 *    в новой вкладке браузера: доске в узкой панели тесно. Карточка нарисована
 *    своим рендером слота sidebar.right.tab.guide.entry в виде штатной.
 *
 * Только типы dsh (правило чистоты бандла, tsdown.config.ts).
 */
import type { ReactElement } from 'react'
import { portalHref } from './url.js'

export const INFO_TAB = 'customer-form/info'
export const INFO_KIND = 'customer-info'
export const REQUESTS_TAB = 'customer-form/requests'
export const REQUESTS_KIND = 'customer-requests'
/** Доска «Все заявки» на узле портала (index.ts: REQUESTS_PAGE). */
export const REQUESTS_PAGE = '/api/customer-form.requests'

interface IconProps { size?: number; className?: string }

/** Глиф «Информация»: i в круге, currentColor — как штатные глифы панели. */
export function InfoGlyph({ size = 24, className }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
    </svg>
  )
}

/** Глиф «Все заявки»: стопка карточек. */
export function RequestsGlyph({ size = 24, className }: IconProps): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="7" width="16" height="13" rx="2.5" />
      <path d="M7 4h10" strokeLinecap="round" />
      <path d="M8 12h8M8 15.5h5" strokeLinecap="round" />
    </svg>
  )
}

interface GuideEntryProps {
  kind: string
  title: string
  description?: string
}

/** Карточка «Смотреть все заявки»: ссылка в новой вкладке, вид — как у штатной карточки «Старта». */
export function RequestsGuideEntry({ kind, title, description }: GuideEntryProps): ReactElement {
  return (
    <a
      href={portalHref(REQUESTS_PAGE)}
      target="_blank"
      rel="noreferrer"
      data-sidebar-right-guide-entry={kind}
      style={{
        boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, width: '100%', minHeight: 56, padding: '14px 20px',
        color: 'var(--dsw-alias-label-primary)', textDecoration: 'none', background: 'var(--dsw-alias-bg-layer-1)',
        border: '.5px solid var(--dsw-alias-border-l3)', borderRadius: 'var(--dsl-guide-entry-radius, 16px)', cursor: 'pointer',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-1)' }}
    >
      <span style={{ width: 26, height: 26, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dsw-alias-label-secondary)' }}>
        <RequestsGlyph size={description === undefined ? 22 : 26} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 14, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {description !== undefined && (
          <span style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--dsw-alias-label-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{description}</span>
        )}
      </span>
      <span aria-hidden="true" style={{ flex: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 14 }}>↗</span>
    </a>
  )
}

/** Тело вкладки «Все заявки», если её всё же открыли в панели (меню вкладок): та же доска. */
export function RequestsTab(): ReactElement {
  return (
    <iframe
      src={portalHref(REQUESTS_PAGE)}
      title="Все заявки"
      style={{ border: 0, width: '100%', height: '100%', display: 'block', background: '#fff' }}
    />
  )
}

export function InfoTitle(): ReactElement {
  return <>Информация</>
}

export function RequestsTitle(): ReactElement {
  return <>Все заявки</>
}
