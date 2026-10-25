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
import { sharedMaterials, type Material, type Materials, type WebLike } from './materials.js'
import { VoiceContext } from './voice.js'
import { sharedDemos } from './demo.js'
import { demoPageHtml } from './demo-page.js'
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

const URL_RE = /https?:\/\/[^\s<>"'«»)\]]+/g

/**
 * Файлы и ссылки сообщения → материалы сессии. Синхронно: реестр заполнен
 * раньше, чем модель успеет вызвать read_customer_materials.
 */
function collectMaterials(materials: Materials, attachments: AttachmentsLike, sessionId: string, message: UserMessageLike): Material[] {
  const found: Material[] = []
  for (const block of message.content) {
    // Фото документа и скриншоты — тоже материал: context-ingest читает их OCR.
    if ((block.type !== 'file' && block.type !== 'image') || !block.attachment) continue
    const path = block.type === 'image' ? attachments.imageHostPath(block.attachment) : attachments.fileHostPath(block.attachment)
    if (path) found.push(materials.addFile(sessionId, block.attachment.name ?? path.split('/').pop() ?? 'file', path))
  }
  const own = (process.env.TRACKER_PUBLIC_URL ?? 'http://127.0.0.1:3456').replace(/\/$/, '')
  for (const url of new Set(textOf(message).match(URL_RE) ?? [])) {
    if (!url.startsWith(own)) found.push(materials.addLink(sessionId, url.replace(/[.,;:!?]+$/, '')))
  }
  return found
}

function materialsLine(found: Material[]): string {
  return found.length ? `\n📎 Изучаю материалы: ${found.map((m) => m.name).join(', ')}. Голос расшифровываю, документы, сканы и ссылки читаю — это быстрее, чем пересказывать.` : ''
}

export const CUSTOMER_PROMPT = `Ты — ассистент приёма инициатив «Система БФТ». С тобой говорит ЗАКАЗЧИК.

Твоя цель — за живой диалог собрать постановку, по которой PO и команда начнут работу без встреч:
1) Кто заказчик: ФИО и email.
2) Краткое название инициативы и суть: что нужно, одним-двумя предложениями (суть бери из слов заказчика и материалов).
3) ASIS: как это работает сейчас.
4) GAP: почему текущее решение не устраивает.
5) TOBE: как должно работать.
6) HowToDemo: как заказчик будет принимать работу — где зайти, что нажать, что должен увидеть. Это заказчик согласует сам.
7) Глоссарий: расшифруй все сокращения и аббревиатуры (спроси, если не знаешь).

Правила:
- Пиши коротко и по-человечески, без канцелярита. Один ответ — 1–3 предложения плюс максимум 2–3 вопроса.
- Спрашивай только о пробелах: не переспрашивай сказанное, а фиксируй («Записала: …»).
- Сокращение без расшифровки — уточни расшифровку.
- Первая форма вопросов — только «Укажите ваши ФИО и email» (если заказчик их ещё не назвал) и «Краткое название инициативы». Не спрашивай «Что нужно сделать…» — суть заказчик уже написал своими словами — и не спрашивай в первой форме «Как это работает сейчас и почему не устраивает» — это ты берёшь из материалов, а без материалов уточняешь следующим вопросом по пробелам.
- Уточняющие вопросы задавай инструментом ask_user_question: 2–4 вопроса за раз, с вариантами ответа, где они уместны; расшифровку каждого непонятного сокращения — отдельным вопросом. Заказчик может ответить в форме или просто текстом — принимай оба.
- Вложения и ссылки — это уже ответы, а не повод для допроса. Если в сообщении есть файлы (строки «[File …]») или ссылки — сразу, без вступления, вызови read_customer_materials: портал расшифрует голос и прочитает документы и страницы. Файловых инструментов у тебя нет, пути из «[File …]» не открывай. Дальше работай как аналитик на сверке:
  1) отметь для себя опорные факты с метками источников ([S1 02:15], [S2]) — в чат их не выписывай; не додумывай: чего нет, то неизвестно;
  2) составь черновик: суть, ASIS, GAP, TOBE, шаги приёмки, глоссарий;
  3) вопросы формой — только если без ответа нельзя составить шаги приёмки, не больше 3;
  4) покажи черновик одной карточкой confirm_acceptance_demo: asis, gap, tobe со ссылками на источники, шаги, а в unclear — чего нет в материалах и где они противоречат.
  Цель — первичный разбор за 1–2 минуты времени заказчика. Если источник не разобран (error), скажи об этом и спроси главное из него одним вопросом.
  Если read_customer_materials ответил «Ещё разбираются» — длинную запись не жди: сразу задай первую форму (ФИО и email, краткое название), разбор идёт, пока заказчик отвечает. После ответов снова вызови read_customer_materials и продолжай по шагам 1–4.
- HowToDemo без материалов: спроси «Как вы будете проверять результат? Где зайдёте, что нажмёте, что должны увидеть» — можно в свободной форме. По ответу сам составь 2–7 шагов (по одному экрану на шаг, результат — проверяемый) и вызови confirm_acceptance_demo: заказчик увидит раскадровку по экранам и согласует её кнопкой. Если просит правки — исправь и покажи снова. Без его «Согласую» ИТОГ не собирай.
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
  const materials = sharedMaterials()
  const voice = new VoiceContext(materials)

  // Подсказка терминов микрофону (speech-ru, ADR-0008): тексты диалога записи.
  ctx.inject(['speechHints'], (scoped: HarnessContext) => {
    const hints = scoped.get('speechHints') as { register(source: (request: { audioKey: string }) => string[] | undefined): () => void }
    console.log('[customer-form] термины диалога → распознавание речи (speech-ru) подключены')
    scoped.effect(() => hints.register(({ audioKey }) => voice.texts(audioKey)), 'customer-form: термины диалога для распознавания речи')
  })

  // Ссылки — штатным ctx.web dsh (только публичные адреса).
  ctx.inject(['web'], (scoped: HarnessContext) => {
    materials.web = scoped.get('web') as WebLike
    scoped.effect(() => () => { materials.web = undefined }, 'customer-form: ctx.web для ссылок')
  })

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
      voice.remember(agent)
      const found = collectMaterials(materials, attachments, sessionId, message)
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
              content: [{ type: 'text', text: `📌 ${ticketText(ticket)}. Статус — по ссылке.${materialsLine(found)}` }],
            })
          }
          await attachFiles(backlog, attachments, ticket, message)
          await attachTranscripts(backlog, ticket, found)
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
    // Клиент перед распознаванием: «запись с ключом K — из сессии S».
    scoped.effect(() => register({
      path: '/api/customer-form.voiceContext',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let rpcId = 'r'
        try {
          const body = (await request.json()) as { rpcId?: string; payload?: { audioKey?: unknown; sessionId?: unknown } }
          rpcId = body.rpcId ?? rpcId
          const { audioKey, sessionId } = body.payload ?? {}
          if (typeof audioKey === 'string' && typeof sessionId === 'string' && audioKey.length < 64 && sessionId.length < 128) voice.announce(audioKey, sessionId)
        } catch { /* битое тело: подсказки просто не будет */ }
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: {} } })
      },
    }), 'customer-form: /api/customer-form.voiceContext')

    // Страница сценария приёмки для правой панели (UserFlow + раскадровка + замечания).
    scoped.effect(() => register({
      path: '/api/customer-form.demo',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        const record = sharedDemos().get(sessionId)
        if (!record) {
          return new Response('<!doctype html><meta charset="utf-8"><p style="font:14px sans-serif;color:#888;padding:16px">Сценарий приёмки ещё не составлен.</p>',
            { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
        }
        const ticket = await backlog.find(sessionId).catch(() => undefined)
        const approved = record.approvedAt ? new Date(record.approvedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' }) : undefined
        const html = demoPageHtml(record.demo, { sessionId, rev: record.rev, taskId: ticket?.taskId, approved })
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      },
    }), 'customer-form: /api/customer-form.demo')

    // Вкладка Information: ссылка на заявку, материалы диалога, статус сценария.
    scoped.effect(() => register({
      path: '/api/customer-form.sessionInfo',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let rpcId = 'r'
        let sessionId = ''
        try {
          const body = (await request.json()) as { rpcId?: string; payload?: { sessionId?: unknown } }
          rpcId = body.rpcId ?? rpcId
          if (typeof body.payload?.sessionId === 'string') sessionId = body.payload.sessionId
        } catch { /* пустое тело */ }
        const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
        const record = sharedDemos().get(sessionId)
        const value = {
          ticket: ticket ? { taskId: ticket.taskId, url: ticket.url, demoApprovedAt: ticket.demoApprovedAt } : null,
          files: sessionId ? materials.list(sessionId) : [],
          demo: record ? { rev: record.rev, title: record.demo.title, approved: !!record.approvedAt } : null,
        }
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
      },
    }), 'customer-form: /api/customer-form.sessionInfo')
  })
}

/** Разобранный текст материала — файлом в задачу: PO читает то же, что модель. */
async function attachTranscripts(backlog: Backlog, ticket: Ticket, found: Material[]): Promise<void> {
  for (const material of found) {
    const result = await material.result
    if (!result.ok) continue
    const base = material.name.replace(/^https?:\/\//, '').replace(/[^\p{L}\p{N}._-]+/gu, '_').slice(0, 80)
    const text = `# ${material.id} · ${material.name}\n\n_${result.label}_\n\n${result.markdown}\n`
    try {
      await backlog.attach(ticket, `${material.id}-${base}.md`, new TextEncoder().encode(text))
    } catch (e) {
      console.error(`[customer-form] текст материала ${material.name} не ушёл в задачу:`, e)
    }
  }
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
