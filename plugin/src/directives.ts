/**
 * Модель карточки указания процесса (US-24–25, ADR-0003 rev 2).
 *
 * Чистая функция: JSON Коробки (контракт 1.0.0: directive + карточка Т9 со
 * stage/waiting_for) → модель карточки для UI. Кто исполняет, определяет тип
 * активности (kind), а не настройка человека; агенты про Коробку не знают —
 * их итог субмитит плагин, поэтому действие агента — «В чат» (handoff),
 * а не прямой вызов.
 */

/** Адресат из указания Коробки (`to.role` контракта) + различение сотрудник/заказчик. */
export type CardAddresseeRole = 'po' | 'employee' | 'customer' | 'agent'

/** Тип исполнителя (ADR-0003): человек решает, агент держит инструменты, коробка пишет. */
export type ExecutorKind = 'human' | 'agent' | 'box'

/** Действия карточки — коды, UI рисует подписи (locales). */
export type CardAction = 'reply' | 'chat' | 'watch'

export interface DirectiveInput {
  id: string
  kind: string
  to?: { role?: string; person?: string }
  text?: string
  due?: string
  /** open | overdue | suspended | closed — контракт 1.0.0. */
  state?: string
}

export interface DirectiveCard {
  directiveId: string
  kind: string
  executor: ExecutorKind
  addressee: CardAddresseeRole
  /** Кто именно из плана — как назван в Коробке. */
  person?: string
  title: string
  deadline?: string
  /** waiting | overdue | answered | paused. */
  status: 'waiting' | 'overdue' | 'answered' | 'paused'
  actions: readonly CardAction[]
}

/** kind контракта → (исполнитель, адресат, действия). Решения PO — люди, сбор фактов — агенты. */
const KIND_MODEL: Record<string, { executor: ExecutorKind; addressee: CardAddresseeRole; actions: readonly CardAction[] }> = {
  ask: { executor: 'human', addressee: 'employee', actions: ['reply'] },
  collect: { executor: 'agent', addressee: 'agent', actions: ['chat'] },
  approve_plan: { executor: 'human', addressee: 'po', actions: ['reply'] },
  approve_plan_change: { executor: 'human', addressee: 'po', actions: ['reply'] },
  accept_package: { executor: 'human', addressee: 'po', actions: ['reply'] },
  decide: { executor: 'human', addressee: 'po', actions: ['reply'] },
  clarify_team: { executor: 'human', addressee: 'po', actions: ['reply'] },
}

/**
 * Адресат-человек из плана: Коробка различает только po/addressee/executor —
 * кто этот адресат (сотрудник или заказчик), она не знает и знать не должна:
 * различает контакт инициативы. Здесь — эвристика по подписи `person`
 * (как он назван в плане); финальное слово за контактами (contacts.ts) на
 * стороне вызывающего.
 */
function humanAddressee(person?: string): CardAddresseeRole {
  const p = (person ?? '').toLowerCase()
  if (/(заказчик|клиент|customer)/.test(p)) return 'customer'
  return 'employee'
}

export function directiveCard(input: DirectiveInput): DirectiveCard {
  const model = KIND_MODEL[input.kind] ?? { executor: 'human' as const, addressee: humanAddressee(input.to?.person), actions: ['reply'] as readonly CardAction[] }
  const addressee: CardAddresseeRole =
    input.to?.role === 'po' ? 'po'
    : input.to?.role === 'executor' ? 'agent'
    : humanAddressee(input.to?.person)

  const status =
    input.state === 'overdue' ? 'overdue'
    : input.state === 'suspended' ? 'paused'
    : input.state === 'closed' ? 'answered'
    : 'waiting'

  // Закрытое указание только читают; работ коробки у человека нет вовсе.
  const actions =
    status === 'answered' ? ['watch' as const]
    : model.executor === 'agent' ? ['chat' as const]
    : model.actions

  return {
    directiveId: input.id,
    kind: input.kind,
    executor: model.executor,
    addressee,
    person: input.to?.person,
    title: (input.text ?? '').trim() || `Указание ${input.kind}`,
    deadline: input.due,
    status,
    actions,
  }
}

/** Счётчик для бейджа раздела (US-24): ждут человека, просроченные — двойной вес. */
export function badgeCount(cards: readonly DirectiveCard[]): number {
  return cards.filter((c) => c.status === 'waiting' || c.status === 'overdue').length
}
