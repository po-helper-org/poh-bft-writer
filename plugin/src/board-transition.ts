/**
 * Переходы стадии одной кнопкой с доски — кроме «Добавить в OKR», у которой
 * своя форма (`okr-handoff.ts`).
 *
 * Три перехода, все — решения PO, а не факты на диске, поэтому пишутся только
 * на доску Backlog.md, файлы эпика не трогаются:
 *
 * | Переход   | Откуда      | Куда           | Комментарий                                |
 * |-----------|-------------|----------------|--------------------------------------------|
 * | `vlet`    | `DEEP-DONE` | `OKR-VLET`     | необязателен — основание влёта             |
 * | `okrDone` | `OKR-ADDED` | `OKR-DONE`     | необязателен — чем закрыли                 |
 * | `cancel`  | `DEEP-DONE` | `BFT-CANCELED` | **обязателен**: кто и на каком основании   |
 *
 * Отмена без причины на доску не попадает — то же правило, что у
 * `bft-needed-list` (`Cancelled` только с `Причина:` в заметках): через месяц
 * «отменено» без слов не отвечает на вопрос, можно ли поднимать тему заново.
 * Комментарий дописывается к заметкам, а не заменяет их: там может лежать
 * план OKR или прошлые пометки PO.
 *
 * Стадия-источник проверяется строго (`===`), не «не ниже»: из `OKR-ADDED`
 * отказ стёр бы план, который уже читает плагин OKR, а повторный влёт из
 * `OKR-VLET` дописал бы второе основание.
 */
import { CANCELED_STAGE, OKR_ADDED_STAGE, OKR_DONE_STAGE, OKR_READY_STAGE, OKR_VLET_STAGE, type BftStage } from './model.js'

export const BOARD_TRANSITIONS = ['vlet', 'okrDone', 'cancel'] as const
export type BoardTransition = (typeof BOARD_TRANSITIONS)[number]

export interface TransitionRule {
  from: BftStage
  to: BftStage
  /** Без комментария переход не выполняется. */
  commentRequired: boolean
  /** Префикс строки заметок, по которому запись потом узнают глазами и грепом. */
  notePrefix: string
}

export const TRANSITION_RULES: Record<BoardTransition, TransitionRule> = {
  vlet: { from: OKR_READY_STAGE, to: OKR_VLET_STAGE, commentRequired: false, notePrefix: 'Влёт' },
  okrDone: { from: OKR_ADDED_STAGE, to: OKR_DONE_STAGE, commentRequired: false, notePrefix: 'OKR-DONE' },
  // `Причина:` — префикс, по которому причину отмены читают bft-needed-list и прототип
  // раздела (`cancelReason`); свой префикс развёл бы два формата одной записи.
  cancel: { from: OKR_READY_STAGE, to: CANCELED_STAGE, commentRequired: true, notePrefix: 'Причина' },
}

export interface TransitionRequest {
  kind: BoardTransition
  /** Кто решил — для отмены обязательно; у остальных переходов поле необязательное. */
  who: string
  comment: string
}

export type TransitionParse = { ok: true; value: TransitionRequest } | { ok: false; error: string }

function isTransition(value: unknown): value is BoardTransition {
  return typeof value === 'string' && (BOARD_TRANSITIONS as readonly string[]).includes(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Разбор тела запроса с клиента. Что обязательно — говорится словами: окно
 * показывает причину, а не «bad-request».
 */
export function parseTransition(payload: unknown): TransitionParse {
  if (typeof payload !== 'object' || payload === null) return { ok: false, error: 'не передан переход' }
  const body = payload as Record<string, unknown>
  if (!isTransition(body.kind)) return { ok: false, error: `неизвестный переход «${String(body.kind ?? '')}»` }
  const who = text(body.who)
  const comment = text(body.comment)
  if (TRANSITION_RULES[body.kind].commentRequired) {
    if (who === '') return { ok: false, error: 'укажите, кто отменил' }
    if (comment === '') return { ok: false, error: 'укажите основание отмены' }
  }
  return { ok: true, value: { kind: body.kind, who, comment } }
}

/**
 * Строка заметок: `Причина: Иванов — тема закрыта заказчиком`. Пустые части
 * опускаются; нет ни автора, ни текста — строки нет вовсе (переход без слов
 * допустим только там, где комментарий необязателен).
 */
export function transitionNote(request: TransitionRequest): string | undefined {
  const { notePrefix } = TRANSITION_RULES[request.kind]
  const parts = [request.who, request.comment].filter(part => part !== '')
  return parts.length ? `${notePrefix}: ${parts.join(' — ')}` : undefined
}

/** Одна команда `task edit`: стадия и, если есть что сказать, строка к заметкам. */
export function transitionArgs(id: string, request: TransitionRequest): string[] {
  const args = ['task', 'edit', id, '-s', TRANSITION_RULES[request.kind].to]
  const note = transitionNote(request)
  if (note !== undefined) args.push('--append-notes', note)
  args.push('--plain')
  return args
}

/** Итог отрезка в журнале работы: стадия и та же строка, что ушла в заметки. */
export function transitionSummary(request: TransitionRequest): string {
  const note = transitionNote(request)
  const stage = TRANSITION_RULES[request.kind].to
  return note === undefined ? stage : `${stage}, ${note}`
}
