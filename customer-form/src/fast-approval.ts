/**
 * Согласование первичных требований (bft-fast) — одним путём для кнопки
 * «Да, согласен» на странице документа и для ответа в форме чата
 * (confirm_bft_fast): отметка у документа, комментарий и согласованная страница
 * в заявке, запуск полного БФТ, папка заявки в workspace.
 *
 * Узел customer-form и инструменты пресета (customer-form/tool) — разные группы
 * плагинов одного процесса: модуль у них общий (как sharedBacklog), поэтому
 * сборку полного БФТ узел передаёт сюда хуком, а инструмент оставляет здесь
 * свой ожидающий вопрос, чтобы страница документа могла его снять.
 */
import { readFile } from 'node:fs/promises'
import { approveFast, FAST_ROOT, fastFiles, fastSlug, fastState } from './bft-fast.js'
import { moscowTime, type Backlog, type Ticket } from './host.js'
import { mirrorRequest } from './workspace-mirror.js'

/** Сборка полного БФТ — замыкание узла (ему нужна модель портала). */
export const portalHooks: { startDeep?: (ticket: Ticket, sessionId: string) => boolean } = {}

export interface FastApproval {
  approvedAt: string
  /** Согласовано именно сейчас (а не раньше): заявка уведомлена, полный БФТ запущен. */
  first: boolean
  /** Полный БФТ запущен (или уже собирается); false — модель портала недоступна. */
  deep: boolean
}

/** Согласовать текущую версию документа заявки. Повторный вызов ничего не повторяет. */
export async function approveFastRequest(backlog: Backlog, ticket: Ticket, sessionId: string): Promise<FastApproval> {
  const slug = fastSlug(ticket.taskId)
  const files = fastFiles(FAST_ROOT, slug)
  const before = await fastState(files)
  const state = await approveFast(files)
  const first = !before?.approvedAt
  let deep = true
  if (first) {
    void reportFastApproval(backlog, ticket, slug, files.html, state.approvedAt!)
    deep = portalHooks.startDeep?.(ticket, sessionId) ?? false
  }
  void mirrorRequest(ticket.taskId, sessionId)
  return { approvedAt: state.approvedAt!, first, deep }
}

/** Согласование быстрой версии БФТ — в заявку: комментарий и согласованная страница. */
async function reportFastApproval(backlog: Backlog, ticket: Ticket, slug: string, htmlPath: string, approvedAt: string): Promise<void> {
  try {
    await backlog.comment(ticket, `<p><strong>✅ Заказчик согласовал быструю версию БФТ</strong> — ${moscowTime(approvedAt)}</p><p>Согласованная страница — во вложении ${slug}-fast-soglasovan.html; следующий шаг — /bft-deep по документу.</p>`)
    await backlog.attach(ticket, `${slug}-fast-soglasovan.html`, await readFile(htmlPath))
  } catch (e) {
    console.error('[customer-form] согласование БФТ не ушло в задачу:', e)
  }
}

/**
 * Почему снят вопрос «Документ верный?» в чате: заказчик нажал «Да, согласен»
 * на странице документа или пишет замечания в чат (страница вставила фразу в
 * поле ввода). Карточка вопроса занимает место поля ввода, поэтому страница
 * снимает её до того, как писать в чат.
 */
export type FastAskRelease = 'approved' | 'remarks'

const pendingAsks = new Map<string, AbortController>()

/** Инструмент: вопрос по документу ждёт ответа в этой сессии. Возвращает «снять с ожидания». */
export function holdFastAsk(sessionId: string): { signal: AbortSignal; done(): void } {
  pendingAsks.get(sessionId)?.abort('remarks')
  const controller = new AbortController()
  pendingAsks.set(sessionId, controller)
  return {
    signal: controller.signal,
    done: () => { if (pendingAsks.get(sessionId) === controller) pendingAsks.delete(sessionId) },
  }
}

/** Снять ожидающий вопрос по документу; false — вопроса не было. */
export function releaseFastAsk(sessionId: string, reason: FastAskRelease): boolean {
  const controller = pendingAsks.get(sessionId)
  if (!controller) return false
  pendingAsks.delete(sessionId)
  controller.abort(reason)
  return true
}
