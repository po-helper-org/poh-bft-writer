/**
 * Окно перехода одной кнопкой с доски (Board.tsx): «Оформить влётом» и «Отказ» с карточки
 * DEEP-DONE, «Готово» с карточки OKR-ADDED. Одно окно на три перехода — они различаются
 * только заголовком, подсказкой и тем, обязателен ли комментарий (board-transition.ts);
 * три копии окна разошлись бы при первой же правке геометрии.
 *
 * Тот же приём, что у окна «Добавить в OKR» (OkrDialog.tsx): `Modal` харнесса поверх
 * полноэкранной доски, поля — `.field`/`.fieldInput` карточки настроек, запись — на
 * сервере (`transition`), окно только собирает форму и показывает причину отказа словами.
 * Задачу окно не грузит: ссылки для перехода не нужны, а название карточка уже показала.
 *
 * Отказ без «кто» и «на каком основании» не отправляется — кнопка не активна, а не
 * bad-request после клика: правило доски (`Причина:` в заметках) видно до нажатия.
 */
import { useCallback, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { TRANSITION_RULES, type BoardTransition, type TransitionRequest } from '../board-transition.js'
import type { RpcResult } from '../channel.js'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'

export interface TransitionDialogProps {
  id: string
  kind: BoardTransition
  t: (key: BftLocaleKey) => string
  /** Канал `/bft`, подкоманда `transition`: стадия и строка заметок на доске. */
  transition(payload: TransitionRequest & { id: string }, signal: AbortSignal): Promise<RpcResult<unknown>>
  onClose(): void
  /** Стадия сменилась: доска перечитывает список. */
  onDone(): void
}

/** Копия окна по виду перехода — ключи словаря, не текст: текст живёт в locales.ts. */
const COPY: Record<BoardTransition, {
  title: BftLocaleKey
  description: BftLocaleKey
  placeholder: BftLocaleKey
}> = {
  vlet: { title: 'vletDialogTitle', description: 'vletDialogDescription', placeholder: 'transitionCommentPlaceholderVlet' },
  okrDone: { title: 'okrDoneDialogTitle', description: 'okrDoneDialogDescription', placeholder: 'transitionCommentPlaceholderOkrDone' },
  cancel: { title: 'cancelDialogTitle', description: 'cancelDialogDescription', placeholder: 'transitionCommentPlaceholderCancel' },
}

export function TransitionDialog({ id, kind, t, transition, onClose, onDone }: TransitionDialogProps) {
  const [who, setWho] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const copy = COPY[kind]
  const required = TRANSITION_RULES[kind].commentRequired

  const whoMissing = required && who.trim() === ''
  const commentMissing = required && comment.trim() === ''
  const canSubmit = !submitting && !whoMissing && !commentMissing

  const submit = () => {
    if (!canSubmit) return
    const controller = new AbortController()
    setSubmitting(true)
    setFailure(null)
    transition({ id, kind, who: who.trim(), comment: comment.trim() }, controller.signal)
      .then((result) => {
        setSubmitting(false)
        if (!result.ok) { setFailure(result.error.message); return }
        onDone()
      })
      .catch((error: unknown) => {
        setSubmitting(false)
        setFailure(error instanceof Error ? error.message : String(error))
      })
  }

  // Пока запись идёт, Escape и клик по маске окно не закрывают — тот же приём, что в OkrDialog.
  const close = useCallback(() => { if (!submitting) onClose() }, [submitting, onClose])

  return (
    <Modal
      open
      title={`${t(copy.title)} — ${id}`}
      description={t(copy.description)}
      closeLabel={t('close')}
      onClose={close}
      className={css.okrDialog}
      contentClassName={css.okrContent}
      footer={(
        <>
          {failure !== null && <p className={css.cardFailed} role="alert">{failure}</p>}
          <Button variant="outline" disabled={submitting} onClick={onClose}>{t('okrCancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? t('transitionSubmitting') : t('transitionSubmit')}
          </Button>
        </>
      )}
    >
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('transitionWho')}</span>
        <input
          className={`${css.fieldInput}${whoMissing ? ` ${css.fieldInvalidInput}` : ''}`}
          value={who}
          onChange={event => { setWho(event.target.value) }}
        />
      </label>
      {whoMissing && <p className={css.fieldInvalid}>{t('transitionWhoRequired')}</p>}
      <label className={css.field}>
        <span className={css.fieldLabel}>{t(required ? 'transitionComment' : 'transitionCommentOptional')}</span>
        <textarea
          className={`${css.okrComment}${commentMissing ? ` ${css.fieldInvalidInput}` : ''}`}
          placeholder={t(copy.placeholder)}
          value={comment}
          onChange={event => { setComment(event.target.value) }}
        />
      </label>
      {commentMissing && <p className={css.fieldInvalid}>{t('transitionCommentRequired')}</p>}
    </Modal>
  )
}
