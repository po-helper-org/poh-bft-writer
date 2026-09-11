/**
 * Карточка раздела «Требования» в настройках харнесса (вкладка «Плагины»): сторона разметки.
 *
 * Собственная вёрстка, а не переиспользование карточки харнесса, потому что переиспользовать
 * нечего: `PluginCard`/`ValueField` живут внутри @deepseek-ai/dsh-client-ui-settings-plugins и
 * значением оттуда не экспортируются — слот на то и keyed, что «карточку рисует сам плагин».
 * Геометрия и токены сняты с того эталона один в один (см. Panel.styles.ts, блок карточки):
 * карточка стоит в одном списке с соседними и обязана быть от них неотличимой.
 *
 * Пока хост не отдаёт пространство имён `bft`, карточка не рисует ничего: полоса, которой
 * нельзя пользоваться, хуже отсутствия полосы.
 */
// Type-only: даёт слияние SlotMap с записью 'settings.plugin.item'.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { useEffect, useRef, useState } from 'react'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'
import type { BftFieldState, BftSettingsCardFace, BftSettingsField } from './settings-card.js'

export type BftSettingsCardProps =
  PropsRuntime<'settings.plugin.item'> &
  PropsLocale<'bft.requirements'> &
  InjectFace<BftSettingsCardFace>

export function SettingsCard(props: BftSettingsCardProps) {
  const { t } = props
  const state = props.useBftSettingsCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const saveStarted = useRef(false)

  // Схлопываем карточку только после того, как запись подтвердилась: отказ должен остаться
  // на экране вместе с несохранёнными правками, иначе PO увидит закрытую карточку и решит,
  // что всё сохранилось.
  useEffect(() => {
    if (state.saving) {
      saveStarted.current = true
      return
    }
    if (!saveStarted.current) return
    saveStarted.current = false
    if (!state.dirty && !state.failed) setOpen(false)
  }, [state.dirty, state.failed, state.saving])

  if (!state.available) return null

  const disabled = !state.writable
  const chevron = `${css.cardChevron}${open ? ` ${css.cardChevronOpen}` : ''}`

  return (
    <li className={`${css.card}${open ? ` ${css.cardOpen}` : ''}`}>
      <button
        type="button"
        className={css.cardHeader}
        aria-expanded={open}
        aria-label={`${t(open ? 'settingsCollapse' : 'settingsExpand')}: ${t('settingsTitle')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.cardHeadText}>
          <span className={css.cardName}>{t('settingsTitle')}</span>
          <span className={css.cardDescription}>{t('settingsDescription')}</span>
        </span>
        {state.dirty && <span className={css.cardPending}>{t('settingsUnsaved')}</span>}
        <IconChevronDownOutline14 className={chevron} />
      </button>
      {open && (
        <div className={css.cardBody}>
          {disabled && <p className={css.cardReadOnly} role="status">{t('settingsReadOnly')}</p>}
          <Field
            id="bft-settings-form-url"
            field="formUrl"
            state={state.formUrl}
            label={t('settingsFormUrl')}
            hint={t('settingsFormUrlHint')}
            t={t}
            disabled={disabled}
            onEdit={props.edit}
            onReset={props.resetField}
          />
          <Field
            id="bft-settings-sheet-url"
            field="sheetUrl"
            state={state.sheetUrl}
            label={t('settingsSheetUrl')}
            hint={t('settingsSheetUrlHint')}
            t={t}
            disabled={disabled}
            onEdit={props.edit}
            onReset={props.resetField}
          />
          <Field
            id="bft-settings-sync-prompt"
            field="syncPrompt"
            state={state.syncPrompt}
            label={t('settingsSyncPrompt')}
            hint={t('settingsSyncPromptHint')}
            t={t}
            disabled={disabled}
            multiline
            onEdit={props.edit}
            onReset={props.resetField}
          />
          <div className={css.cardFooter}>
            {state.failed && <p className={css.cardFailed} role="status">{t('settingsSaveFailed')}</p>}
            <button
              type="button"
              className={css.cardDiscard}
              disabled={!state.dirty || state.saving}
              onClick={props.discard}
            >
              {t('settingsDiscard')}
            </button>
            <button
              type="button"
              className={css.cardSave}
              disabled={!state.dirty || state.invalid || state.saving || disabled}
              onClick={props.save}
            >
              {t(state.saving ? 'settingsSaving' : 'settingsSave')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function Field({ id, field, state, label, hint, t, disabled, multiline, onEdit, onReset }: {
  id: string
  field: BftSettingsField
  state: BftFieldState
  label: string
  hint: string
  t: (key: BftLocaleKey) => string
  disabled: boolean
  /** Промт правится руками и бывает в несколько строк — ему нужна textarea, адресам нет. */
  multiline?: boolean
  onEdit: (field: BftSettingsField, text: string) => void
  onReset: (field: BftSettingsField) => void
}) {
  const control = `${multiline === true ? css.fieldTextarea : css.fieldInput}`
    + `${state.invalid ? ` ${css.fieldInvalidInput}` : ''}`
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <label className={css.fieldLabel} htmlFor={id}>{label}</label>
        {state.overridden && (
          <span className={css.fieldBadges}>
            <span className={css.fieldBadge}>{t('settingsOverridden')}</span>
            <button
              type="button"
              className={css.fieldReset}
              disabled={disabled}
              onClick={() => { onReset(field) }}
            >
              {t('settingsReset')}
            </button>
          </span>
        )}
      </div>
      {multiline === true
        ? (
          <textarea
            id={id}
            className={control}
            rows={4}
            value={state.text}
            disabled={disabled}
            onChange={(event) => { onEdit(field, event.target.value) }}
          />
        )
        : (
          <input
            id={id}
            className={control}
            type="text"
            inputMode="url"
            autoComplete="off"
            {...state.invalid ? { 'aria-invalid': true } : {}}
            value={state.text}
            disabled={disabled}
            onChange={(event) => { onEdit(field, event.target.value) }}
          />
        )}
      <p className={state.invalid ? css.fieldInvalid : css.fieldHint}>
        {state.invalid ? t('settingsInvalidUrl') : hint}
      </p>
    </div>
  )
}
