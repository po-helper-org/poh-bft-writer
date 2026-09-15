/**
 * Чат с Claude Code на детальной странице (issue #41).
 *
 * Правая колонка страницы: транскрипт хода, поле «Что сделать по этому БФТ» и
 * кнопка «В чат». Ход идёт на узле (`claude-chat.ts`, подкоманды `chatStart` /
 * `chatPoll` / `chatStop`); здесь — только опрос хвоста событий раз в
 * `POLL_MS` и проекция событий в строки (`projectTranscript`, общий модуль
 * `chat-events.ts`). Состояние хода — у DetailPage: ей же нужно знать, идёт ли
 * работа (анимация на документе) и когда она кончилась (перечитать документ).
 *
 * Итог хода — короткий список правок (формат задаёт черновик, `RESPONSE_FORMAT`
 * в handoff.ts) и кнопка «Открыть детальную страницу»: перечитать задачу и
 * документ заново — то же, что открыть страницу свежей.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Button, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { projectTranscript, type ChatEvent, type ChatLine } from '../chat-events.js'
import type { BftLinks } from '../model.js'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'

/** Интервал опроса узла, пока ход идёт: чаще — лишние вызовы, реже — поток дёргается. */
export const POLL_MS = 700

export type ChatRunStatus = 'running' | 'done' | 'failed' | 'stopped'

/** Что страница знает о ходе Claude Code по требованию. */
export interface ChatRunView {
  runId: string
  status: ChatRunStatus
  events: ChatEvent[]
  /** Сколько событий уже забрано — следующий `since` для опроса. */
  since: number
}

export interface DetailChatProps {
  t: (key: BftLocaleKey) => string
  /** `undefined` — узел ещё не ответил, есть ли чат; `false` — выключен в профиле. */
  available: boolean | undefined
  run: ChatRunView | null
  /** Ход запрошен, узел ещё не ответил идентификатором. */
  starting: boolean
  /** Ошибка запуска или опроса — одной строкой под транскриптом. */
  error: string | null
  promptText: string
  onPromptChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  /** «Открыть детальную страницу»: перечитать задачу и документ. */
  onOpenDetail: () => void
  /**
   * Ссылки требования после перечитывания задачи — эпик JIRA и страница Confluence.
   * Показываются в итоге хода: после `/bft-deliver` они появляются во frontmatter
   * документа, и PO видит их в чате, не ища в тексте ответа.
   */
  links?: Pick<BftLinks, 'epic' | 'confluence'>
}

export function DetailChat({ t, available, run, starting, error, promptText, onPromptChange, onSend, onStop, onOpenDetail, links }: DetailChatProps) {
  const lines = useMemo(() => (run ? projectTranscript(run.events) : []), [run])
  const running = starting || run?.status === 'running'

  // Хвост транскрипта держится в поле зрения, пока PO сам не отмотал вверх:
  // поток дописывается снизу, и без этого он уходил бы за край.
  const logRef = useRef<HTMLDivElement | null>(null)
  const pinnedRef = useRef(true)
  useEffect(() => {
    const log = logRef.current
    if (log && pinnedRef.current) log.scrollTop = log.scrollHeight
  }, [lines])

  const onScroll = () => {
    const log = logRef.current
    if (!log) return
    pinnedRef.current = log.scrollHeight - log.scrollTop - log.clientHeight < 24
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !running) {
      event.preventDefault()
      onSend()
    }
  }

  return (
    <div className={css.chat}>
      <div className={css.previewFieldLabel}>{t('detailChatLabel')}</div>
      <div ref={logRef} className={css.chatLog} onScroll={onScroll} aria-live="polite" aria-busy={running || undefined}>
        {lines.length === 0 && !running && (
          <p className={css.chatEmpty}>{available === false ? t('detailChatUnavailable') : t('detailChatEmpty')}</p>
        )}
        {lines.map(line => <ChatLineView key={line.key} line={line} t={t} />)}
        {starting && <p className={css.chatStatus}>{t('detailChatSending')}</p>}
        {run?.status === 'running' && !starting && (
          <p className={css.chatStatus}>
            <span className={css.chatPulse} aria-hidden="true" />
            {t('detailChatWorking')}
          </p>
        )}
        {run && run.status !== 'running' && !starting && (
          <div className={css.chatResult} data-status={run.status}>
            <p className={css.chatStatus}>
              {run.status === 'done' ? t('detailChatDone') : run.status === 'stopped' ? t('detailChatStopped') : t('detailChatFailed')}
            </p>
            {(links?.epic || links?.confluence) && (
              <p className={css.chatLinks}>
                {links.epic && <a className={css.previewLink} href={links.epic} target="_blank" rel="noopener">{t('detailChatLinkJira')}: {links.epic}</a>}
                {links.confluence && <a className={css.previewLink} href={links.confluence} target="_blank" rel="noopener">{t('detailChatLinkConfluence')}: {links.confluence}</a>}
              </p>
            )}
            <Button variant="outline" onClick={onOpenDetail}>{t('detailChatOpenDetail')}</Button>
          </div>
        )}
        {error && (
          <p className={css.chatError}>
            <IconWarningOutline16 size={14} />
            {error}
          </p>
        )}
      </div>
      <textarea
        className={css.detailTextarea}
        placeholder={t('detailMiniPromptLabel')}
        value={promptText}
        onChange={(event) => { onPromptChange(event.target.value) }}
        onKeyDown={onKeyDown}
      />
      <p className={css.chatHint}>{t('detailChatHint')}</p>
      <div className={css.chatActions}>
        {run?.status === 'running' && !starting && (
          <Button variant="outline" onClick={onStop}>{t('detailChatStop')}</Button>
        )}
        <Button variant="primary" className={css.fullWidth} disabled={running} onClick={onSend}>
          {t('detailMiniPromptSend')}
        </Button>
      </div>
    </div>
  )
}

const URL_RE = /https?:\/\/[^\s<>()"'«»]+/g

/**
 * Текст с кликабельными адресами: итог отгрузки называет эпик и страницу URL-ами, и
 * PO должен открыть их из чата, а не копировать. Markdown не разбирается — только URL.
 * Хвостовые знаки препинания в адрес не входят.
 */
function linkify(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(URL_RE)) {
    const start = match.index ?? 0
    let url = match[0]
    const trailing = /[.,;:!?)\]]+$/.exec(url)
    if (trailing) url = url.slice(0, -trailing[0].length)
    if (start > last) nodes.push(text.slice(last, start))
    nodes.push(<a key={`${start}`} className={css.previewLink} href={url} target="_blank" rel="noopener">{url}</a>)
    last = start + url.length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

function ChatLineView({ line, t }: { line: ChatLine; t: (key: BftLocaleKey) => string }) {
  switch (line.kind) {
    case 'user':
      return <div className={css.chatLine} data-kind="user"><pre className={css.chatText}>{linkify(line.text)}</pre></div>
    case 'assistant':
      return (
        <div className={css.chatLine} data-kind="assistant" data-streaming={line.streaming || undefined}>
          <pre className={css.chatText}>{linkify(line.text)}</pre>
        </div>
      )
    case 'tool':
      return (
        <div className={css.chatLine} data-kind="tool" data-running={line.running || undefined} data-failed={line.failed || undefined}>
          <span className={css.chatTool}>{line.name}</span>
          {line.failed && <span className={css.chatToolState}>{t('detailChatToolFailed')}</span>}
        </div>
      )
    case 'error':
      return (
        <div className={css.chatLine} data-kind="error">
          <pre className={css.chatText}>{line.text}</pre>
        </div>
      )
  }
}
