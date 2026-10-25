/**
 * customer-form · серверная половина (rev5).
 *
 * Чат заказчика — обычная сессия dsh; поведение сбора постановки даёт секция
 * системного промпта (тот же реестр ctx.systemPrompt, что у poh-bft-plugin).
 * Ключи/модель приходят окружением контейнера (zai через профиль) — заказчик
 * ничего не вводит.
 *
 * Первое сообщение сессии сразу фиксируется заявкой в беклоге (HowToDemo п.6,
 * <1с): ссылка приходит в ленту инъекцией агенту — dsh рисует её без модели,
 * так что ссылка есть даже при недоступной LLM. /request — та же ссылка по
 * запросу (строку команды из узла dsh в ленте не рисует, только из клиента).
 * Вложения любого сообщения уходят файлами в задачу; итог диалога модель
 * сдаёт инструментом submit_customer_request (плагин customer-form/tool внутри
 * пресета агента «customer», HowToDemo п.9–10).
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { Backlog, sharedBacklog, type Ticket } from './host.js'
import type { AgentLike, BlockLike } from './tool.js'

export const name = 'customer-form'

interface SystemPromptLike {
  section(section: { name: string; order: number; text: string | (() => string) }): () => void
}

interface HarnessContext {
  get(name: string): unknown
  effect(fn: () => (() => void) | void, label?: string): void
  inject(names: string[], apply: (scoped: HarnessContext) => void): void
  on(event: string, listener: (payload: never) => void): () => void
}

interface UserMessageLike {
  content: readonly BlockLike[]
  source: { kind: string }
}

interface AttachmentsLike {
  fileHostPath(ref: unknown): string | undefined
  imageHostPath(ref: unknown): string | undefined
}

interface CommandsLike {
  register(definition: {
    name: string
    description: string
    recordInput?: boolean
    handler(invocation: { agent: AgentLike }): Promise<{ kind: 'success'; text: string } | { kind: 'error'; text: string }>
  }): () => void
}

const REQUEST_COMMAND = 'request'

function ticketText(ticket: Ticket): string {
  return `Заявка #${ticket.taskId} зарегистрирована в беклоге: ${ticket.url}`
}

function textOf(message: UserMessageLike): string {
  return message.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
}

export const CUSTOMER_PROMPT = `Ты — ассистент приёма инициатив «Система БФТ». С тобой говорит ЗАКАЗЧИК.

Твоя цель — за живой диалог собрать постановку, по которой PO и команда начнут работу без встреч:
1) Кто заказчик: ФИО и email.
2) Суть инициативы: что нужно, одним-двумя предложениями.
3) ASIS: как это работает сейчас.
4) GAP: почему текущее решение не устраивает.
5) TOBE: как должно работать.
6) HowToDemo: как заказчик будет принимать работу — где зайти, что нажать, что должен увидеть. Это заказчик согласует сам.
7) Глоссарий: расшифруй все сокращения и аббревиатуры (спроси, если не знаешь).

Правила:
- Пиши коротко и по-человечески, без канцелярита. Один ответ — 1–3 предложения плюс максимум 2–3 вопроса.
- Спрашивай только о пробелах: не переспрашивай сказанное, а фиксируй («Записала: …»).
- Сокращение без расшифровки — уточни расшифровку.
- Уточняющие вопросы задавай инструментом ask_user_question: 2–4 вопроса за раз, с вариантами ответа, где они уместны; расшифровку каждого непонятного сокращения — отдельным вопросом. Заказчик может ответить в форме или просто текстом — принимай оба.
- Вложения заказчика портал сам сохраняет в задачу; содержимое файлов ты не читаешь — если файл важен, спроси, что в нём главное.
- HowToDemo: спроси «Как вы будете проверять результат? Где зайдёте, что нажмёте, что должны увидеть» — можно в свободной форме. По ответу сам составь 2–7 шагов (по одному экрану на шаг, результат — проверяемый) и вызови confirm_acceptance_demo: заказчик увидит раскадровку по экранам и согласует её кнопкой. Если просит правки — исправь и покажи снова. Без его «Согласую» ИТОГ не собирай.
- Когда всё собрано и сценарий согласован — одной репликой собери ИТОГ: пронумерованный список по семи пунктам (в HowToDemo — согласованные шаги) и спроси подтверждение.
- После подтверждения вызови submit_customer_request со всеми полями, затем одной фразой поблагодари и дай ссылку на отслеживание из результата инструмента.
- Сообщение «📌 Заявка #N …» добавляет портал, а не заказчик: на него не отвечай, номер заявки упомяни в итоговой сводке.
- Не обещай сроков и бюджета — это решает PO. Не уходи в технические детали реализации.`

interface ConnectionLike {
  rpc: {
    handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => unknown
  }
  fetch?: { register: (route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }) => () => void }
}

export function apply(ctx: HarnessContext): void {
  // Абсолютный путь workspace заказчика: знает только узел (DSH_HOME).
  const workspacePath = `${process.env.DSH_HOME ?? '/data'}/Customer-requests`
  // workspaces.create требует существующий каталог (realpath): создаём заранее.
  mkdir(workspacePath, { recursive: true }).catch(() => undefined)

  const backlog = sharedBacklog()

  ctx.inject(['commands', 'attachments'], (scoped: HarnessContext) => {
    const commands = scoped.get('commands') as CommandsLike

    // /request: номер и ссылка заявки этой сессии (идемпотентно). Ввод не пишем
    // в лог — заявку создаёт первое сообщение, а не текст команды.
    scoped.effect(() => commands.register({
      name: REQUEST_COMMAND,
      description: 'Заявка в беклоге: номер и ссылка на отслеживание',
      recordInput: false,
      handler: async ({ agent }) => {
        try {
          const ticket = await backlog.find(agent.session.id) ?? await backlog.ensure(agent.session.id, '')
          return { kind: 'success', text: ticketText(ticket) }
        } catch (e) {
          return { kind: 'error', text: `Заявка не зарегистрирована: ${(e as Error).message}. Обращение сохранено в чате — PO его увидит.` }
        }
      },
    }), 'customer-form: /request')

    // Первое сообщение заказчика → заявка → ссылка в ленте (и в контексте модели);
    // вложения любого сообщения → файлы задачи.
    const attachments = scoped.get('attachments') as AttachmentsLike
    const linked = new Set<string>()
    scoped.effect(() => scoped.on('agent/inbox/claimed', (({ agent, message }: { agent: AgentLike; message: UserMessageLike }) => {
      if (message.source.kind !== 'user') return
      const sessionId = agent.session.id
      void (async () => {
        try {
          const known = await backlog.find(sessionId)
          const ticket = await backlog.ensure(sessionId, textOf(message))
          if (!known && !linked.has(sessionId)) {
            linked.add(sessionId)
            // Пузырь инъекции dsh рисует сразу (даже пока модель недоступна) —
            // это и есть ссылка заказчику; модель видит его как контекст.
            agent.inject({
              id: randomUUID(),
              role: 'user',
              source: { kind: 'user' },
              content: [{ type: 'text', text: `📌 ${ticketText(ticket)}. Статус — по ссылке.` }],
            })
          }
          await attachFiles(backlog, attachments, ticket, message)
        } catch (e) {
          // Диалог не прерываем: обращение остаётся в чате, /request повторит попытку.
          console.error('[customer-form] заявка не создана:', e)
        }
      })()
    }) as (payload: never) => void), 'customer-form: заявка и вложения')
  })

  ctx.inject(['systemPrompt'], (scoped: HarnessContext) => {
    const systemPrompt = scoped.get('systemPrompt') as SystemPromptLike | undefined
    systemPrompt?.section({ name: 'customer-form', order: 500, text: () => CUSTOMER_PROMPT })
  })

  ctx.inject(['connection'], (scoped: HarnessContext) => {
    const connection = scoped.get('connection') as ConnectionLike
    const register = connection.fetch?.register
    if (typeof register !== 'function') return
    scoped.effect(() => register({
      path: '/api/customer-form.workspacePath',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let rpcId = 'r'
        try { rpcId = ((await request.json()) as { rpcId?: string }).rpcId ?? rpcId } catch { /* пустое тело */ }
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: { path: workspacePath } } })
      },
    }), 'customer-form: /api/customer-form.workspacePath')
  })
}

async function attachFiles(backlog: Backlog, attachments: AttachmentsLike, ticket: Ticket, message: UserMessageLike): Promise<void> {
  for (const block of message.content) {
    if (!block.attachment || (block.type !== 'file' && block.type !== 'image')) continue
    const path = block.type === 'file' ? attachments.fileHostPath(block.attachment) : attachments.imageHostPath(block.attachment)
    if (!path) continue
    const name = block.attachment.name ?? path.split('/').pop() ?? 'file'
    try {
      await backlog.attach(ticket, name, await readFile(path))
    } catch (e) {
      console.error(`[customer-form] вложение ${name} не ушло в задачу:`, e)
    }
  }
}
