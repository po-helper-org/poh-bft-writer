/**
 * customer-form/tool · инструменты заказчика внутри пресета агента «customer»:
 * согласование сценария приёмки и сдача заявки.
 *
 * Пресет — изолированная группа плагинов: глобально зарегистрированный
 * инструмент агенту не виден, поэтому submit_customer_request монтируется
 * строкой пресета (customer.patch.yml), а Backlog берёт общий с узлом
 * customer-form (заявку тот создал по первому сообщению).
 */
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { FAST_ROOT, fastFiles, fastPagePath, fastPageUrl, fastProgress, fastSlug, fastState, portalUrl, publicPortalUrl } from './bft-fast.js'
import { contextMapMarkdown, cortexBrief, relevantBrief } from './cortex.js'
import { buildFastFromPrimary, cortexQuery, KINDS, primaryErrors, SPECIALISTS, type PrimaryArgs, type PrimaryDoc } from './primary.js'
import { demoIntake, glossaryOf, mergeIntake } from './intake.js'
import { demoSteps, doneList, repairDemo, sharedDemos, storyboardMarkdown, type AcceptanceDemo, type DemoRecord } from './demo.js'
import { demoPageHtml } from './demo-page.js'
import { moscowTime, sharedBacklog, ticketRegistered, type Backlog, type Intake, type Ticket } from './host.js'
import { materialsPack, pendingNote, sharedMaterials, type Materials } from './materials.js'
import { mirrorRequest } from './workspace-mirror.js'
import { titleSession } from './session-title.js'
import { approveFastRequest, holdFastAsk, type FastAskRelease } from './fast-approval.js'
import { portalNoteSource } from './portal-note.js'

// defineTool — значение из dsh-tools профиля (не из devDependencies плагина).
const DSH_TOOLS = '@deepseek-ai/dsh-tools'
const { defineTool } = (await import(DSH_TOOLS)) as { defineTool: (definition: unknown) => unknown }

export const name = 'customer-form-tool'
export const inject = ['tools']

export interface BlockLike {
  type: string
  text?: string
  attachment?: { name?: string; mediaType?: string; attachmentId: string }
}

export interface AgentLike {
  session: { id: string; deriveMessages(): readonly { role: string; content: readonly BlockLike[] }[] }
  inject(message: { id: string; role: 'user'; source: { kind: string; [field: string]: unknown }; content: readonly BlockLike[] }): void
}

interface ToolContext {
  get(name: string): unknown
  effect(fn: () => (() => void) | void, label?: string): void
}

export function apply(ctx: ToolContext): void {
  const tools = ctx.get('tools') as { register(definition: unknown): () => void }
  ctx.effect(() => tools.register(defineTool(materialsTool(sharedMaterials()))), 'customer-form: read_customer_materials')
  ctx.effect(() => tools.register(defineTool(confirmDemoTool(ctx, sharedBacklog()))), 'customer-form: confirm_acceptance_demo')
  ctx.effect(() => tools.register(defineTool(submitTool(sharedBacklog()))), 'customer-form: submit_customer_request')
  ctx.effect(() => tools.register(defineTool(fastTool(sharedBacklog()))), 'customer-form: create_bft_fast')
  ctx.effect(() => tools.register(defineTool(confirmFastTool(ctx, sharedBacklog()))), 'customer-form: confirm_bft_fast')
}

/** Диалог как текст: файл полного контекста для PO. */
function transcriptOf(agent: AgentLike, ticket: Ticket, intake: Intake): string {
  const lines = [`# Полный контекст заявки #${ticket.taskId}`, '', `Заказчик: ${intake.customerName} <${intake.customerEmail}>`, '', '## Диалог', '']
  for (const message of agent.session.deriveMessages()) {
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const text = message.content.map((b) => b.text ?? (b.attachment ? `[вложение: ${b.attachment.name ?? b.type}]` : '')).join('\n').trim()
    if (text) lines.push(`**${message.role === 'user' ? 'Заказчик' : 'Ассистент'}:** ${text}`, '')
  }
  return lines.join('\n')
}

const text = (description: string) => ({ type: 'string', required: true, description })
const optional = (description: string) => ({ type: 'string', description })
const strings = (description: string) => ({ type: 'array', required: true, items: { type: 'string' }, description })

interface UserQuestionsLike {
  ask(request: unknown): Promise<{ answers: { id: string; selected: string[]; custom?: string }[] }>
}

/**
 * Материалы заказчика текстом: расшифровки голоса, документы, страницы ссылок.
 * Разбор начат узлом при приёме сообщения; здесь — короткое ожидание готового
 * и пометка того, что ещё разбирается (ход модели не стоит на длинной записи).
 */
function materialsTool(materials: Materials) {
  return {
    name: 'read_customer_materials',
    description: 'Прочитать материалы, которые приложил заказчик: расшифровки голосовых записей (m4a и др.), тексты документов (PDF, Word, Excel, PowerPoint) и страниц по его ссылкам. '
      + 'Вызывай первым делом, если в сообщении есть файлы или ссылки; повторно — когда заказчик приложил новые или когда прошлый вызов сказал «Ещё разбираются».',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
    },
    async execute(_args: unknown, exec: { agent?: AgentLike }) {
      const agent = exec.agent
      if (!agent) throw new Error('нет сессии заказчика')
      const { ready, pending } = await materials.take(agent.session.id)
      if (!ready.length && !pending.length) return 'Новых материалов нет.'
      return [ready.length ? materialsPack(ready) : '', pendingNote(pending)].filter(Boolean).join('\n\n')
    },
  }
}

const DEMO_REVIEW = 'acceptance-demo'
const APPROVE = 'Согласую'

/**
 * Согласование «как я буду принимать работу» штатной карточкой dsh: вопрос с
 * intent plan-review (как exit_plan_mode). Без callId — ui-plan откроет
 * раскадровку в правом сайдбаре как временный документ. Ответ даёт только
 * сам заказчик кнопкой — модель согласие не «додумывает».
 */
function confirmDemoTool(ctx: ToolContext, backlog: Backlog) {
  return {
    name: 'confirm_acceptance_demo',
    description: 'Показать заказчику сценарий приёмки (HowToDemo) раскадровкой по экранам и получить его согласие кнопкой «Согласую». '
      + 'Вызывай, когда понятно, где и как заказчик будет проверять результат. «Согласую» — полное согласие с постановкой: дальше сразу submit_customer_request и create_bft_fast. При правках — исправь шаги и вызови снова.',
    parameters: {
      title: text('Что принимаем — результат работы, 3–8 слов'),
      where: text('Где заказчик проверяет: система, окружение или канал (почта, папка, портал, отчёт)'),
      steps: {
        type: 'array', required: true, description: 'Шаги проверки по порядку, 2–7 шагов — по одному экрану на шаг',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            screen: text('Экран или место, коротко: «Почта Outlook», «Отчёт в BI»'),
            action: text('Что заказчик делает на этом экране'),
            expect: text('Что заказчик видит на этом экране — проверяемо (цифры, файл, статус), из его слов или материалов. Передача данных между системами — не expect: её заказчик не видит'),
            device: optional('Где этот экран: браузер, письмо, уведомление или приложение'),
            mock: text('Что заказчик увидит на этом экране — для картинки раскадровки, сверху вниз через «;»: заголовок: …; текст: …; кнопка: …; список: 3; поле: … = …; '
              + 'успех: …; отказ: …. 3–6 частей, только то, что заказчик увидит. Отметки, статусы и уведомления — только названные заказчиком или в материалах; своё допущение — вопросом в unclear'),
          },
        },
      },
      done: strings('Чек-лист приёмки строго от лица заказчика: 3–6 коротких пунктов, каждый проверяется однозначно «да/нет» '
        + 'и начинается с того, что он видит или может сделать: «Вижу в корзине опцию „Застраховать билеты“ с ценой», «Получаю полис на почту после оплаты». Без технических деталей'),
      asis: optional('ASIS по материалам: как сейчас, со ссылками на источники [S1 00:12]'),
      gap: optional('GAP по материалам: что не устраивает, со ссылками на источники'),
      tobe: optional('TOBE по материалам: как должно стать, со ссылками на источники'),
      unclear: {
        type: 'array', items: { type: 'string' },
        description: 'Чего нет в материалах или где они противоречат друг другу — заказчик поправит в «Нужны правки». '
          + 'Сюда же — каждое добавленное тобой допущение (статус, уведомление, надпись, шаг), вопросом «Верно ли, что…?»',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
    },
    async execute(raw: AcceptanceDemo, exec: { agent?: AgentLike; signal?: AbortSignal }) {
      const args = repairDemo(raw)
      const agent = exec.agent
      if (!agent) throw new Error('нет сессии заказчика')
      if (!args.steps?.length) throw new Error('в сценарии нет шагов')
      const questions = ctx.get('userQuestions') as UserQuestionsLike | undefined
      if (!questions) throw new Error('карточка согласования недоступна — спроси подтверждение сценария текстом')
      const storyboard = storyboardMarkdown(args)
      // Страница сценария в правой панели (UserFlow + раскадровка + замечания) читает отсюда.
      const demos = sharedDemos()
      const record = { demo: args, rev: (demos.get(agent.session.id)?.rev ?? 0) + 1 }
      demos.set(agent.session.id, record)
      // Каждая версия сценария — страницей в заявку: PO видит, что предлагали заказчику.
      void attachAcceptancePage(backlog, agent.session.id, record)
      void mirrorSession(backlog, agent.session.id)
      const answer = await questions.ask({
        questions: [{
          id: DEMO_REVIEW,
          header: 'Сценарий приёмки',
          question: 'Согласуете, что примете работу по этому сценарию?',
          detail: storyboard,
          options: [
            { label: APPROVE, description: 'Сценарий верный — по нему я приму работу.' },
            { label: 'Нужны правки', description: 'Напишу, что поменять.' },
          ],
          intent: { kind: 'plan-review', approve: APPROVE },
        }],
        agent,
        signal: exec.signal,
      }).catch((cause: { code?: string }) => {
        if (cause?.code === 'ASK_CANCELLED') {
          throw new Error('Заказчик хочет поправить сценарий приёмки: дождись его сообщения, исправь шаги и снова вызови confirm_acceptance_demo.')
        }
        throw cause
      })
      const item = answer.answers.find((a) => a.id === DEMO_REVIEW)
      if (item?.selected.length !== 1 || item.selected[0] !== APPROVE || item.custom !== undefined) {
        const feedback = item?.custom ?? ''
        throw new Error(`Заказчик не согласовал сценарий${feedback ? `: ${feedback}` : ''}. Исправь шаги и снова вызови confirm_acceptance_demo.`)
      }
      const steps = demoSteps(args)
      const approved = { ...record, approvedAt: new Date().toISOString() }
      demos.set(agent.session.id, approved)
      const ticket = await backlog.find(agent.session.id)
      const checklist = doneList(args)
      if (ticket) await backlog.approveDemo(agent.session.id, ticket, steps, checklist.join('; '), storyboard)
      // Черновик и допущения сценария — в intake.json заявки (план C1): их читает полный БФТ.
      if (ticket) await mergeIntake(fastFiles(FAST_ROOT, fastSlug(ticket.taskId)).dir, demoIntake(args)).catch((e) => console.error('[customer-form] intake.json (сценарий) не записан:', e))
      await attachAcceptancePage(backlog, agent.session.id, approved)
      void mirrorSession(backlog, agent.session.id)
      // Дальше заказчик только ждёт документ (rev16): ссылку и «уже готовлю» пишет
      // портал сам — сразу, не дожидаясь модели; справа — ход сборки.
      fastProgress.start(agent.session.id)
      agent.inject({
        id: randomUUID(),
        role: 'user',
        source: portalNoteSource('demo'),
        content: [{ type: 'text', text: `📌 Сценарий приёмки согласован: ${portalUrl(`/api/customer-form.demo?session=${encodeURIComponent(agent.session.id)}`)}\nУже готовлю БФТ-документ на проверку, буквально 3 минуты — ход сборки справа.` }],
      })
      return ['Заказчик САМ нажал кнопку «Согласую» на карточке сценария приёмки — это его подтверждение и полное согласие с постановкой.',
        'Нажатие кнопки не появляется сообщением в чате: результат этого инструмента и есть его ответ (модель кнопку нажать не может). Не переспрашивай, ИТОГ не собирай.',
        'Ссылку на согласованный сценарий и «Уже готовлю БФТ-документ» портал уже показал заказчику. Без реплик сразу вызови submit_customer_request, затем create_bft_fast. В howToDemo заявки перенеси эти шаги без изменений:',
        ...steps.map((s, i) => `${i + 1}. ${s}`), 'Работа принята, если (чек-лист заказчика):', ...checklist.map((c) => `- ${c}`)].join('\n')
    },
  }
}

/**
 * Страница сценария приёмки (UserFlow, раскадровка, чек-лист, замечания) —
 * файлом .html в заявку: та же, что заказчик видел в правой панели, открывается
 * и без портала. Согласованная версия — отдельным файлом с отметкой времени.
 * Сбой трекера диалог не роняет.
 */
async function attachAcceptancePage(backlog: Backlog, sessionId: string, record: DemoRecord): Promise<void> {
  try {
    const ticket = await backlog.find(sessionId)
    if (!ticket) return
    const approved = record.approvedAt ? moscowTime(record.approvedAt) : undefined
    const html = demoPageHtml(record.demo, { sessionId, rev: record.rev, taskId: ticket.taskId, ...(approved ? { approved } : {}) })
    const name = `scenarij-priyomki-${ticket.taskId}-v${record.rev}${approved ? '-soglasovan' : ''}.html`
    await backlog.attach(ticket, name, new TextEncoder().encode(html))
  } catch (e) {
    console.error('[customer-form] страница сценария не ушла в задачу:', e)
  }
}

/** Папка заявки сессии в workspace — если заявка уже заведена. */
async function mirrorSession(backlog: Backlog, sessionId: string): Promise<void> {
  const ticket = await backlog.find(sessionId).catch(() => undefined)
  if (ticket) await mirrorRequest(ticket.taskId, sessionId)
}

/** Первое обращение заказчика в диалоге (без служебных «📌 …» портала). */
function firstCustomerText(agent: AgentLike): string | undefined {
  for (const message of agent.session.deriveMessages()) {
    if (message.role !== 'user') continue
    const text = message.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim()
    if (text && !text.startsWith('📌')) return text
  }
  return undefined
}

/**
 * Заявка сессии — найденная или созданная сейчас (rev17). Заявку создаёт узел
 * по первому сообщению, но трекер мог не ответить (истёкший токен, сбой сети):
 * тогда сдача не упирается в «ещё не зарегистрирована», а заводит её сама —
 * с отметкой согласованного сценария и ссылкой заказчику, как при первом
 * сообщении. Не вышло и сейчас — модели настоящая причина, а не «повтори».
 */
async function ensureTicket(backlog: Backlog, agent: AgentLike, text: string): Promise<Ticket> {
  const sessionId = agent.session.id
  const known = await backlog.find(sessionId)
  let ticket: Ticket
  try {
    ticket = known ?? await backlog.ensure(sessionId, text)
  } catch (e) {
    throw new Error(`Трекер не принял заявку: ${(e as Error).message}. Повторять сразу бесполезно — скажи заказчику, что всё сказанное сохранено в этом чате и заявка будет заведена, как только трекер ответит; попробуй ещё раз на следующем его сообщении.`)
  }
  // Сценарий согласовали, пока заявки не было: отметка и страница — сейчас.
  const record = sharedDemos().get(sessionId)
  if (record?.approvedAt && !ticket.demoApprovedAt) {
    ticket = await backlog.approveDemo(sessionId, ticket, demoSteps(record.demo), doneList(record.demo).join('; '), storyboardMarkdown(record.demo))
    void attachAcceptancePage(backlog, sessionId, record)
  }
  if (known) return ticket
  // Заявку завёл сам инструмент (трекер не ответил на первое сообщение): название чата и папка — сейчас.
  titleSession(agent.session, ticket.taskId, text)
  void mirrorRequest(ticket.taskId, sessionId, firstCustomerText(agent) ?? text)
  agent.inject({
    id: randomUUID(),
    role: 'user',
    source: portalNoteSource('ticket'),
    content: [{ type: 'text', text: `📌 ${ticketRegistered(ticket)}` }],
  })
  return ticket
}

function submitTool(backlog: Backlog) {
  return {
    name: 'submit_customer_request',
    description: 'Сдать согласованную заказчиком постановку в заявку беклога: описание, сводку и полный контекст. Вызывай один раз — сразу после «Согласую» на сценарии приёмки, без ИТОГА и повторного подтверждения; пробелы — в openQuestions.',
    parameters: {
      title: text('Короткое название заявки для доски, до 8 слов'),
      customerName: text('ФИО заказчика'),
      customerEmail: text('Email заказчика'),
      summary: text('Суть инициативы, 1–2 предложения'),
      asis: optional('ASIS: как работает сейчас — со слов заказчика; если заказчик не описывал — пусто, не додумывай'),
      gap: text('GAP: почему текущее решение не устраивает'),
      tobe: text('TOBE: как должно работать'),
      howToDemo: strings('HowToDemo: шаги, согласованные заказчиком в confirm_acceptance_demo, по одному на элемент'),
      glossary: {
        type: 'array', required: true, description: 'Расшифровки сокращений',
        items: { type: 'object', additionalProperties: false, properties: { term: text('Сокращение'), expansion: text('Расшифровка') } },
      },
      links: strings('Ссылки на материалы, которые дал заказчик (JIRA, Confluence, внешние); ссылку на саму заявку не добавляй'),
      openQuestions: strings('Что осталось невыясненным — для PO'),
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
    },
    async execute(args: Intake, exec: { agent?: AgentLike }) {
      const agent = exec.agent
      if (!agent) throw new Error('нет сессии заказчика')
      const ticket = await ensureTicket(backlog, agent, [args.title, args.summary, `${args.customerName} ${args.customerEmail}`].join('\n'))
      await backlog.finalize(ticket, args, transcriptOf(agent, ticket, args))
      // Данные приёма — рядом с документом (план C1): трекер их хранит, полный БФТ читает отсюда.
      await mergeIntake(fastFiles(FAST_ROOT, fastSlug(ticket.taskId)).dir, {
        ...(args.title?.trim() ? { title: args.title.trim() } : {}),
        ...(args.summary?.trim() ? { summary: args.summary.trim() } : {}),
        ...(args.asis?.trim() ? { asis: args.asis.trim() } : {}),
        ...(args.gap?.trim() ? { gap: args.gap.trim() } : {}),
        ...(args.tobe?.trim() ? { tobe: args.tobe.trim() } : {}),
        glossary: glossaryOf(args.glossary),
        links: (args.links ?? []).filter((l) => l?.trim()),
        openQuestions: (args.openQuestions ?? []).filter((q) => q?.trim()),
      }).catch((e) => console.error('[customer-form] intake.json не записан:', e))
      fastProgress.stage(agent.session.id, 'submitted')
      if (args.title?.trim()) titleSession(agent.session, ticket.taskId, args.title)
      void mirrorRequest(ticket.taskId, agent.session.id)
      return `Заявка #${ticket.taskId} обновлена: постановка, сводка и полный контекст сохранены.${ticket.url ? ` Отслеживание статуса: ${ticket.url}` : ''}`
    },
  }
}

/**
 * Быстрая версия БФТ в том же чате (ADR-0007 rev14): модель раскладывает
 * подтверждённый запрос по полям, документ и страницу ревью собирает
 * bft-fast.ts штатными скриптами навыка. How to demo — согласованный
 * заказчиком сценарий без пересказа модели.
 */
function fastTool(backlog: Backlog) {
  const quote = (what: string) => text(`${what}. Цитата: «Заказчик: «дословно»» (его сообщения и ответы в форме), «Материалы [S1 00:12]: «…»» или «Сценарий приёмки (согласован): «…»»`)
  return {
    name: 'create_bft_fast',
    description: 'Собрать первичные требования (bft-fast) по согласованной заявке — сразу после submit_customer_request, в этом же чате. '
      + 'Ты — стенографист: только сказанное заказчиком и его материалы, каждое требование — с цитатой. Как он примет работу, контуры проверки и зоны влияния '
      + 'инструмент добавит сам (сценарий приёмки и Кортекс). Ошибки формы — исправь поля и вызови снова; правки заказчика — тот же вызов.',
    parameters: {
      title: text('Название — как у заявки, до 10 слов'),
      want: {
        type: 'object', required: true, additionalProperties: false, description: 'Что заказчик хочет и зачем — его словами',
        properties: {
          what: text('Что хочет получить — одна фраза'),
          why: optional('Зачем — проблема или выгода, если звучала'),
          quote: quote('Откуда это'),
          asis: optional('Как сейчас — дословно, только если заказчик описал текущий процесс; не пересказ: кусок его реплики из quote или цитаты требования. Нет реплики — не заполняй'),
        },
      },
      requirements: {
        type: 'array', required: true, description: 'Требования со слов: каждое — одна короткая фраза и цитата; чего не говорил — не добавляй. '
          + 'Ответ «Каким вы видите решение» — гипотеза реализации: дословно в achievable.vision. В requirements — результат, который заказчик назвал нужным пользователю или бизнесу; kind «система» — наблюдаемое поведение системы, а не механизм (кто кого вызывает, какой поток читает). Названная заказчиком обязательная интеграция или система остаётся требованием, сформулированным как результат (данные оказываются в системе X). Условие, которое ещё предстоит согласовать, — в approvals и openQuestions.',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: [...KINDS], description: 'зачем — ценность; пользователю — что хочет пользователь; на экране — что он видит; система — что делает система; качество — измеримое свойство, только если названо' },
            text: text('Требование — одна фраза'),
            quote: quote('Откуда требование'),
            asis: optional('Как сейчас в этой точке — дословно, подстрока цитаты этого требования или want.quote; только если заказчик описал текущий процесс. Нет реплики — не заполняй'),
          },
        },
      },
      outOfScope: {
        type: 'array', description: 'Только то, что заказчик явно исключил («это не делаем», «потом»). Нерешённое и «уточняется» — не сюда, а в openQuestions',
        items: { type: 'object', additionalProperties: false, properties: { text: text('Что не входит — одна фраза'), quote: quote('Где заказчик это исключил') } },
      },
      agreements: {
        type: 'array', description: 'Договорённости и обязательные условия со слов заказчика (обязательная система, согласование, ограничение) — не исключения и не открытые вопросы',
        items: { type: 'object', additionalProperties: false, properties: { text: text('Договорённость — одна фраза'), quote: quote('Откуда') } },
      },
      people: {
        type: 'array', description: 'Заказчик и люди, которых он назвал',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: text('Имя'), role: optional('Роль — из сказанного'),
            about: optional('Зона влияния: по каким вопросам к нему — из сказанного; не контакты'),
            contact: optional('Email или телефон, если назвал'),
          },
        },
      },
      openQuestions: { type: 'array', items: { type: 'string' }, description: 'Настоящие пробелы задачи, нерешённое и «уточняется» — уходят в чат и в заявку' },
      glossary: {
        type: 'array', description: 'Расшифровки сокращений и терминов — со слов заказчика или материалов',
        items: { type: 'object', additionalProperties: false, properties: { term: text('Сокращение или термин'), meaning: text('Расшифровка') } },
      },
      metric: {
        type: 'object', additionalProperties: false, description: 'Эффект, если заказчик его назвал: какой показатель и как изменится. Не назвал — не заполняй, не выдумывай',
        properties: { now: optional('Сколько сейчас — его словами'), target: optional('Сколько хотим — его словами'), quote: quote('Откуда') },
      },
      deadline: {
        type: 'object', additionalProperties: false, description: 'Желаемый срок или событие, если заказчик назвал. Не назвал — не заполняй',
        properties: { when: text('К какому сроку или событию'), why: optional('Почему тогда — если сказал'), quote: quote('Откуда') },
      },
      actors: {
        type: 'array', description: 'Кто будет пользоваться результатом — роли и примерно сколько, со слов заказчика (не стейкхолдеры из people)',
        items: { type: 'object', additionalProperties: false, properties: { role: text('Роль пользователя'), count: optional('Примерно сколько — если сказал'), quote: quote('Откуда') } },
      },
      achievable: {
        type: 'object', additionalProperties: false,
        description: 'SMART A — краткий план реализации из ответа заказчика «Каким вы видите решение»; здесь ты дораскрываешь, по 1–4 коротких пункта',
        properties: {
          vision: optional('Ответ заказчика «Каким вы видите решение» — дословно; не отвечал — не заполняй'),
          teams: { type: 'array', items: { type: 'string' }, description: 'Какие команды участвуют в реализации' },
          specialists: { type: 'array', items: { type: 'string', enum: [...SPECIALISTS] }, description: 'Какие специалисты нужны' },
          approvals: { type: 'array', items: { type: 'string' }, description: 'Какие согласования нужны' },
          questions: { type: 'array', items: { type: 'string' }, description: 'Что проработать до реализации' },
        },
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
    },
    async execute(args: PrimaryArgs, exec: { agent?: AgentLike }) {
      const agent = exec.agent
      if (!agent) throw new Error('нет сессии заказчика')
      const sessionId = agent.session.id
      const invalid = primaryErrors(args)
      if (invalid.length) throw new Error(`Исправь поля и вызови create_bft_fast снова:\n${invalid.join('\n')}`)
      const ticket = await ensureTicket(backlog, agent, args.title)
      const record = sharedDemos().get(sessionId)
      const howToDemo = record?.approvedAt ? demoSteps(record.demo) : []
      const checklist = record?.approvedAt ? doneList(record.demo) : []
      const slug = fastSlug(ticket.taskId)
      fastProgress.stage(sessionId, 'building')
      // Шаблон — кодом из полей модели; Кортекс — параллельно, его не ждёт линтер.
      const [built, brief] = await Promise.all([
        buildFastFromPrimary({ args, howToDemo, checklist }, { slug, source: requestSource(ticket.taskId, sessionId) }, FAST_ROOT),
        // Только узлы по теме заявки: общие узлы памяти не попадают ни в fast, ни в карту контекста.
        cortexBrief(cortexQuery(args, howToDemo)).then((b) => (b ? relevantBrief(b, cortexQuery(args, howToDemo)) : undefined)),
      ])
      if (!built.ok) throw new Error(`Документ не собран, исправь поля и вызови create_bft_fast снова:\n${built.errors}`)
      const doc: PrimaryDoc = { args, howToDemo, checklist, ...(record?.demo.where ? { where: record.demo.where } : {}), ...(brief ? { brief } : {}) }
      await writeFile(built.files.primary, JSON.stringify(doc), 'utf8')
      // Допущения и черновик сценария — в intake.json и тогда, когда при «Согласую» заявки ещё не было.
      if (record?.approvedAt) await mergeIntake(built.files.dir, demoIntake(record.demo)).catch((e) => console.error('[customer-form] intake.json (сценарий) не записан:', e))
      if (brief) await writeFile(built.files.contextMap, contextMapMarkdown(brief, slug), 'utf8')
      // Номер сборки — в имени вложения: PO видит, что пересобиралось. Счётчик — на диске, рестарт его не обнуляет.
      const counter = `${built.files.dir}/version`
      const rev = Number(await readFile(counter, 'utf8').catch(() => '0')) + 1
      await writeFile(counter, String(rev), 'utf8')
      const questions = (args.openQuestions ?? []).map((q) => q.trim()).filter(Boolean)
      fastProgress.stage(sessionId, 'ready')
      titleSession(agent.session, ticket.taskId, args.title)
      void mirrorRequest(ticket.taskId, sessionId)
      void publishFast(backlog, ticket, slug, rev, built.files, questions, !!brief)
      const zones = brief?.people.map((p) => `${p.name} (${p.zones.slice(0, 2).join(', ')})`) ?? []
      return [
        `Первичные требования собраны (версия ${rev}, шаблон bft-fast пройден) и приложены к заявке #${ticket.taskId}.`,
        `Страница документа для заказчика: ${fastPageUrl(sessionId)}`,
        brief ? `Кортекс${brief.vault.demo ? ' (демо-память)' : ''}: зоны влияния — ${zones.join('; ') || 'не найдены'}; систем для проверки — ${brief.landscape.length}. Это уже на странице.` : 'Кортекс не подключён: контуров проверки и зон влияния на странице нет.',
        questions.length ? ['Открытые вопросы (перечисли заказчику):', ...questions.map((q) => `- ${q}`)].join('\n') : 'Открытых вопросов нет.',
        'Дальше: короткая реплика (ссылка на документ, отслеживание заявки, открытые вопросы) и в этом же ходе сразу confirm_bft_fast — кнопки «Да, согласен» / «Есть замечания» покажет форма, текстом их не описывай.',
      ].join('\n')
    },
  }
}

const FAST_REVIEW = 'bft-fast-review'
const FAST_REMARKS = 'bft-fast-remarks'
const AGREE = 'Да, согласен'
const REMARKS = 'Есть замечания'

/**
 * «Документ верный?» — формой в чате сразу после сборки первичных требований:
 * заказчик отвечает кнопкой, а не ищет призыв в тексте. «Да, согласен» делает
 * то же, что кнопка на странице документа (fast-approval.ts): отметка, заявка,
 * полный БФТ. «Есть замечания» — следующий вопрос той же формой: что поправить.
 * Если заказчик ответил на странице документа (согласовал или пишет замечания
 * в чат), страница снимает вопрос — карточка занимает место поля ввода.
 */
function confirmFastTool(ctx: ToolContext, backlog: Backlog) {
  return {
    name: 'confirm_bft_fast',
    description: 'Спросить заказчика формой, верен ли собранный документ первичных требований: кнопки «Да, согласен» и «Есть замечания». '
      + 'Вызывай сразу после create_bft_fast (после короткой реплики со ссылкой и открытыми вопросами) и после каждой пересборки. «Да, согласен» согласует документ и запускает полный БФТ — сам этого не делай.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
    },
    async execute(_args: unknown, exec: { agent?: AgentLike; signal?: AbortSignal }) {
      const agent = exec.agent
      if (!agent) throw new Error('нет сессии заказчика')
      const sessionId = agent.session.id
      const ticket = await backlog.find(sessionId)
      const files = ticket ? fastFiles(FAST_ROOT, fastSlug(ticket.taskId)) : undefined
      const state = files ? await fastState(files) : undefined
      if (!ticket || !state) throw new Error('Документ ещё не собран: сначала create_bft_fast без ошибок, затем confirm_bft_fast.')
      if (state.approvedAt) return 'Эта версия документа уже согласована, полный БФТ собирается справа. Ничего не спрашивай.'
      const questions = ctx.get('userQuestions') as UserQuestionsLike | undefined
      if (!questions) throw new Error('форма вопросов недоступна — спроси одной фразой, верен ли документ, и жди ответа')
      const doc = await readFile(files!.primary, 'utf8').then((s) => JSON.parse(s) as PrimaryDoc).catch(() => undefined)
      const open = (doc?.args.openQuestions ?? []).map((q) => q.trim()).filter(Boolean)
      const hold = holdFastAsk(sessionId)
      const signal = exec.signal ? AbortSignal.any([exec.signal, hold.signal]) : hold.signal
      const ask = (request: unknown) => questions.ask(request).catch((cause: { code?: string }) => {
        if (hold.signal.aborted) return { released: hold.signal.reason as FastAskRelease }
        if (cause?.code === 'ASK_CANCELLED') return { released: 'remarks' as FastAskRelease }
        throw cause
      })
      try {
        const first = await ask({
          questions: [{
            id: FAST_REVIEW,
            header: 'Первичные требования',
            question: 'Документ справа верный?',
            ...(open.length ? { detail: ['Открытые вопросы уйдут в заявку для PO:', ...open.map((q) => `- ${q}`)].join('\n') } : {}),
            options: [
              { label: AGREE, description: 'Всё верно — собирайте полный БФТ.' },
              { label: REMARKS, description: 'Напишу, что поправить или добавить.' },
            ],
          }],
          agent,
          signal,
        })
        if ('released' in first) return released(first.released)
        const item = first.answers.find((a) => a.id === FAST_REVIEW)
        const custom = item?.custom?.trim()
        if (custom) return remarks(custom)
        if (item?.selected[0] === AGREE) {
          const approval = await approveFastRequest(backlog, ticket, sessionId)
          return approval.deep
            ? 'Заказчик САМ нажал «Да, согласен» в форме: документ согласован, отметка в заявке, полный БФТ по корпоративному канону уже собирается справа. '
              + 'Поблагодари одной фразой и скажи: полный БФТ — справа, обычно от минуты до пяти, скачать можно в Word, PDF и Markdown. Инструменты не вызывай, вопросов не задавай.'
            : 'Заказчик согласовал документ (отметка в заявке), но модель портала для полного БФТ сейчас недоступна. Поблагодари и скажи, что полный БФТ соберёт PO. Инструменты не вызывай.'
        }
        if (item?.selected[0] !== REMARKS) return 'Заказчик пропустил вопрос. Ничего не спрашивай повторно — жди его сообщения.'
        const second = await ask({
          questions: [{ id: FAST_REMARKS, header: 'Замечания', question: 'Что поправить или добавить в документе?' }],
          agent,
          signal,
        })
        if ('released' in second) return released(second.released)
        const text = second.answers.find((a) => a.id === FAST_REMARKS)?.custom?.trim()
        return text ? remarks(text) : released('remarks')
      } finally {
        hold.done()
      }
    },
  }
}

function released(reason: FastAskRelease): string {
  return reason === 'approved'
    ? 'Заказчик нажал «Да, согласен» на странице документа: согласование записано, полный БФТ собирается. Сейчас придёт его сообщение «✅ Да, согласен с документом БФТ.» — ответь на него; до этого ничего не пиши.'
    : 'Заказчик пишет замечания в чат (голосом или текстом). Ничего не пиши и не спрашивай — дождись его сообщения, исправь поля, снова create_bft_fast, затем confirm_bft_fast.'
}

function remarks(text: string): string {
  return `Замечания заказчика к документу: «${text}». Без реплик исправь поля по ним и снова вызови create_bft_fast, затем confirm_bft_fast. Если замечание непонятно — уточни ask_user_question.`
}

/**
 * «Источник Summary» открытого поля fast (план качества, C8): страница заявки
 * в портале по PORTAL_PUBLIC_URL; адреса нет или он loopback — «заявка #N»
 * без ссылки (ссылка на 127.0.0.1 или внутренний трекер у читателя не откроется).
 */
function requestSource(taskId: number, sessionId: string): string {
  const page = publicPortalUrl(fastPagePath(sessionId))
  if (!page) console.error(`[customer-form] PORTAL_PUBLIC_URL не задан или loopback — в документе заявки #${taskId} ссылки на портал не будет`)
  return page ? `заявка #${taskId} — ${page}` : `заявка #${taskId}`
}

/** Документ, страница и csv — в заявку; комментарий — PO видит, что fast готов. Сбой трекера ответ не роняет. */
async function publishFast(backlog: Backlog, ticket: Ticket, slug: string, rev: number,
  files: { md: string; html: string; personas: string; requirements: string; contextMap: string }, questions: string[], cortex: boolean): Promise<void> {
  const suffix = rev > 1 ? `-v${rev}` : ''
  try {
    const out: [string, string][] = [[files.html, `${slug}-fast${suffix}.html`], [files.md, `${slug}-fast${suffix}.md`],
      [files.personas, `${slug}-personas${suffix}.csv`], [files.requirements, `${slug}-requirements${suffix}.csv`]]
    // Находки Кортекса — отдельным файлом, как карта /bft-recon: в документ со слов заказчика не вписываются.
    if (cortex) out.push([files.contextMap, `${slug}-context-map${suffix}.md`])
    for (const [path, name] of out) await backlog.attach(ticket, name, await readFile(path))
    await backlog.comment(ticket, [
      `<p><strong>📄 Быстрая версия БФТ собрана в чате заказчика</strong> — версия ${rev}, ${moscowTime(new Date().toISOString())}</p>`,
      `<p>Файлы: ${slug}-fast${suffix}.html (страница ревью) и .md; следующий шаг — /bft-deep по документу.</p>`,
      questions.length ? `<p><strong>Открытые вопросы:</strong></p><ul>${questions.map((q) => `<li>${q.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</li>`).join('')}</ul>` : '',
    ].join(''))
  } catch (e) {
    console.error('[customer-form] быстрая версия БФТ не ушла в задачу:', e)
  }
}
