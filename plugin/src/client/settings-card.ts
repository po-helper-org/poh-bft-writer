/**
 * Карточка настроек раздела «Требования» на вкладке «Плагины»: сторона состояния.
 *
 * Правки копятся черновиком и уезжают в документ настроек ОДНОЙ операцией по кнопке
 * «Сохранить», а не на каждое нажатие клавиши: документ общий, каждая запись — поход на хост
 * с проверкой ревизии, и посимвольная отправка ссылки означала бы десяток отклонённых записей
 * на одно осмысленное изменение.
 *
 * Своей копии значений здесь нет: единственный источник — снимок `SettingsScope`, черновик
 * лежит поверх него. Поэтому правка из другой поверхности видна сразу, а несохранённые правки
 * PO при этом не пропадают.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_SETTINGS, normalizeUrl, resolveSettings, type BftSettings } from '../settings.js'

/** Поля карточки в порядке показа. */
export const SETTINGS_FIELDS = ['formUrl', 'sheetUrl', 'syncPrompt'] as const

export type BftSettingsField = typeof SETTINGS_FIELDS[number]

/** Поля-адреса: у них есть проверка схемы, у промта её нет. */
const URL_FIELDS: ReadonlySet<BftSettingsField> = new Set<BftSettingsField>(['formUrl', 'sheetUrl'])

/** Что карточка показывает про одно поле. */
export interface BftFieldState {
  /** Текст в поле: черновик, если он есть, иначе значение из документа. */
  text: string
  /** Значение задано пользователем поверх слоя композиции (у `sheetUrl` — поверх окружения). */
  overridden: boolean
  /** Введено что-то, что этим полем не принимается. */
  invalid: boolean
}

/** Что карточка показывает целиком. */
export interface BftSettingsCardState {
  /** Хост отдаёт это пространство имён; иначе карточки не должно быть видно вовсе. */
  available: boolean
  /** Документ настроек принимает записи (в memory-режиме — нет). */
  writable: boolean
  /** Есть несохранённые правки. */
  dirty: boolean
  /** Хотя бы одно поле не проходит проверку — сохранение заблокировано. */
  invalid: boolean
  /** Запись в пути. */
  saving: boolean
  /** Прошлая запись не доехала: документ отдал не то, что мы писали. */
  failed: boolean
  formUrl: BftFieldState
  sheetUrl: BftFieldState
  syncPrompt: BftFieldState
}

/** Лицо, которое регистрация карточки отдаёт в слот. */
export interface BftSettingsCardFace {
  hooks: {
    /** Снимок карточки; рендерер связывает его как useBftSettingsCard. */
    bftSettingsCard: SnapshotStore<BftSettingsCardState>
  }
  /** Положить текст поля в черновик. */
  edit: (field: BftSettingsField, text: string) => void
  /** Положить в черновик очистку поля: оно вернётся к слою композиции. */
  resetField: (field: BftSettingsField) => void
  /** Выбросить черновик целиком. */
  discard: () => void
  /** Записать черновик в документ настроек. */
  save: () => void
}

/**
 * Черновик одного поля: строка — введённый текст, `null` — заказанная очистка,
 * отсутствие ключа — поле не трогали.
 */
type Draft = Map<BftSettingsField, string | null>

/**
 * Операция записи в документ настроек — форма `SettingsPathOpView` службы, суженная до наших
 * полей: все три строковые, других значений карточка не пишет. Размеченное объединение, а не
 * объект с необязательным `value`: у `unset` значения не бывает вовсе.
 */
type SettingsOp =
  | { op: 'set'; path: string[]; value: string }
  | { op: 'unset'; path: string[] }

/** Связывает пространство имён `bft` с карточкой настроек. */
export class SettingsCardController {
  private readonly store: SnapshotStore<BftSettingsCardState>
  private readonly drafts: Draft = new Map()
  private saving = false
  private failed = false
  /** Сравнивается со следующей проекцией: снимок не должен меняться, когда факт не сдвинулся. */
  private published: string

  /** @param scope - привязанный скоуп пространства имён `bft`. */
  constructor(private readonly scope: SettingsScope<BftSettings>) {
    const initial = this.projection()
    this.published = JSON.stringify(initial)
    this.store = createSnapshotStore<BftSettingsCardState>(initial)
    // Документ правится и с других поверхностей: карточка обязана показывать текущее
    // состояние, а не то, что было при открытии страницы.
    scope.subscribe(() => { this.publish() })
  }

  /** @returns лицо, которое регистрация карточки отдаёт в слот. */
  inject(): BftSettingsCardFace {
    return {
      hooks: { bftSettingsCard: this.store },
      edit: (field, text) => { this.stage(field, text) },
      resetField: (field) => { this.stage(field, null) },
      discard: () => {
        this.drafts.clear()
        this.failed = false
        this.publish()
      },
      save: () => { this.save() },
    }
  }

  private stage(field: BftSettingsField, value: string | null): void {
    this.drafts.set(field, value)
    // Прошлая неудача перестаёт быть новостью, как только PO что-то поменял.
    this.failed = false
    this.publish()
  }

  private publish(): void {
    const next = this.projection()
    const serialized = JSON.stringify(next)
    if (serialized === this.published) return
    this.published = serialized
    this.store.set(next)
  }

  private projection(): BftSettingsCardState {
    const snapshot = this.scope.getSnapshot()
    const fields = {
      formUrl: this.field('formUrl'),
      sheetUrl: this.field('sheetUrl'),
      syncPrompt: this.field('syncPrompt'),
    }
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: SETTINGS_FIELDS.some(field => this.isDirty(field)),
      invalid: SETTINGS_FIELDS.some(field => fields[field].invalid),
      saving: this.saving,
      failed: this.failed,
      ...fields,
    }
  }

  private field(field: BftSettingsField): BftFieldState {
    const text = this.text(field)
    return {
      text,
      overridden: this.isOverridden(field),
      invalid: URL_FIELDS.has(field) && normalizeUrl(text) === undefined,
    }
  }

  /** Черновик поверх документа: строка — как ввели, `null` — как будет после очистки. */
  private text(field: BftSettingsField): string {
    const draft = this.drafts.get(field)
    if (draft === null) return this.inherited(field)
    return draft ?? this.stored(field)
  }

  /** Значение из документа настроек, уже слоённое хостом. */
  private stored(field: BftSettingsField): string {
    return resolveSettings(this.scope.getSnapshot().value)[field]
  }

  /**
   * Значение, к которому поле вернётся после очистки: слой композиции, а нет его — умолчание
   * схемы. Для `sheetUrl` слой композиции — это `BFT_INITIATIVES_SHEET_URL` из окружения
   * процесса харнесса (см. регистрацию пространства имён в src/plugin.ts).
   */
  private inherited(field: BftSettingsField): string {
    const base = this.scope.getSnapshot().base
    const value = typeof base === 'object' && base !== null
      ? (base as Record<string, unknown>)[field]
      : undefined
    return typeof value === 'string' ? value : DEFAULT_SETTINGS[field]
  }

  /**
   * Переопределение — это ПРИСУТСТВИЕ поля в пользовательском слое, а не отличие значения:
   * значение, совпавшее со слоем композиции, всё равно записано пользователем, и сравнением
   * значений этого не увидеть.
   */
  private isOverridden(field: BftSettingsField): boolean {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null && field in (user as Record<string, unknown>)
  }

  private isDirty(field: BftSettingsField): boolean {
    const draft = this.drafts.get(field)
    if (draft === undefined) return false
    // Очистка поля, которое и так ничем не переопределено, ничего не меняет.
    if (draft === null) return this.isOverridden(field)
    return draft !== this.stored(field)
  }

  private save(): void {
    if (this.saving) return
    const ops: SettingsOp[] = []
    /** Что документ должен вернуть после записи — по нему и проверяем, доехала ли она. */
    const expected = new Map<BftSettingsField, string>()
    for (const field of SETTINGS_FIELDS) {
      if (!this.isDirty(field)) continue
      const draft = this.drafts.get(field)
      if (draft === null || draft === undefined) {
        ops.push({ op: 'unset', path: [field] })
        expected.set(field, this.inherited(field))
        continue
      }
      // Кнопка «Сохранить» заблокирована, пока хоть одно поле не проходит проверку, поэтому
      // normalizeUrl здесь уже не может вернуть undefined; `?? ''` — страховка типа, не ветка.
      const value = URL_FIELDS.has(field) ? normalizeUrl(draft) ?? '' : draft
      ops.push({ op: 'set', path: [field], value })
      // Через resolveSettings, а не как есть: документ вернётся тем же путём, каким мы его
      // читаем, и сравнивать надо после одинаковой нормализации, иначе «сохранил пустой промт»
      // всегда выглядело бы неудачей.
      expected.set(field, resolveSettings({ [field]: value })[field])
    }
    if (ops.length === 0) return

    this.saving = true
    this.failed = false
    this.publish()
    void this.scope.mutate(ops).then(
      () => { this.settle(expected) },
      () => {
        this.saving = false
        this.failed = true
        this.publish()
      },
    )
  }

  /**
   * Разбирает, доехала ли запись.
   *
   * Отказ хоста (устаревшая ревизия, отвергнутое значение) не приходит исключением: скоуп
   * гасит его и перечитывает документ. Поэтому судим по результату — совпало ли то, что в
   * документе, с тем, что мы писали. Не совпало — черновик остаётся на месте, чтобы правки
   * PO было чем повторить.
   */
  private settle(expected: ReadonlyMap<BftSettingsField, string>): void {
    this.saving = false
    const stored = resolveSettings(this.scope.getSnapshot().value)
    const applied = [...expected].every(([field, value]) => stored[field] === value)
    this.failed = !applied
    if (applied) this.drafts.clear()
    this.publish()
  }
}
