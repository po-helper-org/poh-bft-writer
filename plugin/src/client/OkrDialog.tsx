/**
 * Окно «Добавить в OKR» — с карточки DEEP-DONE на доске (Board.tsx).
 *
 * Модальное окно харнесса (`Modal` из dsh-client-ui-primitives: портал в body, маска,
 * Escape) поверх полноэкранной доски, а не своя подложка: у доски z-index 30, у окна
 * харнесса — свой слой над всем приложением, и второй самодельный слой пришлось бы
 * подгонять под него вручную. Ширина и прокрутка тела — через `className`/
 * `contentClassName` окна, геометрия полей — те же `.field`/`.fieldInput`, что у карточки
 * настроек (SettingsCard.tsx), отдельной формы не заводим.
 *
 * Поля повторяют карточку KR плагина OKR (`poh-okr-plugin/src/client/KrSidebar.tsx`,
 * раздел «Планирование»): фаза → спринт + ресурсы, команды, техлиды, исполнители. Плюс
 * то, чего у KR нет и что нужно именно при передаче: квартал и свободный комментарий.
 * Ссылки на Confluence и эпик подставляются из требования (`getTask`) — у DEEP-DONE они
 * есть по определению стадии, но остаются редактируемыми: стадию могла поставить доска
 * при пустом frontmatter, и тогда PO вписывает их здесь.
 *
 * Сама запись — на сервере (`addToOkr`, см. okr-handoff.ts): окно только собирает форму
 * и показывает причину отказа словами. Успех закрывает окно и отдаёт доске сигнал
 * перечитать список — карточка уезжает в OKR-ADDED.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RpcResult } from '../channel.js'
import type { BftTask } from '../model.js'
import {
  OKR_PHASES, OKR_SPRINT_COUNT, quarterOptions, type OkrHandoff, type OkrPhase, type OkrPhasePlan,
} from '../okr-handoff.js'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'

export interface OkrDialogProps {
  id: string
  t: (key: BftLocaleKey) => string
  /** Полное требование — ради ссылок Confluence/эпик; в списке доски их нет. */
  getTask(id: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  /** Канал `/bft`, подкоманда `addToOkr`: запись на доску и стадия OKR-ADDED. */
  addToOkr(payload: OkrHandoff & { id: string }, signal: AbortSignal): Promise<RpcResult<unknown>>
  onClose(): void
  /** Требование передано: доска перечитывает список. */
  onDone(): void
}

type Form = Omit<OkrHandoff, 'stages'> & { stages: Record<OkrPhase, OkrPhasePlan> }

function emptyForm(): Form {
  const stages = {} as Record<OkrPhase, OkrPhasePlan>
  for (const phase of OKR_PHASES) stages[phase] = { sprint: null, resources: '' }
  return { confluence: '', epic: '', quarter: '', stages, teams: '', techLeads: '', executors: '', comment: '' }
}

type LoadState = { phase: 'loading' } | { phase: 'ready' } | { phase: 'error'; message: string }

export function OkrDialog({ id, t, getTask, addToOkr, onClose, onDone }: OkrDialogProps) {
  const [form, setForm] = useState<Form>(emptyForm)
  const [load, setLoad] = useState<LoadState>({ phase: 'loading' })
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const quarters = quarterOptions(new Date())

  // Ссылки подтягиваются один раз при открытии — тот же приём, что загрузка задачи в
  // Preview.tsx: AbortController на размонтирование, ошибка — словами с «Повторить».
  const loadTask = useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoad({ phase: 'loading' })
    getTask(id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) { setLoad({ phase: 'error', message: result.error.message }); return }
        const task = result.value as BftTask
        setForm(current => ({
          ...current,
          confluence: task.links?.confluence ?? current.confluence,
          epic: task.links?.epic ?? current.epic,
        }))
        setLoad({ phase: 'ready' })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoad({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      })
  }, [getTask, id])

  useEffect(() => {
    loadTask()
    return () => { controllerRef.current?.abort() }
  }, [loadTask])

  const linksMissing = form.confluence.trim() === '' || form.epic.trim() === ''
  const quarterMissing = form.quarter === ''
  const canSubmit = load.phase === 'ready' && !submitting && !linksMissing && !quarterMissing

  const submit = () => {
    if (!canSubmit) return
    const controller = new AbortController()
    setSubmitting(true)
    setFailure(null)
    addToOkr({ id, ...form }, controller.signal)
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

  // Пока запись идёт, Escape и клик по маске окно не закрывают: PO не должен гадать,
  // ушла ли форма на доску.
  const close = useCallback(() => { if (!submitting) onClose() }, [submitting, onClose])

  const patch = (next: Partial<Form>) => { setForm(current => ({ ...current, ...next })) }
  const patchStage = (phase: OkrPhase, next: Partial<OkrPhasePlan>) => {
    setForm(current => ({
      ...current,
      stages: { ...current.stages, [phase]: { ...current.stages[phase], ...next } },
    }))
  }

  return (
    <Modal
      open
      title={t('okrDialogTitle')}
      description={t('okrDialogDescription')}
      closeLabel={t('close')}
      onClose={close}
      className={css.okrDialog}
      contentClassName={css.okrContent}
      footer={(
        <>
          {failure !== null && <p className={css.cardFailed} role="alert">{failure}</p>}
          <Button variant="outline" disabled={submitting} onClick={onClose}>{t('okrCancel')}</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {submitting ? t('okrSubmitting') : t('okrSubmit')}
          </Button>
        </>
      )}
    >
      {load.phase === 'loading' && <p className={css.fieldHint} aria-busy="true">{t('previewLoading')}</p>}
      {load.phase === 'error' && (
        <div className={css.field}>
          <p className={css.fieldInvalid} role="alert">{load.message}</p>
          <Button variant="outline" onClick={loadTask}>{t('retry')}</Button>
        </div>
      )}

      <div className={css.okrSectionTitle}>{t('okrLinks')}</div>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('okrConfluence')}</span>
        <input
          className={`${css.fieldInput}${form.confluence.trim() === '' ? ` ${css.fieldInvalidInput}` : ''}`}
          value={form.confluence}
          disabled={load.phase !== 'ready'}
          onChange={event => { patch({ confluence: event.target.value }) }}
        />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('okrEpic')}</span>
        <input
          className={`${css.fieldInput}${form.epic.trim() === '' ? ` ${css.fieldInvalidInput}` : ''}`}
          value={form.epic}
          disabled={load.phase !== 'ready'}
          onChange={event => { patch({ epic: event.target.value }) }}
        />
      </label>
      {linksMissing && load.phase === 'ready' && <p className={css.fieldInvalid}>{t('okrRequiredLinks')}</p>}
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('okrQuarter')}</span>
        <select
          className={`${css.fieldInput}${quarterMissing ? ` ${css.fieldInvalidInput}` : ''}`}
          value={form.quarter}
          onChange={event => { patch({ quarter: event.target.value }) }}
        >
          <option value="">{t('okrQuarterEmpty')}</option>
          {quarters.map(quarter => <option key={quarter} value={quarter}>{quarter}</option>)}
        </select>
      </label>
      {quarterMissing && <p className={css.fieldInvalid}>{t('okrRequiredQuarter')}</p>}

      <div className={css.okrSectionTitle}>{t('okrPlanning')}</div>
      <div className={css.okrPlanTable}>
        {OKR_PHASES.map(phase => (
          <div key={phase} className={css.okrPlanRow}>
            <span className={css.okrPhaseLabel}>{phase.toUpperCase()}</span>
            <select
              className={css.fieldInput}
              aria-label={`${phase} sprint`}
              value={form.stages[phase].sprint ?? ''}
              onChange={event => {
                const raw = event.target.value
                patchStage(phase, { sprint: raw === '' ? null : Number(raw) })
              }}
            >
              <option value="">{t('okrNoSprint')}</option>
              {Array.from({ length: OKR_SPRINT_COUNT }, (_, i) => (
                <option key={i} value={i}>{i + 1}</option>
              ))}
            </select>
            <input
              className={css.fieldInput}
              aria-label={`${phase} resources`}
              placeholder={t('okrResources')}
              value={form.stages[phase].resources}
              onChange={event => { patchStage(phase, { resources: event.target.value }) }}
            />
          </div>
        ))}
      </div>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('okrTeams')}</span>
        <input className={css.fieldInput} value={form.teams} onChange={event => { patch({ teams: event.target.value }) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('okrTechLeads')}</span>
        <input className={css.fieldInput} value={form.techLeads} onChange={event => { patch({ techLeads: event.target.value }) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('okrExecutors')}</span>
        <input className={css.fieldInput} value={form.executors} onChange={event => { patch({ executors: event.target.value }) }} />
      </label>
      <label className={css.field}>
        <span className={css.fieldLabel}>{t('okrComment')}</span>
        <textarea
          className={css.okrComment}
          placeholder={t('okrCommentPlaceholder')}
          value={form.comment}
          onChange={event => { patch({ comment: event.target.value }) }}
        />
      </label>
    </Modal>
  )
}
