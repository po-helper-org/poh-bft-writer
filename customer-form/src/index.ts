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
 * так что ссылка есть даже при недоступной LLM; потом она — во вкладке
 * Information (команд у заказчика нет, rev11).
 * Вложения любого сообщения уходят файлами в задачу; итог диалога модель
 * сдаёт инструментом submit_customer_request (плагин customer-form/tool внутри
 * пресета агента «customer», HowToDemo п.9–10).
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { Backlog, moscowTime, sharedBacklog, type Ticket } from './host.js'
import { sharedMaterials, type Material, type Materials, type WebLike } from './materials.js'
import { VoiceContext } from './voice.js'
import { doneList, sharedDemos } from './demo.js'
import { demoPageHtml } from './demo-page.js'
import type { AgentLike, BlockLike } from './tool.js'
import { approveFast, FAST_ROOT, fastFiles, fastPagePath, fastProgress, fastSlug, fastState } from './bft-fast.js'
import { customerFastPage, waitingPage, type CustomerSummary } from './fast-page.js'

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
- HowToDemo без материалов: спроси «Как вы будете проверять результат? Где зайдёте, что нажмёте, что должны увидеть» — можно в свободной форме. По ответу сам составь 2–7 шагов (по одному экрану на шаг, результат — проверяемый) и вызови confirm_acceptance_demo: заказчик увидит раскадровку по экранам и согласует её кнопкой. Если просит правки — исправь и покажи снова.
- «Согласую» на сценарии приёмки — это полное согласие заказчика с постановкой. Заказчик нажимает кнопку на карточке, поэтому в чате его «Согласую» сообщением не появится: результат confirm_acceptance_demo «Заказчик САМ нажал кнопку «Согласую»» и есть его подтверждение — не сомневайся в нём и не переспрашивай. ИТОГ не собирай и подтверждения больше не спрашивай. Ссылку на согласованный сценарий и «Уже готовлю БФТ-документ на проверку» портал показывает заказчику сам. Сразу, в этом же ходе и без реплик: submit_customer_request, затем create_bft_fast — без вопросов между ними. Чего не хватает или что противоречит (кто заказчик, расшифровки сокращений) — не спрашивай, а запиши в openQuestions обоих инструментов; в полях оставь то, что известно.
- create_bft_fast — короткий документ, по которому заказчик за минуту решит «да, согласен» или «добавь требования». Поля бери только из сказанного заказчиком и его материалов (стенографист, а не аналитик; ничего не придумывай): что и где заказчик хочет получить, как будет проверять, к кому и по каким вопросам обращаться. Названные системы, экраны и команды (их IT-ландшафт) пиши их словами в требованиях и границах. SMART — S что делаем, M по чему проверяем, R зачем; чего не звучало (часто A и T) — «[УТОЧНИТЬ]». Требования — строки БТ (зачем), ПТ (что хочет пользователь), ИТ (что видит на экране), ФТ (что делает система), НФТ (только если названы измеримые свойства); TOBE — одна короткая фраза; каждая строка — с цитатой: «Заказчик: «…»» — только дословные слова заказчика из его сообщений и ответов в форме, «Материалы [S1]: «…»» — из его файлов, «Сценарий приёмки (согласован): «…»» — из шагов и чек-листа, которые он согласовал кнопкой. Свои формулировки заказчику не приписывай; без цитаты строки нет. ASIS — как сейчас по словам заказчика у тех строк, к которым он относится; не звучал — пусто. Границы — только то, что заказчик выбрал или сказал. Персоны — заказчик и люди и команды, которых он назвал; влияние — за что человек отвечает и по каким вопросам к нему обращаться, только из сказанного. Без служебных пометок в скобках. Открытые вопросы — только настоящие пробелы задачи; про незаполненные ячейки документа не пиши. Если инструмент вернул ошибки — исправь поля и вызови снова.
- Когда документ собран: одной репликой — ссылка на документ из результата create_bft_fast (он уже открыт справа), ссылка на отслеживание заявки, открытые вопросы списком и: «Если всё верно — нажмите „Да, согласен“. Если что-то пропущено — „Добавить требования“ или просто надиктуйте сюда голосом, что и где добавить».
- Правки документа после сборки: заказчик пишет или надиктовывает, что поменять, или присылает «Замечания к документу БФТ:» со страницы документа, — исправь поля и снова вызови create_bft_fast (submit_customer_request повторно не вызывай).
- Сообщение «✅ Да, согласен с документом БФТ.» отправляет кнопка «Да, согласен» на странице документа — согласование уже записано в заявку. Поблагодари одной фразой и скажи, что PO возьмёт документ в проработку; инструменты не вызывай.
- Сообщения «📌 …» (заявка зарегистрирована, сценарий согласован) добавляет портал, а не заказчик: на них не отвечай; номер заявки упомяни в итоговой сводке.
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



  // Ссылки — штатным ctx.web dsh (только публичные адреса).
  ctx.inject(['web'], (scoped: HarnessContext) => {
    materials.web = scoped.get('web') as WebLike
    scoped.effect(() => () => { materials.web = undefined }, 'customer-form: ctx.web для ссылок')
  })

  // Меню «+» заказчика — только «Файл» (rev11): каталог команд пуст и вызвать
  // их нельзя. Плагин ui-commands не выключаем — он же строит пункт «Файл».
  ctx.inject(['commands'], (scoped: HarnessContext) => {
    const commands = scoped.get('commands') as { list(agent: unknown): readonly unknown[]; find(agent: unknown, name: string): unknown }
    const { list, find } = commands
    commands.list = () => Object.freeze([])
    commands.find = () => undefined
    scoped.effect(() => () => { commands.list = list; commands.find = find }, 'customer-form: без команд у заказчика')
  })

  ctx.inject(['attachments'], (scoped: HarnessContext) => {
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
          // Диалог не прерываем: обращение остаётся в чате, следующее сообщение повторит попытку.
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
    // Потоковая диктовка: кусок речи (WAV 16 кГц) → текст, по мере записи.
    scoped.effect(() => register({
      path: '/api/customer-form.dictate',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('session') ?? ''
        const previous = (url.searchParams.get('prev') ?? '').slice(-300)
        try {
          const wav = new Uint8Array(await request.arrayBuffer())
          if (wav.byteLength < 44 || wav.byteLength > 4 * 1024 * 1024) return Response.json({ error: 'кусок записи пустой или слишком большой' }, { status: 413 })
          return Response.json({ text: await voice.dictate(wav, sessionId, previous) })
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 502 })
        }
      },
    }), 'customer-form: /api/customer-form.dictate')

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
        const approved = record.approvedAt ? moscowTime(record.approvedAt) : undefined
        const html = demoPageHtml(record.demo, { sessionId, rev: record.rev, taskId: ticket?.taskId, approved })
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      },
    }), 'customer-form: /api/customer-form.demo')

    // Страница быстрой версии БФТ (bft-html-export.py навыка): ссылка из чата
    // и вкладки Information. Документ лежит на диске — переживает рестарт.
    scoped.effect(() => register({
      path: '/api/customer-form.bftFast',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        // Идёт сборка (rev16) — экран ожидания; он сам перезагрузится в документ.
        const progress = fastProgress.get(sessionId)
        if (progress && progress.stage !== 'ready') {
          return new Response(waitingPage(sessionId, progress, '/api/customer-form.bftFastStatus'), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
        }
        const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
        const slug = ticket ? fastSlug(ticket.taskId) : ''
        const files = fastFiles(FAST_ROOT, slug)
        const html = ticket ? await readFile(files.html, 'utf8').catch(() => undefined) : undefined
        if (!html) {
          return new Response('<!doctype html><meta charset="utf-8"><p style="font:14px sans-serif;color:#888;padding:16px">Быстрая версия БФТ ещё не собрана.</p>',
            { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
        }
        // Заказчику — со слоем «Согласовать» и «Отправить замечания в чат»; PO в заявке — исходная.
        const state = await fastState(files)
        const summary = await customerSummary(files.input, ticket!.taskId, sessionId)
        const page = customerFastPage(html, {
          sessionId, slug, approveUrl: '/api/customer-form.bftFastApprove',
          ...(state?.approvedAt ? { approvedAt: state.approvedAt } : {}),
          ...(summary ? { summary } : {}),
        })
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      },
    }), 'customer-form: /api/customer-form.bftFast')

    // Ход сборки для экрана ожидания: опрос раз в 2 с.
    scoped.effect(() => register({
      path: '/api/customer-form.bftFastStatus',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const progress = fastProgress.get(new URL(request.url).searchParams.get('session') ?? '')
        return Response.json({ stage: progress?.stage ?? 'none', startedAt: progress?.startedAt ?? null }, { headers: { 'cache-control': 'no-store' } })
      },
    }), 'customer-form: /api/customer-form.bftFastStatus')

    // Заказчик согласовал быструю версию БФТ кнопкой на странице: отметка у
    // документа (только эта версия — пересборка её снимает) и в заявке.
    scoped.effect(() => register({
      path: '/api/customer-form.bftFastApprove',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
        if (!ticket) return Response.json({ error: 'заявка не найдена' }, { status: 404 })
        const slug = fastSlug(ticket.taskId)
        const files = fastFiles(FAST_ROOT, slug)
        try {
          const before = await fastState(files)
          const state = await approveFast(files)
          if (!before?.approvedAt) void reportFastApproval(backlog, ticket, slug, files.html, state.approvedAt!)
          return Response.json({ approvedAt: state.approvedAt })
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 409 })
        }
      },
    }), 'customer-form: /api/customer-form.bftFastApprove')

    // Стартовый экран: последние обращения заказчика (сессии помнит его браузер)
    // и ссылка на доску со всеми обращениями.
    scoped.effect(() => register({
      path: '/api/customer-form.myRequests',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        let rpcId = 'r'
        let sessionIds: string[] = []
        try {
          const body = (await request.json()) as { rpcId?: string; payload?: { sessionIds?: unknown } }
          rpcId = body.rpcId ?? rpcId
          if (Array.isArray(body.payload?.sessionIds)) sessionIds = body.payload.sessionIds.filter((id): id is string => typeof id === 'string').slice(0, 200)
        } catch { /* пустое тело */ }
        try {
          const [items, boardUrl] = await Promise.all([backlog.overview(sessionIds), backlog.boardUrl()])
          return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: { items, boardUrl } } })
        } catch (e) {
          console.error('[customer-form] обращения не загрузились:', e)
          return Response.json({ type: 'server-response', rpcId, result: { ok: false, error: (e as Error).message } })
        }
      },
    }), 'customer-form: /api/customer-form.myRequests')

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
        const fast = ticket ? await fastState(fastFiles(FAST_ROOT, fastSlug(ticket.taskId))) : undefined
        const progress = fastProgress.get(sessionId)
        const building = !!progress && progress.stage !== 'ready'
        const value = {
          ticket: ticket ? { taskId: ticket.taskId, url: ticket.url, demoApprovedAt: ticket.demoApprovedAt } : null,
          files: sessionId ? materials.list(sessionId) : [],
          demo: record ? { rev: record.rev, title: record.demo.title, approved: !!record.approvedAt } : null,
          bftFast: building
            ? { url: fastPagePath(sessionId), rev: null, approvedAt: null, building: true }
            : fast ? { url: fastPagePath(sessionId), rev: fast.rev, approvedAt: fast.approvedAt ?? null, building: false } : null,
        }
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
      },
    }), 'customer-form: /api/customer-form.sessionInfo')
  })
}

/** Сводка для заказчика: поля последней сборки и согласованный сценарий (где, чек-лист). */
async function customerSummary(inputPath: string, taskId: number, sessionId: string): Promise<CustomerSummary | undefined> {
  const input = await readFile(inputPath, 'utf8').then((s) => JSON.parse(s) as CustomerSummary['input']).catch(() => undefined)
  if (!input) return undefined
  const demo = sharedDemos().get(sessionId)?.demo
  return { taskId, input, ...(demo?.where ? { where: demo.where } : {}), done: demo ? doneList(demo) : [] }
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
