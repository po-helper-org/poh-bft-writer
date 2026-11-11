/**
 * Страница раздела «Требования» в «Настройках → Плагины» харнесса: сторона разметки.
 *
 * Ядро 0.2: страница — вкладка в слоте `settings.plugins.tab`; карточки в общем списке
 * плагинов (слот `settings.plugin.item` ядра 0.1.2) больше нет.
 */
// Type-only: даёт слияние SlotMap с записью 'settings.plugins.tab'.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'
import type { BftFieldState, BftSettingsCardFace, BftSettingsField } from './settings-card.js'

export type BftSettingsCardProps =
  PropsRuntime<'settings.plugins.tab'> &
  PropsLocale<'bft.requirements'> &
  InjectFace<BftSettingsCardFace>

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

/**
 * Поля и кнопки формы страницы раздела.
 */
function SettingsBody(props: Pick<BftSettingsCardProps, 't' | 'useBftSettingsCard' | 'edit' | 'resetField' | 'discard' | 'save'>) {
  const { t } = props
  const state = props.useBftSettingsCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
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
  )
}

/**
 * Вкладка «Требования» в «Настройках → Плагины». Пока хост не отдаёт запись
 * `bft-requirements`, регистрации нет вовсе (см. whileServed в client/index.tsx).
 */
export function SettingsPage(props: BftSettingsCardProps) {
  const { t } = props
  const state = props.useBftSettingsCard(snapshot => snapshot)
  if (!state.available) return <p className={css.cardReadOnly} role="status">{t('settingsUnavailable')}</p>
  return <SettingsBody {...props} />
}
