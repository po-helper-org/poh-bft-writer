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
import { buildFast, FAST_ROOT, fastPageUrl, fastProgress, fastSlug, portalUrl, SKILLS_PATH } from './bft-fast.js'
import { contextMapMarkdown, cortexBrief } from './cortex.js'
import { cortexQuery, KINDS, SPECIALISTS, toFastInput, type PrimaryArgs, type PrimaryDoc } from './primary.js'
import { demoSteps, doneList, repairDemo, sharedDemos, storyboardMarkdown, type AcceptanceDemo, type DemoRecord } from './demo.js'
import { demoPageHtml } from './demo-page.js'
import { moscowTime, sharedBacklog, type Backlog, type Intake, type Ticket } from './host.js'
import { materialsPack, pendingNote, sharedMaterials, type Materials } from './materials.js'

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
  inject(message: { id: string; role: 'user'; source: { kind: string }; content: readonly BlockLike[] }): void
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
            expect: text('Что он должен увидеть — проверяемо: цифры, файл, статус'),
            device: optional('Где этот экран: браузер, письмо, уведомление или приложение'),
            mock: text('Что заказчик увидит на этом экране — для картинки раскадровки, сверху вниз через «;»: заголовок: …; текст: …; оффер: …; кнопка: …; список: 3; поле: Сумма = 1 500 ₽; '
              + 'отметка: Оплачено (галочка в шапке); успех: …; отказ: …; уведомление: от / заголовок / текст. 3–6 частей, только то, что заказчик увидит'),
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
        description: 'Чего нет в материалах или где они противоречат друг другу — заказчик поправит в «Нужны правки»',
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
      await attachAcceptancePage(backlog, agent.session.id, approved)
      // Дальше заказчик только ждёт документ (rev16): ссылку и «уже готовлю» пишет
      // портал сам — сразу, не дожидаясь модели; справа — ход сборки.
      fastProgress.start(agent.session.id)
      agent.inject({
        id: randomUUID(),
        role: 'user',
        source: { kind: 'user' },
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
  agent.inject({
    id: randomUUID(),
    role: 'user',
    source: { kind: 'user' },
    content: [{ type: 'text', text: `📌 Заявка #${ticket.taskId} зарегистрирована в беклоге: ${ticket.url}. Статус — по ссылке.` }],
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
      asis: text('ASIS: как работает сейчас'),
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
      fastProgress.stage(agent.session.id, 'submitted')
      return `Заявка #${ticket.taskId} обновлена: постановка, сводка и полный контекст сохранены. Отслеживание статуса: ${ticket.url}`
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
        },
      },
      requirements: {
        type: 'array', required: true, description: 'Требования со слов: каждое — одна короткая фраза и цитата; чего не говорил — не добавляй',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            kind: { type: 'string', required: true, enum: [...KINDS], description: 'зачем — ценность; пользователю — что хочет пользователь; на экране — что он видит; система — что делает система; качество — измеримое свойство, только если названо' },
            text: text('Требование — одна фраза'),
            quote: quote('Откуда требование'),
          },
        },
      },
      outOfScope: { type: 'array', items: { type: 'string' }, description: 'Что не входит и договорённости — только сказанное' },
      people: {
        type: 'array', description: 'Заказчик и люди, которых он назвал',
        items: { type: 'object', additionalProperties: false, properties: { name: text('Имя'), role: optional('Роль — из сказанного'), about: optional('По каким вопросам к нему — из сказанного') } },
      },
      openQuestions: { type: 'array', items: { type: 'string' }, description: 'Настоящие пробелы задачи — уходят в чат и в заявку' },
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
      const ticket = await ensureTicket(backlog, agent, args.title)
      const record = sharedDemos().get(sessionId)
      const howToDemo = record?.approvedAt ? demoSteps(record.demo) : []
      const checklist = record?.approvedAt ? doneList(record.demo) : []
      const slug = fastSlug(ticket.taskId)
      fastProgress.stage(sessionId, 'building')
      // Шаблон — кодом из полей модели; Кортекс — параллельно, его не ждёт линтер.
      const [built, brief] = await Promise.all([
        buildFast(toFastInput(args, checklist), { slug, howToDemo, source: `заявка #${ticket.taskId} в трекере — ${ticket.url}`, skillsPath: SKILLS_PATH }, FAST_ROOT),
        cortexBrief(cortexQuery(args, howToDemo)),
      ])
      if (!built.ok) throw new Error(`Документ не собран, исправь поля и вызови create_bft_fast снова:\n${built.errors}`)
      const doc: PrimaryDoc = { args, howToDemo, checklist, ...(record?.demo.where ? { where: record.demo.where } : {}), ...(brief ? { brief } : {}) }
      await writeFile(built.files.primary, JSON.stringify(doc), 'utf8')
      if (brief) await writeFile(built.files.contextMap, contextMapMarkdown(brief, slug), 'utf8')
      // Номер сборки — в имени вложения: PO видит, что пересобиралось. Счётчик — на диске, рестарт его не обнуляет.
      const counter = `${built.files.dir}/version`
      const rev = Number(await readFile(counter, 'utf8').catch(() => '0')) + 1
      await writeFile(counter, String(rev), 'utf8')
      const questions = (args.openQuestions ?? []).map((q) => q.trim()).filter(Boolean)
      fastProgress.stage(sessionId, 'ready')
      void publishFast(backlog, ticket, slug, rev, built.files, questions, !!brief)
      const zones = brief?.people.map((p) => `${p.name} (${p.zones.slice(0, 2).join(', ')})`) ?? []
      return [
        `Первичные требования собраны (версия ${rev}, шаблон bft-fast пройден) и приложены к заявке #${ticket.taskId}.`,
        `Страница документа для заказчика: ${fastPageUrl(sessionId)}`,
        brief ? `Кортекс${brief.vault.demo ? ' (демо-память)' : ''}: зоны влияния — ${zones.join('; ') || 'не найдены'}; систем для проверки — ${brief.landscape.length}. Это уже на странице.` : 'Кортекс не подключён: контуров проверки и зон влияния на странице нет.',
        questions.length ? ['Открытые вопросы (перечисли заказчику):', ...questions.map((q) => `- ${q}`)].join('\n') : 'Открытых вопросов нет.',
      ].join('\n')
    },
  }
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
