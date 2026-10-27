/**
 * customer-form/tool · инструменты заказчика внутри пресета агента «customer»:
 * согласование сценария приёмки и сдача заявки.
 *
 * Пресет — изолированная группа плагинов: глобально зарегистрированный
 * инструмент агенту не виден, поэтому submit_customer_request монтируется
 * строкой пресета (customer.patch.yml), а Backlog берёт общий с узлом
 * customer-form (заявку тот создал по первому сообщению).
 */
import { readFile } from 'node:fs/promises'
import { buildFast, FAST_ROOT, fastPageUrl, fastSlug, SKILLS_PATH, type FastInput } from './bft-fast.js'
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
      + 'Вызывай, когда понятно, где и как заказчик будет проверять результат; до ИТОГА. При правках — исправь шаги и вызови снова.',
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
      return ['Заказчик согласовал сценарий приёмки кнопкой «Согласую». В howToDemo заявки перенеси эти шаги без изменений:',
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

function submitTool(backlog: Backlog) {
  return {
    name: 'submit_customer_request',
    description: 'Сдать подтверждённую заказчиком постановку в заявку беклога: описание, сводку и полный контекст. Вызывай один раз, после подтверждения ИТОГА.',
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
      const ticket = await backlog.find(agent.session.id)
      if (!ticket) throw new Error('заявка этой сессии ещё не зарегистрирована — повтори через пару секунд')
      await backlog.finalize(ticket, args, transcriptOf(agent, ticket, args))
      return `Заявка #${ticket.taskId} обновлена: постановка, сводка и полный контекст сохранены. Отслеживание статуса: ${ticket.url}`
    },
  }
}

/** Версия документа по сессии — в имени вложения: PO видит, что пересобиралось. */
const fastRevs = new Map<string, number>()

/**
 * Быстрая версия БФТ в том же чате (ADR-0007 rev14): модель раскладывает
 * подтверждённый запрос по полям, документ и страницу ревью собирает
 * bft-fast.ts штатными скриптами навыка. How to demo — согласованный
 * заказчиком сценарий без пересказа модели.
 */
function fastTool(backlog: Backlog) {
  const smartRow = (letter: string) => optional(`${letter}; не звучало — «[УТОЧНИТЬ]»`)
  return {
    name: 'create_bft_fast',
    description: 'Собрать быструю версию БФТ (bft-fast: шапка документа и страница ревью) по подтверждённой заявке — сразу после submit_customer_request, в этом же чате. '
      + 'Только сказанное заказчиком и его материалы: каждое требование — с цитатой. How to demo инструмент берёт из согласованного сценария приёмки сам. '
      + 'Ошибки формы возвращаются текстом — исправь поля и вызови снова; правки заказчика — тот же вызов с исправленными полями.',
    parameters: {
      title: text('Название документа — как у заявки, до 10 слов'),
      smart: {
        type: 'object', required: true, additionalProperties: false, description: 'Цель SMART-таблицей',
        properties: {
          s: text('S (Specific): что именно делаем, конкретно, словами заказчика'),
          m: smartRow('M (Measurable): по чему проверяем, что цель достигнута — из чек-листа приёмки'),
          a: smartRow('A (Achievable): чем или кем достижимо, если обсуждали'),
          r: smartRow('R (Relevant): зачем это сейчас, для кого — проблема из GAP'),
          t: smartRow('T (Time-bound): срок или веха, если названы'),
        },
      },
      boundaries: strings('Ограничения и договоренности: что входит, что не входит («Не входит: …»), «Дополнительно, если возможно: …», операционные договорённости. Только сказанное'),
      documentation: { type: 'array', items: { type: 'string' }, description: 'Документы и ссылки, которые назвал сам заказчик; нет — пусто' },
      personas: {
        type: 'array', required: true, description: 'Заказчик и люди, которых он назвал',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: text('ФИО'),
            role: optional('Роль — из сказанного; не названа — пусто'),
            influence: optional('За что человек отвечает в этом запросе — одним предложением, из сказанного; не звучало — пусто'),
          },
        },
      },
      requirements: {
        type: 'array', required: true, description: 'Скелет требований на цитатах: порядок БТ → ПТ → ИТ → ФТ → НФТ, типы без цитат не добивай',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            id: text('БТ-1, ПТ-1, ИТ-1, ФТ-1, НФТ-1 — нумерация внутри типа с 1'),
            asis: optional('Как сейчас — из слов заказчика (ASIS заявки), если относится к этой строке; не звучало — пусто'),
            tobe: text('Как будет после — из слов заказчика'),
            related: { type: 'array', items: { type: 'string' }, description: 'ID связанных строк (ПТ-1 → БТ-1), только если связь видна' },
            source: text('Цитата: «Заказчик: «дословно»» (его сообщения и ответы в форме), «Материалы [S1 00:12]: «…»» или «Сценарий приёмки (согласован): «…»». Свои формулировки заказчику не приписывай'),
          },
        },
      },
      openQuestions: { type: 'array', items: { type: 'string' }, description: 'Открытые вопросы — уходят в ответ в чат и в заявку, не в документ' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text', text: value }],
    },
    async execute(args: FastInput, exec: { agent?: AgentLike }) {
      const agent = exec.agent
      if (!agent) throw new Error('нет сессии заказчика')
      const sessionId = agent.session.id
      const ticket = await backlog.find(sessionId)
      if (!ticket) throw new Error('заявка этой сессии ещё не зарегистрирована — сначала submit_customer_request')
      const record = sharedDemos().get(sessionId)
      const howToDemo = record?.approvedAt ? demoSteps(record.demo) : []
      const slug = fastSlug(ticket.taskId)
      const built = await buildFast(args, { slug, howToDemo, source: `заявка #${ticket.taskId} в трекере — ${ticket.url}`, skillsPath: SKILLS_PATH }, FAST_ROOT)
      if (!built.ok) throw new Error(`Документ не собран, исправь поля и вызови create_bft_fast снова:\n${built.errors}`)
      const rev = (fastRevs.get(sessionId) ?? 0) + 1
      fastRevs.set(sessionId, rev)
      const questions = (args.openQuestions ?? []).map((q) => q.trim()).filter(Boolean)
      void publishFast(backlog, ticket, slug, rev, built.files, questions)
      return [
        `Быстрая версия БФТ собрана (версия ${rev}, линтер шаблона пройден) и приложена к заявке #${ticket.taskId}.`,
        `Страница документа для заказчика: ${fastPageUrl(sessionId)}`,
        questions.length ? ['Открытые вопросы (в документ не входят — перечисли заказчику):', ...questions.map((q) => `- ${q}`)].join('\n') : 'Открытых вопросов нет.',
      ].join('\n')
    },
  }
}

/** Документ, страница и csv — в заявку; комментарий — PO видит, что fast готов. Сбой трекера ответ не роняет. */
async function publishFast(backlog: Backlog, ticket: Ticket, slug: string, rev: number,
  files: { md: string; html: string; personas: string; requirements: string }, questions: string[]): Promise<void> {
  const suffix = rev > 1 ? `-v${rev}` : ''
  try {
    for (const [path, name] of [[files.html, `${slug}-fast${suffix}.html`], [files.md, `${slug}-fast${suffix}.md`],
      [files.personas, `${slug}-personas${suffix}.csv`], [files.requirements, `${slug}-requirements${suffix}.csv`]] as const) {
      await backlog.attach(ticket, name, await readFile(path))
    }
    await backlog.comment(ticket, [
      `<p><strong>📄 Быстрая версия БФТ собрана в чате заказчика</strong> — версия ${rev}, ${moscowTime(new Date().toISOString())}</p>`,
      `<p>Файлы: ${slug}-fast${suffix}.html (страница ревью) и .md; следующий шаг — /bft-deep по документу.</p>`,
      questions.length ? `<p><strong>Открытые вопросы:</strong></p><ul>${questions.map((q) => `<li>${q.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</li>`).join('')}</ul>` : '',
    ].join(''))
  } catch (e) {
    console.error('[customer-form] быстрая версия БФТ не ушла в задачу:', e)
  }
}
