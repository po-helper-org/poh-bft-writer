/**
 * Слияние конвейера процесса и стадии документа (ADR-0005: конвейер и стадии —
 * разные оси; коробка — авторитет конвейера, артефакты — авторитет документа).
 *
 * На вход: стадия документа из артефактов (BftStage, src/model.ts CANON_ORDER)
 * и карточка Коробки с проекцией Т9 (stage/waiting_for). На выход — значение
 * колонки конвейер-режима PO-доски и честная пометка расхождения: конвейер без
 * документа и документ без процесса — оба легальны и не притворяются друг
 * другом.
 */
import type { BftStage } from './model.js'

/** Конвейер из Т9 (box/bftbox/stage.py): порядок = порядок колонок. */
export type ConveyorStage = 'request' | 'drafting' | 'verifying' | 'validated'

export const CONVEYOR_ORDER: readonly ConveyorStage[] = ['request', 'drafting', 'verifying', 'validated']

export const CONVEYOR_TITLES: Record<ConveyorStage, string> = {
  request: 'Запрос',
  drafting: 'Сбор',
  verifying: 'Верификация',
  validated: 'Validated',
}

export interface BoxProjection {
  /** Доменная стадия из /api/board (Т9); нет карточки — нет и поля. */
  stage?: string
  waiting_for?: readonly string[]
}

export interface ConveyorVerdict {
  /** Колонка конвейера; null — «без процесса» (fast до кнопки «Запустить»). */
  conveyor: ConveyorStage | null
  /** Чьи ответы ждёт процесс (роли открытых указаний) — подпись под колонкой. */
  waitingFor: readonly string[]
  /** Стадия документа для второй строки карточки; null — документа нет. */
  docStage: BftStage | null
  /** Расхождение осей — показываем обе, не гадаем (README плагина о стадиях). */
  note?: string
}

const SIDE_STAGES = new Set(['paused', 'cancelled'])

export function mergeConveyor(docStage: BftStage | null, box: BoxProjection | null): ConveyorVerdict {
  const raw = box?.stage
  let conveyor: ConveyorStage | null = null
  if (raw && (CONVEYOR_ORDER as readonly string[]).includes(raw)) conveyor = raw as ConveyorStage
  // Боковые состояния Коробки не колонки: карточка остаётся на последней
  // конвейерной стадии, пометки — на стороне UI (детальный экран).

  const waitingFor = box?.waiting_for ?? []
  const note =
    raw && SIDE_STAGES.has(raw)
      ? 'Инициатива на паузе или отменена — смотрите детальный экран'
      : conveyor === null && docStage !== null
        ? 'Без процесса: документ есть, «Запустить проработку» не нажато'
        : undefined

  return { conveyor, waitingFor, docStage, note }
}
