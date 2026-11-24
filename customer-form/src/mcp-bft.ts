/**
 * MCP «Система БФТ» (ADR-0023): полный цикл БФТ для внешнего ИИ-агента —
 * заявка → сценарий приёмки → бриф (первичные требования) → полный БФТ →
 * форма вопросов → выгрузка для Confluence.
 *
 * Текст пишет модель агента (его токены). Знания и качество — в портале:
 * методология и шаблоны навыков, память организации (Кортекс), поиск по
 * Jira/Confluence через шлюз только на чтение, проверки канона и линтер,
 * хранение, заявка в трекере, форма вопросов, выгрузка. Модель портала в
 * цикле MCP не вызывается. В Confluence публикует сам агент своим Atlassian MCP.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { approveFast, FAST_ROOT, fastFiles, fastPageUrl, fastSlug, fastState, portalUrl, SKILLS_PATH } from './bft-fast.js'
import { deepFiles, deepJudge, failDeep, finishDeep, readDeepState, saveDeepState, type DeepJudgeInput, type DeepState, type DeepTrail, type PreviousAttempt } from './bft-deep.js'
import { contextMapMarkdown, cortexBrief, relevantBrief, type CortexBrief } from './cortex.js'
import { buildFastFromPrimary, cortexQuery, primaryErrors, type PrimaryArgs, type PrimaryDoc } from './primary.js'
import { demoIntake, glossaryOf, mergeIntake } from './intake.js'
import { demoSteps, doneList, repairDemo, sharedDemos, storyboardMarkdown, type AcceptanceDemo } from './demo.js'
import { moscowTime, type Backlog, type Intake, type Ticket } from './host.js'
import { customerPage, hitsText, readCustomerPages, saveCustomerPages, type ConfluenceSource } from './confluence.js'
import { formOfRequest, latestVersion } from './forms.js'
import { attachAcceptancePage, DEMO_PARAMS, FAST_PARAMS, MCP_SESSION_PREFIX, publishFast, requestSource, SUBMIT_PARAMS } from './request-flow.js'
import type { McpCaller, McpPrompt, McpResource, McpTool } from './mcp-server.js'

/** Что MCP берёт у узла портала (замыкания index.ts). */
export interface BftMcpDeps {
  backlog: Backlog
  /** Поиск и чтение Confluence шлюзом только на чтение; undefined — источники не подключены. */
  confluence(): ConfluenceSource | undefined
  /** Вход проверки полного БФТ: разведка по запросам агента, слова заказчика, память, ответы формы. */
  deepInput(ticket: Ticket, sessionId: string, queries: string[]): Promise<{ input: DeepJudgeInput; sourcesPath: string; sources: string }>
  /** Выдать ссылку формы вопросов (как «Сформировать форму» на странице БФТ). */
  createForm(sessionId: string): Promise<{ url: string }>
  /** Полный БФТ — в заявку трекера (документ, страница ревью, карта источников). */
  reportDeep(ticket: Ticket, state: DeepState, sourcesPath?: string): Promise<void>
}

// ── Заявки MCP и их владельцы ───────────────────────────────────────────────

interface McpRequest { user: string; createdAt: string; title?: string }
const OWNERS = () => join(process.env.DSH_HOME ?? '/data', 'customer-form', 'mcp-requests.json')

function owners(): Record<string, McpRequest> {
  try { return JSON.parse(readFileSync(OWNERS(), 'utf8')) as Record<string, McpRequest> } catch { return {} }
}
function saveOwner(sessionId: string, record: McpRequest): void {
  const all = owners()
  all[sessionId] = record
  mkdirSync(dirname(OWNERS()), { recursive: true })
  writeFileSync(OWNERS(), JSON.stringify(all, undefined, 1), 'utf8')
}

// ── Схемы: формат параметров инструментов чата → JSON Schema ────────────────

type Param = { type?: string; required?: boolean; description?: string; items?: Param; properties?: Record<string, Param>; enum?: unknown[]; additionalProperties?: boolean }

export function jsonSchema(node: Param): Record<string, unknown> {
  const { required: _required, items, properties, ...rest } = node
  if (properties) {
    const req = Object.entries(properties).filter(([, v]) => v.required).map(([k]) => k)
    return { ...rest, type: 'object', properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, jsonSchema(v)])), ...(req.length ? { required: req } : {}), additionalProperties: false }
  }
  if (items) return { ...rest, type: 'array', items: jsonSchema(items) }
  return rest
}

const REQUEST_ID = { type: 'string', required: true, description: 'request_id заявки из bft_start_request (mcp-…)' }
const withRequest = (params: Record<string, Param>): Record<string, unknown> => jsonSchema({ properties: { request_id: REQUEST_ID, ...params } })

// ── Путеводитель ────────────────────────────────────────────────────────────

export const MCP_INSTRUCTIONS = `«Система БФТ» — подготовка бизнес-функциональных требований (БФТ) по корпоративной методологии.
Пишешь тексты ты (своей моделью). Портал даёт знания организации (память Кортекса, ИТ-ландшафт, Jira/Confluence), шаблоны и проверки канона, хранит заявку и документы.
Цикл: bft_start_request → (bft_get_context, bft_search_confluence, bft_attach_confluence_page) → bft_set_acceptance_demo → bft_submit_request → bft_create_brief → bft_approve_brief → bft_prepare_full_bft → bft_submit_full_bft (повторяй до «принят») → bft_create_form → bft_export_for_confluence → публикация своим Atlassian MCP → bft_record_publication.
Подробно — промт bft_full_cycle или ресурс bft://guide. Ты — стенограф заказчика: только его слова и материалы, каждое требование с цитатой; чего он не сказал — в открытые вопросы, не додумывай.`

const GUIDE = `# Полный цикл БФТ через MCP «Система БФТ»

Ты ведёшь заказчика от идеи до документа. Пишешь ты; портал проверяет и хранит. Говори с заказчиком по-русски, простыми словами, по одному-два вопроса за раз.

## 1. Заявка — bft_start_request
Передай первое обращение заказчика дословно (customer_text). Портал заведёт заявку в трекере и вернёт request_id и что о теме знает организация (люди и зоны влияния, процессы, системы, термины, прошлые БФТ). Дальнейшие реплики заказчика передавай дословно в bft_add_customer_words — это стенограмма для PO и источник цитат.

## 2. Выяснить постановку
Спроси, пока не будет ясно: что нужно и зачем; как сейчас (ASIS) и что не устраивает (GAP); как должно стать (TOBE); кто пользователи; где и как заказчик проверит результат; сроки, метрика успеха; сокращения. Материалы и ссылки Confluence: bft_search_confluence → bft_attach_confluence_page (страница идёт в контекст полного БФТ). Контекст организации по теме — bft_get_context.

## 3. Сценарий приёмки — bft_set_acceptance_demo
2–7 шагов «экран → действие → что видит», чек-лист приёмки от лица заказчика, свои допущения — вопросами в unclear. Покажи сценарий заказчику (портал вернёт раскадровку и ссылку) и получи явное «согласую». customer_confirmed=true — только после его согласия.

## 4. Постановка — bft_submit_request
Сводка в заявку: название, заказчик, суть, ASIS/GAP/TOBE, шаги HowToDemo, глоссарий, ссылки, открытые вопросы.

## 5. Бриф (первичные требования) — bft_create_brief
Ты — стенограф: требования только со слов заказчика, у каждого — дословная цитата («Заказчик: «…»», «Материалы [S1]: «…»», «Сценарий приёмки (согласован): «…»»). Ошибки формы портал вернёт текстом — исправь поля и вызови снова. Покажи заказчику документ (ссылка) и открытые вопросы. Правки — тот же вызов.

## 6. Согласование брифа — bft_approve_brief
Только после явного «да, верно» заказчика (customer_confirmed=true).

## 7. Полный БФТ — bft_prepare_full_bft → bft_submit_full_bft
prepare: дай 3–5 поисковых запросов по-русски (1–4 слова, предмет заявки или имя системы) — портал найдёт в Jira/Confluence связанное и вернёт ЗАДАНИЕ: системную инструкцию (правила канона и образец) и входные данные. Сгенерируй канон строго по заданию и передай целиком в bft_submit_full_bft. Портал прогонит линтер и проверки канона: ошибки — исправь канон целиком и отправь снова (до «принят»). Не выдумывай факты: чего нет во входе — [УТОЧНИТЬ у <кого>: вопрос?].

## 8. Форма вопросов — bft_create_form
Открытая ссылка для заказчика и команд: ответы на [УТОЧНИТЬ]. Когда ответы придут (bft_get_request покажет), снова bft_prepare_full_bft → bft_submit_full_bft — ответы уже во входе.

## 9. Confluence — bft_export_for_confluence → твой Atlassian MCP → bft_record_publication
Портал отдаёт название и markdown документа. Публикуй своим инструментом Confluence (например confluence_create_page, content_format=markdown) в пространство и под родителя, которых назовёт пользователь, только с его согласия; ссылку на страницу верни в bft_record_publication.

Статус и ссылки в любой момент — bft_get_request; свои заявки — bft_list_requests.`

// ── Помощники ───────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [])

function briefMarkdown(brief: CortexBrief | undefined): string {
  if (!brief) return 'Память организации (Кортекс) не подключена.'
  const lines: string[] = [`Память организации${brief.vault.demo ? ' (демо)' : ''}: ${brief.vault.name}, узлов ${brief.vault.nodes}.`]
  const list = (title: string, items: string[]) => { if (items.length) lines.push(`\n${title}:`, ...items.slice(0, 12).map((i) => `- ${i}`)) }
  list('Люди и зоны влияния', brief.people.map((p) => `${p.name}${p.role ? ` — ${p.role}` : ''}${p.zones.length ? ` (зоны: ${p.zones.slice(0, 3).join(', ')})` : ''}`))
  list('Процессы', brief.processes.map((p) => `${p.title}: ${p.summary}`.slice(0, 240)))
  list('Системы (где проверять)', brief.landscape.map((s) => `${s.title}${s.where_to_check.length ? ` — ${s.where_to_check.slice(0, 2).join('; ')}` : ''}`))
  list('Термины', (brief.glossary ?? []).map((t) => `${t.term} — ${t.meaning}`))
  list('Прошлые БФТ по теме', (brief.precedents ?? []).map((p) => `${p.title}: ${p.summary}`.slice(0, 240)))
  return lines.join('\n')
}

const deepStateLabel = (state?: DeepState) => !state ? 'не собирался' : state.stage === 'ready' ? 'готов' : state.stage === 'building' ? 'в работе у агента' : 'не принят'

interface McpDeepRun { input: DeepJudgeInput; sourcesPath: string; startedAt: string; attempts: number; trail: DeepTrail; previous?: PreviousAttempt }
const deepRunPath = (dir: string) => join(dir, 'mcp-deep.json')
const conversationPath = (dir: string) => join(dir, 'mcp-conversation.md')

/** Инструменты, промт и ресурсы MCP «Система БФТ». */
export function bftMcp(deps: BftMcpDeps): { tools: McpTool[]; prompts: McpPrompt[]; resources: McpResource[] } {
  const { backlog } = deps

  /** Заявка этого пользователя; чужая или неизвестная — ошибка. */
  const own = async (args: Record<string, unknown>, caller: McpCaller) => {
    const sessionId = str(args.request_id)
    const record = owners()[sessionId]
    if (!record || record.user !== caller.user) throw new Error(`Нет вашей заявки ${sessionId || '(request_id не задан)'} — request_id из bft_start_request или bft_list_requests.`)
    const ticket = await backlog.find(sessionId)
    if (!ticket) throw new Error('Заявка не найдена в трекере.')
    const slug = fastSlug(ticket.taskId)
    return { sessionId, ticket, slug, files: fastFiles(FAST_ROOT, slug), record }
  }
  const words = async (dir: string) => readFile(conversationPath(dir), 'utf8').catch(() => '')
  const appendWords = async (dir: string, who: string, text: string) => {
    mkdirSync(dir, { recursive: true })
    await writeFile(conversationPath(dir), `${await words(dir)}\n**${who}** (${moscowTime(new Date().toISOString())}):\n${text.trim()}\n`, 'utf8')
  }

  const status = async (sessionId: string, ticket: Ticket) => {
    const slug = fastSlug(ticket.taskId)
    const files = fastFiles(FAST_ROOT, slug)
    const fast = await fastState(files)
    const deep = await readDeepState(deepFiles(files, slug))
    const demo = sharedDemos().get(sessionId)
    const form = await formOfRequest(files.dir).catch(() => undefined)
    const questions = form ? latestVersion(form)?.questions ?? [] : []
    const answered = form ? questions.filter((q) => form.answers[q.qid]?.status === 'answer').length : 0
    const dl = (doc: string) => ['docx', 'pdf', 'md'].map((f) => portalUrl(`/api/customer-form.bftDownload?session=${encodeURIComponent(sessionId)}&doc=${doc}&format=${f}`)).join(' · ')
    return [
      `Заявка #${ticket.taskId} (request_id ${sessionId})`,
      `Сценарий приёмки: ${demo ? (demo.approvedAt ? 'согласован' : 'на согласовании') : 'нет'}`,
      `Бриф: ${fast ? `версия ${fast.rev}, ${fast.approvedAt ? 'согласован' : 'на проверке'} — ${fastPageUrl(sessionId)}${deep ? '&view=fast' : ''}` : 'не собран'}`,
      fast ? `  выгрузка: ${dl('fast')}` : '',
      `Полный БФТ: ${deepStateLabel(deep)}${deep?.stage === 'ready' ? ` — ${fastPageUrl(sessionId)}\n  выгрузка: ${dl('deep')}` : ''}`,
      form?.publishedAt && !form.revokedAt ? `Форма вопросов: ответов ${answered} из ${questions.length}${form.lastSubmitAt && deep?.finishedAt && form.lastSubmitAt > deep.finishedAt ? ' — есть новые ответы: пересоберите полный БФТ (bft_prepare_full_bft)' : ''}` : 'Форма вопросов: не выдана',
    ].filter(Boolean).join('\n')
  }

  const tools: McpTool[] = [
    {
      name: 'bft_start_request',
      title: 'Новая заявка на БФТ',
      description: 'Шаг 1. Завести заявку по первому обращению заказчика (дословно). Возвращает request_id и что организация знает по теме (Кортекс): люди и зоны влияния, процессы, системы, термины, прошлые БФТ. Дальше — выясни постановку (промт bft_full_cycle).',
      inputSchema: jsonSchema({ properties: {
        customer_text: { type: 'string', required: true, description: 'Первое обращение заказчика — дословно' },
        customer_name: { type: 'string', description: 'ФИО заказчика, если известно' },
      } }),
      async call(args, caller) {
        const text = str(args.customer_text).trim()
        if (text.length < 10) throw new Error('customer_text — обращение заказчика дословно, хотя бы одно предложение.')
        const sessionId = `${MCP_SESSION_PREFIX}${randomUUID()}`
        const ticket = await backlog.ensure(sessionId, text.slice(0, 2000))
        saveOwner(sessionId, { user: caller.user, createdAt: new Date().toISOString() })
        const dir = fastFiles(FAST_ROOT, fastSlug(ticket.taskId)).dir
        await appendWords(dir, `Заказчик${str(args.customer_name) ? ` (${str(args.customer_name)})` : ''}`, text)
        const brief = await cortexBrief(text).then((b) => (b ? relevantBrief(b, text) : undefined)).catch(() => undefined)
        return [
          `Заявка #${ticket.taskId} заведена. request_id: ${sessionId}`,
          '',
          briefMarkdown(brief),
          '',
          'Дальше: выясни у заказчика постановку (что и зачем, ASIS/GAP/TOBE, пользователи, как он проверит результат). Его ответы — дословно в bft_add_customer_words.',
        ].join('\n')
      },
    },
    {
      name: 'bft_add_customer_words',
      description: 'Дословная реплика заказчика (или ответ на вопрос) — в стенограмму заявки. Это источник цитат для брифа и материал для PO.',
      inputSchema: withRequest({ text: { type: 'string', required: true, description: 'Реплика заказчика дословно' }, question: { type: 'string', description: 'Твой вопрос, на который он ответил' } }),
      async call(args, caller) {
        const { files } = await own(args, caller)
        if (str(args.question).trim()) await appendWords(files.dir, 'Агент', str(args.question))
        await appendWords(files.dir, 'Заказчик', str(args.text))
        return 'Записано в стенограмму заявки.'
      },
    },
    {
      name: 'bft_get_context',
      description: 'Что знает организация по теме (память Кортекса): люди и зоны влияния, процессы, системы и где их проверять, термины, прошлые БФТ.',
      inputSchema: withRequest({ topic: { type: 'string', required: true, description: 'Тема: предмет заявки, система, процесс' } }),
      async call(args, caller) {
        await own(args, caller)
        const topic = str(args.topic)
        const brief = await cortexBrief(topic).then((b) => (b ? relevantBrief(b, topic) : undefined)).catch(() => undefined)
        return briefMarkdown(brief)
      },
    },
    {
      name: 'bft_search_confluence',
      description: 'Поиск страниц в корпоративном Confluence (только чтение). Нужную страницу — bft_attach_confluence_page.',
      inputSchema: withRequest({ query: { type: 'string', required: true, description: 'Запрос, 1–5 слов' }, limit: { type: 'number', description: 'Сколько страниц, до 10' } }),
      async call(args, caller) {
        await own(args, caller)
        const source = deps.confluence()
        if (!source || !(await source.available().catch(() => false))) throw new Error('Confluence сейчас не подключён к порталу.')
        const query = str(args.query)
        return hitsText(query, await source.searchConfluence(query, Math.min(10, Number(args.limit) || 6)))
      },
    },
    {
      name: 'bft_attach_confluence_page',
      description: 'Прочитать страницу Confluence и приложить её к заявке: она пойдёт в контекст полного БФТ. Возвращает текст страницы.',
      inputSchema: withRequest({ page_id: { type: 'string', required: true, description: 'pageId из bft_search_confluence' } }),
      async call(args, caller) {
        const { files } = await own(args, caller)
        const source = deps.confluence()
        if (!source) throw new Error('Confluence сейчас не подключён к порталу.')
        const page = await source.readConfluencePage(str(args.page_id))
        const item = customerPage(page)
        if (item) {
          const known = await readCustomerPages(files.dir)
          await saveCustomerPages(files.dir, [...known.filter((p) => p.id !== item.id), item])
        }
        return `Страница «${page.title}» приложена к заявке.\n\n${page.text.slice(0, 12_000)}`
      },
    },
    {
      name: 'bft_set_acceptance_demo',
      title: 'Сценарий приёмки (HowToDemo)',
      description: 'Шаг 3. Сценарий, по которому заказчик примет работу: 2–7 экранов, чек-лист, допущения вопросами. Возвращает раскадровку — покажи её заказчику. customer_confirmed=true — только после его явного «согласую»; правки — вызови снова.',
      inputSchema: withRequest({ ...(DEMO_PARAMS as Record<string, Param>), customer_confirmed: { type: 'boolean', required: true, description: 'Заказчик явно согласовал этот сценарий' } }),
      async call(args, caller) {
        const { sessionId, ticket } = await own(args, caller)
        const demo = repairDemo(args as unknown as AcceptanceDemo)
        if (!demo.steps?.length) throw new Error('В сценарии нет шагов.')
        const demos = sharedDemos()
        const confirmed = args.customer_confirmed === true
        const record = { demo, rev: (demos.get(sessionId)?.rev ?? 0) + 1, ...(confirmed ? { approvedAt: new Date().toISOString() } : {}) }
        demos.set(sessionId, record)
        if (confirmed) await backlog.approveDemo(sessionId, ticket, demoSteps(demo), doneList(demo).join('; '), storyboardMarkdown(demo))
        void attachAcceptancePage(backlog, sessionId, record)
        const page = portalUrl(`/api/customer-form.demo?session=${encodeURIComponent(sessionId)}`)
        return [
          confirmed ? `Сценарий приёмки согласован (версия ${record.rev}) и отмечен в заявке.` : `Сценарий записан (версия ${record.rev}). Покажи его заказчику и получи «согласую».`,
          `Страница сценария: ${page}`, '', storyboardMarkdown(demo),
          confirmed ? '\nДальше: bft_submit_request.' : '',
        ].join('\n')
      },
    },
    {
      name: 'bft_submit_request',
      description: 'Шаг 4. Сдать согласованную постановку в заявку: сводка, ASIS/GAP/TOBE, HowToDemo, глоссарий, ссылки, открытые вопросы. Стенограмму портал приложит сам.',
      inputSchema: withRequest(SUBMIT_PARAMS as Record<string, Param>),
      async call(args, caller) {
        const { ticket, files } = await own(args, caller)
        const intake = args as unknown as Intake
        await backlog.finalize(ticket, intake, (await words(files.dir)) || intake.summary)
        await mergeIntake(files.dir, {
          ...(str(intake.title).trim() ? { title: intake.title.trim() } : {}),
          ...(str(intake.summary).trim() ? { summary: intake.summary.trim() } : {}),
          ...(str(intake.asis).trim() ? { asis: intake.asis!.trim() } : {}),
          ...(str(intake.gap).trim() ? { gap: intake.gap.trim() } : {}),
          ...(str(intake.tobe).trim() ? { tobe: intake.tobe.trim() } : {}),
          glossary: glossaryOf(intake.glossary), links: strs(intake.links), openQuestions: strs(intake.openQuestions),
        })
        saveOwner(str(args.request_id), { ...owners()[str(args.request_id)]!, title: str(intake.title) })
        return `Заявка #${ticket.taskId} обновлена: постановка и стенограмма сохранены. Дальше: bft_create_brief.`
      },
    },
    {
      name: 'bft_create_brief',
      title: 'Бриф (первичные требования)',
      description: 'Шаг 5. Собрать бриф по шаблону bft-fast. Ты — стенограф: только слова заказчика и его материалы, у каждого требования — цитата. Ошибки формы вернутся текстом — исправь и вызови снова; правки заказчика — тот же вызов. Возвращает ссылку на документ и его текст.',
      inputSchema: withRequest(FAST_PARAMS as Record<string, Param>),
      async call(args, caller) {
        const { sessionId, ticket, slug } = await own(args, caller)
        const primary = args as unknown as PrimaryArgs
        const invalid = primaryErrors(primary)
        if (invalid.length) throw new Error(`Исправь поля и вызови bft_create_brief снова:\n${invalid.join('\n')}`)
        const record = sharedDemos().get(sessionId)
        const howToDemo = record?.approvedAt ? demoSteps(record.demo) : []
        const checklist = record?.approvedAt ? doneList(record.demo) : []
        const [built, brief] = await Promise.all([
          buildFastFromPrimary({ args: primary, howToDemo, checklist }, { slug, source: requestSource(ticket.taskId, sessionId) }, FAST_ROOT),
          cortexBrief(cortexQuery(primary, howToDemo)).then((b) => (b ? relevantBrief(b, cortexQuery(primary, howToDemo)) : undefined)).catch(() => undefined),
        ])
        if (!built.ok) throw new Error(`Документ не собран, исправь поля и вызови bft_create_brief снова:\n${built.errors}`)
        const doc: PrimaryDoc = { args: primary, howToDemo, checklist, ...(record?.demo.where ? { where: record.demo.where } : {}), ...(brief ? { brief } : {}) }
        await writeFile(built.files.primary, JSON.stringify(doc), 'utf8')
        if (record?.approvedAt) await mergeIntake(built.files.dir, demoIntake(record.demo)).catch(() => undefined)
        if (brief) await writeFile(built.files.contextMap, contextMapMarkdown(brief, slug), 'utf8')
        const counter = `${built.files.dir}/version`
        const rev = Number(await readFile(counter, 'utf8').catch(() => '0')) + 1
        await writeFile(counter, String(rev), 'utf8')
        const questions = strs(primary.openQuestions)
        void publishFast(backlog, ticket, slug, rev, built.files, questions, !!brief)
        const md = await readFile(built.files.md, 'utf8').catch(() => '')
        return [
          `Бриф собран (версия ${rev}, шаблон bft-fast пройден) и приложен к заявке #${ticket.taskId}.`,
          `Страница документа: ${fastPageUrl(sessionId)}`,
          record?.approvedAt ? '' : '⚠ Сценарий приёмки не согласован — в брифе нет HowToDemo. Согласуй его (bft_set_acceptance_demo) и пересобери бриф.',
          questions.length ? ['Открытые вопросы:', ...questions.map((q) => `- ${q}`)].join('\n') : '',
          'Покажи заказчику документ и открытые вопросы; после его явного «да, верно» — bft_approve_brief.',
          '', '--- Документ (markdown) ---', md.slice(0, 30_000),
        ].filter((l) => l !== '').join('\n')
      },
    },
    {
      name: 'bft_approve_brief',
      description: 'Шаг 6. Заказчик согласовал бриф: отметка в заявке. Только после его явного согласия. Полный БФТ модель портала не собирает — дальше bft_prepare_full_bft.',
      inputSchema: withRequest({ customer_confirmed: { type: 'boolean', required: true, description: 'Заказчик явно согласовал бриф' } }),
      async call(args, caller) {
        if (args.customer_confirmed !== true) throw new Error('Согласовать можно только после явного согласия заказчика (customer_confirmed=true).')
        const { ticket, files, slug } = await own(args, caller)
        if (!(await fastState(files))) throw new Error('Бриф ещё не собран — сначала bft_create_brief.')
        const state = await approveFast(files)
        void backlog.comment(ticket, `<p><strong>✅ Бриф согласован заказчиком</strong> (через ИИ-агента, MCP) — ${moscowTime(state.approvedAt!)}</p><p>Документ: ${slug}-fast.html во вложениях.</p>`).catch(() => undefined)
        return 'Бриф согласован. Дальше: bft_prepare_full_bft с 3–5 поисковыми запросами по теме заявки.'
      },
    },
    {
      name: 'bft_prepare_full_bft',
      title: 'Задание на полный БФТ',
      description: 'Шаг 7а. Портал ищет связанное в Jira/Confluence по твоим запросам, собирает вход (бриф, слова заказчика, память организации, найденное, ответы формы) и возвращает ЗАДАНИЕ: системную инструкцию с правилами канона и образцом и пользовательскую часть. Сгенерируй канон своей моделью строго по заданию и передай в bft_submit_full_bft. Повторный вызов — новое задание (например, после ответов в форме).',
      inputSchema: withRequest({ search_queries: { type: 'array', required: true, items: { type: 'string' }, description: '3–5 поисковых запросов по-русски, 1–4 слова: предмет заявки или имя системы; один — о том, как это устроено сейчас' } }),
      async call(args, caller) {
        const { sessionId, ticket, files } = await own(args, caller)
        const fast = await fastState(files)
        if (!fast?.approvedAt) throw new Error('Бриф не согласован — сначала bft_approve_brief.')
        const prepared = await deps.deepInput(ticket, sessionId, strs(args.search_queries).slice(0, 6))
        const judge = await deepJudge(prepared.input)
        const startedAt = new Date().toISOString()
        const run: McpDeepRun = { input: prepared.input, sourcesPath: prepared.sourcesPath, startedAt, attempts: 0, trail: { lintErrorsByAttempt: [], checkErrorsByAttempt: [], warnings: [], fixes: [] } }
        await writeFile(deepRunPath(files.dir), JSON.stringify(run), 'utf8')
        await saveDeepState(deepFiles(files, fastSlug(ticket.taskId)), { stage: 'building', startedAt })
        const prompt = judge.prompt()
        const found = prepared.input.sources
        return [
          `Задание на полный БФТ по заявке #${ticket.taskId}. Источники: ${found ? `${found.source || 'Jira/Confluence'}, находок ${found.count} (${found.mode})` : 'не подключены'}.`,
          'Сгенерируй канон своей моделью: SYSTEM — как системную инструкцию, USER — как задание. Верни только канон (markdown) целиком в bft_submit_full_bft. Шапку и блок «Продолжить» портал добавит сам.',
          '', '=== SYSTEM ===', prompt.system, '', '=== USER ===', prompt.user,
        ].join('\n')
      },
    },
    {
      name: 'bft_submit_full_bft',
      description: 'Шаг 7б. Сдать канон полного БФТ, сгенерированный по заданию bft_prepare_full_bft. Портал применяет автоправки, линтер шаблона и проверки канона. Ошибки — вернутся списком: исправь канон целиком и сдай снова. Принят — страница ревью, выгрузка, вложение в заявку.',
      inputSchema: withRequest({ canon: { type: 'string', required: true, description: 'Канон полного БФТ (markdown) целиком' } }),
      async call(args, caller) {
        const { ticket, files, slug } = await own(args, caller)
        const run = await readFile(deepRunPath(files.dir), 'utf8').then((t) => JSON.parse(t) as McpDeepRun, () => undefined)
        if (!run) throw new Error('Сначала bft_prepare_full_bft — задание на полный БФТ.')
        const canon = str(args.canon)
        if (canon.trim().length < 500) throw new Error('canon — полный текст канона по заданию (markdown), не короче 500 знаков.')
        const judge = await deepJudge(run.input)
        run.attempts += 1
        // С третьей сдачи пробел покрытия и строка plantuml уходят в замечания, а не держат документ (как у модели портала).
        const verdict = await judge.judge(canon, run.attempts >= 3)
        run.trail.lintErrorsByAttempt.push(verdict.lintErrors)
        run.trail.checkErrorsByAttempt.push(verdict.checkErrors)
        run.trail.warnings = verdict.warnings
        run.trail.fixes = verdict.fixes
        if (!verdict.ok) {
          run.previous = verdict.previous
          await writeFile(deepRunPath(files.dir), JSON.stringify(run), 'utf8')
          if (run.attempts >= 6) {
            await failDeep(run.input, judge.files, judge.fastMd, run.trail, run.attempts, run.startedAt, verdict.previous.errors)
            throw new Error(`Канон не прошёл проверку за ${run.attempts} сдач — сборка отмечена неудачной. Начни заново с bft_prepare_full_bft.\n\nОшибки:\n${verdict.previous.errors}`)
          }
          throw new Error([
            `Канон не принят (сдача ${run.attempts}): ошибок ${verdict.errors.length}. Исправь их и сдай канон ЦЕЛИКОМ снова.`,
            '', 'Ошибки:', verdict.previous.errors,
            verdict.previous.warnings ? `\nЗамечания (исправь, если не противоречит правилам):\n${verdict.previous.warnings}` : '',
          ].join('\n'))
        }
        const state = await finishDeep(run.input, judge, verdict.canon, run.trail, run.attempts, run.startedAt)
        await writeFile(deepRunPath(files.dir), JSON.stringify({ ...run, acceptedAt: state.finishedAt }), 'utf8')
        void deps.reportDeep(ticket, state, run.sourcesPath)
        const metrics = state.quality?.metrics as Record<string, unknown> | undefined
        return [
          `Полный БФТ принят (сдача ${run.attempts}) и приложен к заявке #${ticket.taskId}.`,
          `Страница документа: ${fastPageUrl(str(args.request_id))}`,
          `Выгрузка: ${['docx', 'pdf', 'md'].map((f) => portalUrl(`/api/customer-form.bftDownload?session=${encodeURIComponent(str(args.request_id))}&doc=deep&format=${f}`)).join(' · ')}`,
          `Вопросов к согласованию: ${state.questions?.length ?? 0}. Замечаний: ${verdict.warnings.length}.`,
          metrics ? `Метрики качества: ${JSON.stringify(metrics).slice(0, 600)}` : '',
          `Дальше: bft_create_form (вопросы заказчику и командам), затем bft_export_for_confluence. Документ: ${slug}.md`,
        ].filter(Boolean).join('\n')
      },
    },
    {
      name: 'bft_create_form',
      description: 'Шаг 8. Выдать открытую ссылку формы вопросов по полному БФТ: заказчик и команды отвечают на [УТОЧНИТЬ] без входа в портал. Когда ответы придут — снова bft_prepare_full_bft → bft_submit_full_bft.',
      inputSchema: withRequest({}),
      async call(args, caller) {
        const { sessionId, files, slug } = await own(args, caller)
        if ((await readDeepState(deepFiles(files, slug)))?.stage !== 'ready') throw new Error('Полный БФТ ещё не принят — сначала bft_submit_full_bft.')
        const { url } = await deps.createForm(sessionId)
        return `Форма вопросов: ${url}\nОтправь ссылку заказчику и командам. Ответы появятся в bft_get_request.`
      },
    },
    {
      name: 'bft_export_for_confluence',
      description: 'Шаг 9. Документ для публикации в Confluence: название и markdown полного БФТ (или брифа, если полного нет). Публикуй своим Atlassian MCP (например confluence_create_page, content_format=markdown) в пространство и под родителя, которых назовёт пользователь, и только с его согласия; затем bft_record_publication.',
      inputSchema: withRequest({ doc: { type: 'string', enum: ['deep', 'brief'], description: 'deep — полный БФТ (по умолчанию), brief — бриф' } }),
      async call(args, caller) {
        const { files, slug } = await own(args, caller)
        const deep = await readDeepState(deepFiles(files, slug))
        const useDeep = str(args.doc) !== 'brief'
        if (useDeep && deep?.stage !== 'ready') throw new Error('Полный БФТ ещё не принят. Для брифа — doc="brief".')
        const md = await readFile(useDeep ? deepFiles(files, slug).md : files.md, 'utf8')
        const body = md.replace(/^---\n[\s\S]*?\n---\n+/, '')
        const title = (/^# (.+)$/m.exec(body)?.[1] ?? slug).trim()
        return [`Название страницы: ${title}`, 'Формат: markdown. Опубликуй своим инструментом Confluence; ссылку — в bft_record_publication.', '', '--- Содержимое ---', body].join('\n')
      },
    },
    {
      name: 'bft_record_publication',
      description: 'Записать в заявку ссылку на опубликованную страницу Confluence.',
      inputSchema: withRequest({ url: { type: 'string', required: true, description: 'Адрес опубликованной страницы' } }),
      async call(args, caller) {
        const { ticket, files } = await own(args, caller)
        const url = str(args.url).trim()
        if (!/^https?:\/\//.test(url)) throw new Error('url — адрес страницы http(s).')
        await writeFile(join(files.dir, 'confluence.json'), JSON.stringify({ url, at: new Date().toISOString(), by: caller.user }), 'utf8')
        const safe = url.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
        await backlog.comment(ticket, `<p><strong>📘 БФТ опубликован в Confluence</strong>: <a href="${safe}">${safe}</a> (${caller.user}, через MCP)</p>`)
        return `Ссылка записана в заявку #${ticket.taskId}.`
      },
    },
    {
      name: 'bft_get_request',
      description: 'Статус заявки и ссылки: сценарий, бриф, полный БФТ, выгрузка, форма вопросов и ответы.',
      inputSchema: withRequest({}),
      async call(args, caller) {
        const { sessionId, ticket } = await own(args, caller)
        return status(sessionId, ticket)
      },
    },
    {
      name: 'bft_list_requests',
      description: 'Ваши заявки, заведённые через MCP: request_id, номер, название.',
      inputSchema: jsonSchema({ properties: {} }),
      async call(_args, caller) {
        const mine = Object.entries(owners()).filter(([, r]) => r.user === caller.user).sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))
        if (!mine.length) return 'Заявок пока нет — bft_start_request.'
        const rows = await Promise.all(mine.slice(0, 50).map(async ([id, r]) => {
          const ticket = await backlog.find(id).catch(() => undefined)
          return `- ${id} · #${ticket?.taskId ?? '?'} · ${r.title || 'без названия'} · ${r.createdAt.slice(0, 10)}`
        }))
        return rows.join('\n')
      },
    },
  ]

  const prompts: McpPrompt[] = [{
    name: 'bft_full_cycle',
    description: 'Как провести заказчика по полному циклу БФТ: заявка → сценарий приёмки → бриф → полный БФТ → форма вопросов → Confluence.',
    arguments: [{ name: 'idea', description: 'Идея или обращение заказчика, если уже есть' }],
    async get(args) {
      return `${GUIDE}${args.idea ? `\n\n---\nОбращение заказчика:\n${args.idea}\n\nНачни с bft_start_request.` : ''}`
    },
  }]

  const skill = (path: string) => () => readFile(join(SKILLS_PATH, path), 'utf8').catch(() => 'Навык не найден в образе портала.')
  const resources: McpResource[] = [
    { uri: 'bft://guide', name: 'Путеводитель по циклу', description: 'Шаги, инструменты и правила стенографа', mimeType: 'text/markdown', read: async () => GUIDE },
    { uri: 'bft://skills/bft-fast', name: 'Навык bft-fast', description: 'Методология первичных требований (брифа)', mimeType: 'text/markdown', read: skill('bft-fast/SKILL.md') },
    { uri: 'bft://skills/bft-deep', name: 'Навык bft-deep', description: 'Методология полного БФТ по корпоративному канону', mimeType: 'text/markdown', read: skill('bft-deep-swarm/SKILL.md') },
    { uri: 'bft://examples/golden-deep', name: 'Образец полного БФТ', description: 'Эталонный документ канона (другой проект — структура и стиль)', mimeType: 'text/markdown', read: skill('bft-deep-swarm/examples/golden_deep_document.md') },
  ]
  return { tools, prompts, resources }
}
