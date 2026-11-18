/**
 * Русские названия чатов заказчика (боковой список сессий dsh).
 *
 * LLM-генератор названий dsh (session-title-llm) отвечал по-английски
 * («Promocode flow in MarketA a…»), поэтому в профиле заказчика он выключен,
 * а чат называется по заявке: «Заявка #N — <первые слова обращения>», затем
 * «Заявка #N — <название заявки>», как только модель его сформулировала.
 * rename штатной службы dsh-session-title закрепляет название (источник user):
 * автоматическая генерация его больше не перезаписывает.
 *
 * Служба — корневая (узел customer-form берёт её через inject), а инструменты
 * заявки живут в изолированной группе пресета: общий модуль передаёт её туда,
 * как sharedBacklog передаёт беклог.
 */

interface SessionTitleLike {
  rename(session: unknown, title: string): unknown
  get(session: unknown): { title?: string } | undefined
}

let service: SessionTitleLike | undefined

/** Узел customer-form: служба названий подключена (undefined — отключена). */
export function useSessionTitles(next: SessionTitleLike | undefined): void {
  service = next
}

/** «Заявка #N — название»: название — одной строкой, до 60 символов по границе слова. */
export function requestSessionTitle(taskId: number, title?: string): string {
  const line = (title ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.replace(/\s+/g, ' ') ?? ''
  const short = line.length > 60 ? `${line.slice(0, 60).replace(/\s+\S*$/, '')}…` : line
  return short ? `Заявка #${taskId} — ${short}` : `Заявка #${taskId}`
}

/**
 * Назвать живую сессию заявки по-русски. Без службы или для неживой сессии —
 * ничего (название не стоит того, чтобы ронять ход).
 */
export function titleSession(session: unknown, taskId: number, title?: string): void {
  if (!service || !session) return
  const next = requestSessionTitle(taskId, title)
  try {
    if (service.get(session)?.title === next) return
    service.rename(session, next)
  } catch (e) {
    console.error(`[customer-form] название чата заявки ${taskId} не сменилось:`, (e as Error).message)
  }
}
