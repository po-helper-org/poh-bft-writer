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
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { Backlog, moscowTime, sharedBacklog, ticketRegistered, type Ticket } from './host.js'
import { sharedMaterials, type Material, type Materials, type WebLike } from './materials.js'
import { readCustomerPages, withCustomerPages, type ConfluenceSource } from './confluence.js'
import { VoiceContext } from './voice.js'
import { sharedDemos } from './demo.js'
import { demoPageHtml } from './demo-page.js'
import type { AgentLike, BlockLike } from './tool.js'
import { portalNoteSource } from './portal-note.js'
import { FAST_ROOT, fastFiles, fastPagePath, fastProgress, fastSlug, fastState, isLoopbackUrl, portalUrl, publicPortalUrl, requestRef, SKILLS_PATH, stillBuilding, type FastFiles } from './bft-fast.js'
import { customerDeepPage, customerFastPage, deepFailedPage, requestsPage, waitingPage, type RequestRow } from './fast-page.js'
import { buildDeep, fixQueries, goldenCanon, saveDeepState, searchQueries, deepFiles, readDeepState, readIntake, reconSubject, sourcesForModel, triageFindings, type DeepRoute, type DeepState, type LlmLike, type ReconSubject, type SourcesStatus, type TriageItem, type TriageVerdict } from './bft-deep.js'
import { EXPORT_TYPES, exportDocument, type ExportFormat } from './export.js'
import { buildFastFromPrimary, type PrimaryDoc } from './primary.js'
import { qualityMetrics } from './quality-metrics.js'
import { parseSources } from './canon-check.js'
import { customerWordsContext } from './intake.js'
import { mergePortalModels, MODELS_ROUTE, readPortalModels, sameRoute, writePortalModels, type ModelRoute, type PortalModels } from './models.js'
import { ADMIN_ONLY_ENDPOINTS, ADMIN_PAGE, ADMIN_STATUS, adminOnlyResponse, adminPage, isAdmin } from './admin.js'
import { siblingHref } from './links.js'
import { bftCard, type BftState } from './bft-list.js'
import { answersContext, answersMarkdown, answersPath, editQuestions, formOfRequest, formTitle, isFormId, latestVersion, linkForm, newForm, readForm, refreshForm, reissue, saveForm, submitAnswers, SubmitGate, type BftForm, type EditOp, type FormPerson, type FormQuestion } from './forms.js'
import { formGonePage, formPage, previewPage, type DeepFormLayer } from './form-page.js'
import { mirrorAll, mirrorRequest } from './workspace-mirror.js'
import { approveFastRequest, portalHooks, releaseFastAsk } from './fast-approval.js'
import { titleSession, useSessionTitles } from './session-title.js'

export const name = 'customer-form'

/** Страница «Все заявки» портала (ADR-0012, шаг 7). */
const REQUESTS_PAGE = '/api/customer-form.requests'
/** Форма вопросов по БФТ (ADR-0018): открытые маршруты по ссылке-ключу и правка PO в портале. */
const FORM_PAGE = '/api/customer-form.form'
const FORM_ANSWER = '/api/customer-form.formAnswer'
const FORM_PREVIEW = '/api/customer-form.formPreview'
const FORM_CREATE = '/api/customer-form.formCreate'
const FORM_REVOKE = '/api/customer-form.formRevoke'
const FORM_EDIT = '/api/customer-form.formEdit'
/** Открытые страницы формы: не индексировать, не кэшировать, без Referer наружу. */
const PUBLIC_HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' }
/**
 * Ссылки открытых страниц: за nginx (заголовок X-Bft-Public) страницы живут по
 * /bft/form и /bft/preview — соседние адреса короткие; иначе — маршруты /api.
 */
const publicHrefs = (request: Request) => request.headers.get('x-bft-public') === '1'
  ? { form: 'form', answer: 'form/answer', preview: 'preview' }
  : { form: siblingHref(FORM_PAGE), answer: siblingHref(FORM_ANSWER), preview: siblingHref(FORM_PREVIEW) }

/** Прогон качества на фикстурах (план качества, C0) — только администратор. */
const QUALITY_RUN = '/api/customer-form.qualityRun'
/** Фикстуры прогона качества: <DSH_HOME>/quality/<имя>/primary.json …, итог — в <имя>/out/. */
const QUALITY_ROOT = join(process.env.DSH_HOME ?? '/data', 'quality')

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
  // Ссылки на наш же трекер — не материал. Пустой TRACKER_PUBLIC_URL (трекер не
  // публичный) не фильтрует ничего: startsWith('') отбросил бы все ссылки.
  const own = (process.env.TRACKER_PUBLIC_URL ?? 'http://127.0.0.1:3456').trim().replace(/\/+$/, '')
  for (const url of new Set(textOf(message).match(URL_RE) ?? [])) {
    if (!own || !url.startsWith(own)) found.push(materials.addLink(sessionId, url.replace(/[.,;:!?]+$/, '')))
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
3) ASIS: как это работает сейчас — словами заказчика; не описал — не додумывай.
4) GAP: почему текущее решение не устраивает.
5) TOBE: как должно работать.
6) HowToDemo: как заказчик будет принимать работу — где зайти, что нажать, что должен увидеть. Это заказчик согласует сам.
7) Глоссарий: расшифруй все сокращения и аббревиатуры (спроси, если не знаешь).
8) Эффект и рамки: что изменится и как поймём (сейчас → хотим), к какому сроку или событию и почему тогда, кто будет пользоваться (роли, примерно сколько). Спроси одним вопросом в форме по пробелам, только то, чего нет в словах и материалах; «не знаю» — допустимый ответ, не переспрашивай.

Правила:
- Пиши коротко и по-человечески, без канцелярита. Один ответ — 1–3 предложения плюс максимум 2–3 вопроса.
- Спрашивай только о пробелах: не переспрашивай сказанное, а фиксируй («Записала: …»).
- Сокращение без расшифровки — уточни расшифровку.
- Границы: можно один необязательный вопрос «Что точно не делаем сейчас или можно отложить?». «Не входит» — только то, что заказчик явно исключил; нерешённое и «уточняется» — открытый вопрос, а не граница.
- Первая форма вопросов — только «Укажите ваши ФИО и email» (если заказчик их ещё не назвал), «Краткое название инициативы» и необязательный «Каким вы видите решение этой проблемы?» — краткая заметка своими словами, без вариантов ответа; заказчик может его пропустить, не переспрашивай. Не спрашивай «Что нужно сделать…» — суть заказчик уже написал своими словами — и не спрашивай в первой форме «Как это работает сейчас и почему не устраивает» — это ты берёшь из материалов, а без материалов уточняешь следующим вопросом по пробелам.
- Уточняющие вопросы задавай инструментом ask_user_question: 2–4 вопроса за раз, с вариантами ответа, где они уместны; расшифровку каждого непонятного сокращения — отдельным вопросом. Заказчик может ответить в форме или просто текстом — принимай оба.
- Вложения и ссылки — это уже ответы, а не повод для допроса. Если в сообщении есть файлы (строки «[File …]») или ссылки — сразу, без вступления, вызови read_customer_materials: портал расшифрует голос и прочитает документы и страницы. Файловых инструментов у тебя нет, пути из «[File …]» не открывай. Дальше работай как аналитик на сверке:
  1) отметь для себя опорные факты с метками источников ([S1 02:15], [S2]) — в чат их не выписывай; не додумывай: чего нет, то неизвестно;
  2) составь черновик: суть, ASIS, GAP, TOBE, шаги приёмки, глоссарий;
  3) вопросы формой — только если без ответа нельзя составить шаги приёмки, не больше 3;
  4) покажи черновик одной карточкой confirm_acceptance_demo: asis, gap, tobe со ссылками на источники, шаги, а в unclear — чего нет в материалах и где они противоречат.
  Цель — первичный разбор за 1–2 минуты времени заказчика. Если источник не разобран (error), скажи об этом и спроси главное из него одним вопросом.
  Если read_customer_materials ответил «Ещё разбираются» — длинную запись не жди: сразу задай первую форму (ФИО и email, краткое название), разбор идёт, пока заказчик отвечает. После ответов снова вызови read_customer_materials и продолжай по шагам 1–4.
- Документы Confluence. Поиск по Confluence у тебя есть — это инструмент search_confluence; заказчик может называть его «MCP», «поиск по серверу», «по вики» или «по базе знаний». Набор инструментов может пополниться посреди диалога: если раньше ты отвечал, что искать не можешь, смотри на нынешний список инструментов, а не на свои прежние ответы, и на вопрос «появился ли доступ» — сразу ищи, а не пересказывай. Если заказчик просит найти документ, БФТ или страницу («найди регламент …», «найди согласованный БФТ»), называет документ по названию («по регламенту …», «у нас в вики есть страница …») или дал ссылку Confluence, которую read_customer_materials не прочитал (error), — сразу вызови search_confluence: запрос — 2–5 слов из названия. Покажи найденное коротким списком — название, пространство, ссылка — и спроси формой ask_user_question, какую страницу приложить к заявке (варианты — названия, плюс «Ничего из этого»). Выбранную приложи attach_confluence_page: она станет материалом заявки [S…] — опирайся на неё в черновике и требованиях с меткой источника, ссылку добавь в links submit_customer_request. Если поиск ответил, что недоступен, или ничего не нашёл — так и скажи заказчику одной фразой и попроси ссылку или файл; названия, ссылки и содержание документов не выдумывай. Ссылку Confluence из сообщения портал читает сам — через read_customer_materials, искать её не нужно.
- HowToDemo без материалов: спроси «Как вы будете проверять результат? Где зайдёте, что нажмёте, что должны увидеть» — без вариантов ответа, только свободный текст: проверка — это последовательность шагов, а не выбор одного из них. По ответу сам составь 2–7 шагов (по одному экрану на шаг, результат — проверяемый; в шаге — то, что заказчик видит, а не передачи между системами) и вызови confirm_acceptance_demo; каждую деталь, которую добавил ты сам (статус, уведомление, надпись, шаг), запиши в unclear вопросом «Верно ли, что…?»: заказчик увидит раскадровку по экранам и согласует её кнопкой. Если просит правки — исправь и покажи снова.
- «Согласую» на сценарии приёмки — это полное согласие заказчика с постановкой. Заказчик нажимает кнопку на карточке, поэтому в чате его «Согласую» сообщением не появится: результат confirm_acceptance_demo «Заказчик САМ нажал кнопку «Согласую»» и есть его подтверждение — не сомневайся в нём и не переспрашивай. ИТОГ не собирай и подтверждения больше не спрашивай. Ссылку на согласованный сценарий и «Уже готовлю БФТ-документ на проверку» портал показывает заказчику сам. Сразу, в этом же ходе и без реплик: submit_customer_request, затем create_bft_fast — без вопросов между ними. Чего не хватает или что противоречит (кто заказчик, расшифровки сокращений) — не спрашивай, а запиши в openQuestions обоих инструментов; в полях оставь то, что известно.
- create_bft_fast — первичные требования со слов заказчика: ты стенографист, ничего не придумываешь и не дораскрываешь. Заполни только сказанное им и его материалами: что хочет и зачем, требования (каждое — одна фраза с типом и дословной цитатой: «Заказчик: «…»», «Материалы [S1]: «…»» или «Сценарий приёмки (согласован): «…»»), кого он назвал и по каким вопросам (about — зона влияния, email и телефон — в contact), открытые вопросы. Если заказчик описал, как сейчас, — дословный кусок его реплики в want.asis и в asis требований, к которым он относится; не описал — asis пусто. Если назвал — эффект (metric: сейчас → хотим), срок (deadline), кто будет пользоваться (actors), расшифровки (glossary). outOfScope — только явно исключённое им, с цитатой; обязательные условия и договорённости — в agreements; нерешённое — только в openQuestions. Ответ «Каким вы видите решение» — гипотеза реализации: дословно в achievable.vision. В requirements — результат, который заказчик назвал нужным пользователю или бизнесу; kind «система» — наблюдаемое поведение системы, а не механизм (кто кого вызывает, какой поток читает). Названная заказчиком обязательная интеграция или система остаётся требованием, сформулированным как результат (данные оказываются в системе X). Условие, которое ещё предстоит согласовать, — в approvals и openQuestions. Единственное, что ты дораскрываешь, — achievable: из его ответа «Каким вы видите решение» (дословно в vision) составь краткий план реализации — какие команды участвуют, какие согласования нужны, что проработать, какие специалисты нужны (PO, SA, BA, BE, FE, DevOps). Не ответил — заполни план по сути запроса, vision не пиши. Как он примет работу, где проверять и чьи зоны затрагивает запрос, инструмент добавит сам — из согласованного сценария и Кортекса (памяти организации). Если инструмент вернул ошибки — исправь поля и вызови снова.
- Когда документ собран: короткая реплика — ссылка на документ из результата create_bft_fast (он уже открыт справа), ссылка на отслеживание заявки, открытые вопросы списком — и в этом же ходе сразу confirm_bft_fast. Не пиши «нажмите „Да, согласен“»: кнопки «Да, согласен» / «Есть замечания» покажет форма.
- Правки документа после сборки: заказчик пишет или надиктовывает, что поменять, отвечает замечаниями в форме confirm_bft_fast или присылает «Замечания к документу БФТ:» со страницы документа, — исправь поля и снова вызови create_bft_fast, затем confirm_bft_fast (submit_customer_request повторно не вызывай).
- Сообщение «✅ Да, согласен с документом БФТ.» отправляет кнопка «Да, согласен» на странице документа — согласование уже записано в заявку, и портал сам начал собирать полный БФТ по корпоративному канону. Поблагодари одной фразой и скажи: полный БФТ собирается справа, обычно от минуты до пяти, его можно будет скачать в Word, PDF и Markdown; инструменты не вызывай.
- Каждый ход, в котором ждёшь ответа заказчика, заканчивай формой — он только отвечает на прямой вопрос, а не ищет его в тексте: уточнения и да/нет — ask_user_question с вариантами (да/нет — «Да» и «Нет, поправить»), сценарий приёмки — confirm_acceptance_demo, документ — confirm_bft_fast. Вопрос только текстом в конце реплики не задавай. Без формы заканчивай ход, только когда ничего от заказчика не ждёшь (документ согласован, идёт сборка).
- Сообщения «📌 …» (заявка зарегистрирована, сценарий согласован) добавляет портал, а не заказчик: на них не отвечай; номер заявки упомяни в итоговой сводке.
- Сроки и бюджет не обещай — это решает PO, но желаемый срок заказчика спроси и запиши. Не уходи в технические детали реализации.`

interface ConnectionLike {
  rpc: {
    handle: (channel: string, handler: (endpoint: string, payload: unknown) => Promise<unknown>) => unknown
  }
  fetch?: { register: (route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }) => () => void }
}

/** Служба плагина data-sources (Jira/Confluence через шлюз источников, только чтение, ADR-0015). */
interface DataSourcesLike extends Partial<Omit<ConfluenceSource, 'available'>> {
  available(): Promise<boolean>
  recon(queries: string[], options?: {
    top?: number; read?: number; deadlineMs?: number
    /** Предмет заявки: фильтр ранжирования, второй шаг, синонимы систем. */
    subject?: ReconSubject
    /** Детерминированное ядро запросов: по нему считаются очки ранга (порядок карты не зависит от модели). */
    rankBy?: string[]
    /** Триаж находок моделью портала (вердикт и факты с цитатами). */
    triage?: (items: TriageItem[], signal: AbortSignal) => Promise<TriageVerdict[]>
  }): Promise<{ markdown: string; findings: unknown[]; queries: string[]; errors: string[]; source: string; triaged?: boolean; ms?: number } | undefined>
}

/** Служба модели dsh по умолчанию (dsh-agent-default-model). */
interface DefaultModelLike {
  currentSelection(): ModelRoute
  saveSelection(next: ModelRoute): Promise<void>
}

/**
 * Модель чата по профилю — то же правило, что в customer.patch.yml
 * (agent-default-model): PORTAL_PROVIDER/MODEL, иначе первый ключ окружения.
 */
function profileDefaultModel(): ModelRoute {
  const env = process.env
  const provider = env.PORTAL_PROVIDER || (env.ANTHROPIC_API_KEY ? 'anthropic' : env.ZAI_CODING_API_KEY ? 'zai-coding' : env.REQUESTY_API_KEY ? 'requesty' : 'zai')
  const model = env.PORTAL_MODEL || (env.ANTHROPIC_API_KEY ? 'claude-haiku-5-5' : env.ZAI_CODING_API_KEY ? 'glm-5' : env.REQUESTY_API_KEY ? 'anthropic/claude-haiku-5-5' : 'glm-5-turbo')
  return { provider, model }
}

/** Внутренности HostConnectionService dsh 0.2, нужные для передачи вызова шлюзу. */
interface GatewayInternals {
  interceptors?: Map<string, { fetchHandler: { fetch(request: Request, peer: unknown): Promise<Response> } }>
  browserPeer?: unknown
}

/** Имя источника из строки «Источник: X · дата» карты находок (findingsMarkdown data-sources). */
function sourcesName(markdown: string): string {
  return /^Источник:\s*([^·\n]+?)\s*(?:·|$)/m.exec(markdown)?.[1] ?? 'Jira/Confluence'
}

/**
 * «заявка #N» для хвоста полного БФТ (план C8): ссылкой на страницу заявки в
 * портале (PORTAL_PUBLIC_URL), не на трекер; адреса нет или он loopback —
 * без ссылки, с предупреждением в журнале.
 */
function deepRequestRef(taskId: number, sessionId: string): string {
  const url = publicPortalUrl(fastPagePath(sessionId))
  if (!url) console.error(`[customer-form] PORTAL_PUBLIC_URL не задан или loopback — в полном БФТ заявки #${taskId} ссылки на портал не будет`)
  return requestRef(`заявка #${taskId}`, url)
}

/** Публичные адреса, которые указывают на эту же машину: снаружи такие ссылки не откроются. */
function warnLoopbackUrls(env: NodeJS.ProcessEnv = process.env): void {
  const portal = (env.PORTAL_PUBLIC_URL ?? '').trim()
  if (!portal || isLoopbackUrl(portal)) {
    console.error(`[customer-form] ⚠ PORTAL_PUBLIC_URL ${portal ? `указывает на loopback (${portal})` : 'не задан'}: ссылки на страницу заявки в документы не попадут. Для публичного сервиса это обязательная настройка.`)
  }
  const tracker = env.TRACKER_PUBLIC_URL
  if (tracker === undefined || (tracker.trim() && isLoopbackUrl(tracker.trim()))) {
    console.error(`[customer-form] ⚠ TRACKER_PUBLIC_URL ${tracker === undefined ? 'не задан (по умолчанию 127.0.0.1)' : `указывает на loopback (${tracker.trim()})`}: ссылки на заявку в трекере снаружи не откроются. Трекер не публичный — задайте пустое значение.`)
  }
}

export function apply(ctx: HarnessContext): void {
  warnLoopbackUrls()
  // Абсолютный путь workspace заказчика: знает только узел (DSH_HOME).
  const workspacePath = `${process.env.DSH_HOME ?? '/data'}/Customer-requests`
  // workspaces.create требует существующий каталог (realpath): создаём заранее.
  mkdir(workspacePath, { recursive: true }).catch(() => undefined)

  const backlog = sharedBacklog()
  // «Файлы рабочей области»: папка на каждую заявку (workspace-mirror.ts) — и для
  // заявок, заведённых до зеркала.
  void (async () => {
    const tickets = await Promise.all((await backlog.sessionIds()).map(async (sessionId) => ({ sessionId, ticket: await backlog.find(sessionId) })))
    await mirrorAll(tickets.flatMap(({ sessionId, ticket }) => (ticket ? [{ sessionId, taskId: ticket.taskId }] : [])))
  })().catch((e) => console.error('[customer-form] папки заявок в workspace не собраны:', e))
  // Русские названия чатов (session-title.ts): служба dsh-session-title — инструментам заявки.
  ctx.inject(['sessionTitle'], (scoped: HarnessContext) => {
    const service = scoped.get('sessionTitle') as Parameters<typeof useSessionTitles>[0]
    scoped.effect(() => {
      useSessionTitles(service)
      return () => useSessionTitles(undefined)
    }, 'customer-form: названия чатов')
  })
  const materials = sharedMaterials()
  const voice = new VoiceContext(materials)

  // Модели портала (ADR-0012, models.ts): выбор администратора в «Настройках →
  // Портал» хранится в томе. Чат — модель dsh по умолчанию; полный БФТ —
  // PORTAL_DEEP_PROVIDER/MODEL → выбор администратора → модель чата.
  let portalModels: PortalModels = {}
  const modelsLoaded = readPortalModels().then((stored) => { portalModels = stored })
  let defaults: DefaultModelLike | undefined
  let deepRuntime: { llm: LlmLike; route(): DeepRoute } | undefined
  /** Модель чата dsh по умолчанию → `target` (выбор администратора или профиль). */
  const applyChatModel = async (target: ModelRoute): Promise<void> => {
    if (!defaults || sameRoute(defaults.currentSelection(), target)) return
    await defaults.saveSelection({ provider: target.provider, model: target.model })
  }
  ctx.inject(['llm', 'agentDefaultModel'], (scoped: HarnessContext) => {
    const llm = scoped.get('llm') as LlmLike
    const service = scoped.get('agentDefaultModel') as DefaultModelLike
    scoped.effect(() => {
      defaults = service
      deepRuntime = {
        llm,
        route: () => {
          const fallback = portalModels.deep ?? service.currentSelection()
          return { provider: process.env.PORTAL_DEEP_PROVIDER || fallback.provider, model: process.env.PORTAL_DEEP_MODEL || fallback.model }
        },
      }
      // Пересборка засевает профиль заново — выбор администратора возвращаем при старте.
      void modelsLoaded.then(() => (portalModels.chat ? applyChatModel(portalModels.chat) : undefined))
        .catch((e) => console.error('[customer-form] модель чата не применилась:', e))
      return () => { defaults = undefined; deepRuntime = undefined }
    }, 'customer-form: модели портала')
  })
  // Источники данных (плагин data-sources): Jira/Confluence перед полным БФТ.
  // Плагина нет или источник не подключён — полный БФТ собирается как раньше.
  let dataSources: DataSourcesLike | undefined
  ctx.inject(['dataSources'], (scoped: HarnessContext) => {
    const service = scoped.get('dataSources') as DataSourcesLike
    scoped.effect(() => {
      dataSources = service
      // Чат заказчика: поиск и чтение страниц Confluence тем же шлюзом (ADR-0019).
      const { searchConfluence, readConfluencePage } = service
      if (typeof searchConfluence === 'function' && typeof readConfluencePage === 'function') {
        materials.confluence = {
          available: () => service.available(),
          searchConfluence: (query, limit) => searchConfluence.call(service, query, limit),
          readConfluencePage: (pageId) => readConfluencePage.call(service, pageId),
        }
      }
      return () => { dataSources = undefined; materials.confluence = undefined }
    }, 'customer-form: источники данных')
  })
  /**
   * Разведка по Jira/Confluence: карта находок рядом с документом и что она дала
   * (план C8, строка status deep): fresh — свежая карта; previous — источник лёг,
   * взята прошлая; none — опрошены, находок нет; unavailable — не подключены или сбой.
   */
  const sourcesMap = async (fastMdPath: string, mapPath: string, runtime: { llm: LlmLike; route(): DeepRoute }): Promise<{ markdown: string; status: SourcesStatus }> => {
    const unavailable = { markdown: '', status: { mode: 'unavailable' as const, source: '', count: 0 } }
    const sources = dataSources
    // E2E (флаг e2e-hooks ставит harness/e2e-customer.sh): тесты не ходят в настоящие Jira/Confluence.
    if (existsSync(join(process.env.DSH_HOME ?? '/data', 'e2e-hooks'))) return unavailable
    if (!sources || !(await sources.available().catch(() => false))) return unavailable
    try {
      const fastMd = await readFile(fastMdPath, 'utf8')
      const queries = await searchQueries(runtime.llm, runtime.route(), fastMd, AbortSignal.timeout(60_000))
      if (!queries.length) return unavailable
      // Бюджет разведки с триажем — 80 с: вместе с запросами укладываемся в 90 с (метрика recon_ms).
      const recon = await sources.recon(queries, {
        top: 10, read: 7, deadlineMs: 80_000, subject: reconSubject(fastMd), rankBy: fixQueries([], reconSubject(fastMd)),
        triage: (items, signal) => triageFindings(runtime.llm, runtime.route(), fastMd, items, AbortSignal.any([signal, AbortSignal.timeout(45_000)])),
      })
      if (!recon) return unavailable
      if (recon.errors.length) console.error('[customer-form] источники данных ответили с ошибками:', recon.errors.slice(0, 5))
      // Источник лёг целиком (ничего не нашлось, одни ошибки): прошлую карту находок не затираем —
      // при «Собрать заново» документ собирается по ней, а не без источников.
      if (recon.findings.length === 0 && recon.errors.length > 0) {
        const previous = await readFile(mapPath, 'utf8').catch(() => '')
        console.error(`[customer-form] источники данных: ${recon.source} недоступен${previous ? ' — беру прошлую карту находок' : ''}`)
        return previous
          ? { markdown: previous, status: { mode: 'previous', source: recon.source, count: parseSources(previous).length } }
          : { markdown: '', status: { mode: 'unavailable', source: recon.source, count: 0 } }
      }
      await writeFile(mapPath, recon.markdown, 'utf8')
      console.error(`[customer-form] источники данных: ${recon.source}, запросы ${JSON.stringify(recon.queries)}, находок ${recon.findings.length}${recon.triaged ? ', триаж прошёл' : ', без триажа'}${recon.ms !== undefined ? `, ${recon.ms} мс` : ''}`)
      return { markdown: recon.markdown, status: { mode: recon.findings.length ? 'fresh' : 'none', source: recon.source, count: recon.findings.length } }
    } catch (e) {
      console.error('[customer-form] разведка по источникам данных не удалась:', e)
      return unavailable
    }
  }
  type DeepRuntime = { llm: LlmLike; route(): DeepRoute }
  /**
   * Разведка и сборка полного БФТ по документу fast — общий путь заявки и
   * прогона качества (qualityRun): тот же контекст модели, те же проверки.
   * recon: live — разведка по Jira/Confluence; fixture — готовая карта находок.
   */
  const runDeep = async (fast: FastFiles, slug: string, request: string, runtime: DeepRuntime, startedAt: string,
    recon: { mode: 'live' } | { mode: 'fixture'; markdown: string }) => {
    const context = await readFile(fast.contextMap, 'utf8').catch(() => '')
    const sourcesPath = join(fast.dir, 'sources.md')
    const reconStart = Date.now()
    let sources = ''
    let sourcesStatus: SourcesStatus
    if (recon.mode === 'live') {
      const found = await sourcesMap(fast.md, sourcesPath, runtime)
      sources = found.markdown
      sourcesStatus = found.status
    } else {
      sources = recon.markdown
      if (sources) await writeFile(sourcesPath, sources, 'utf8')
      const count = parseSources(sources).length
      sourcesStatus = sources ? { mode: count ? 'fresh' : 'none', source: sourcesName(sources), count } : { mode: 'unavailable', source: '', count: 0 }
    }
    const reconMs = recon.mode === 'live' ? Date.now() - reconStart : undefined
    // Страницы Confluence, которые заказчик сам приложил в чате (ADR-0019), — первым разделом карты.
    const customerPages = await readCustomerPages(fast.dir)
    if (customerPages.length) {
      sources = withCustomerPages(sources, customerPages)
      await writeFile(sourcesPath, sources, 'utf8')
      if (sourcesStatus.mode === 'unavailable' || sourcesStatus.mode === 'none') {
        sourcesStatus = { mode: 'fresh', source: sourcesStatus.source || 'Confluence (приложено заказчиком)', count: parseSources(sources).length }
      }
    }
    // Слова заказчика (план C1) — первым блоком: primary.json и intake.json рядом с документом;
    // старая заявка без intake.json — только primary.json.
    const primary = await readFile(fast.primary, 'utf8').then((t) => JSON.parse(t) as PrimaryDoc, () => undefined)
    const words = customerWordsContext(primary, await readIntake(fast))
    // Ответы из формы вопросов (ADR-0018) — рядом со словами заказчика: они закрывают свои [УТОЧНИТЬ].
    const answers = answersContext(await formOfRequest(fast.dir))
    const state = await buildDeep({
      startedAt, llm: runtime.llm, route: runtime.route(), skillsPath: SKILLS_PATH, fast, slug, request, sources: sourcesStatus,
      context: [
        words,
        answers,
        context ? `Карта контекста (память организации — указатель, не фактбаза):\n${context}` : '',
        sources ? `Корпоративные источники (Jira/Confluence — указатель со ссылками, не фактбаза):\n${sourcesForModel(sources)}` : '',
      ].filter(Boolean).join('\n\n'),
      sourcesMd: sources, contextMd: context, ...(reconMs !== undefined ? { reconMs } : {}),
    })
    return { state, sources, sourcesPath, context, reconMs }
  }
  const deepRunning = new Set<string>()
  /** Собрать полный БФТ в фоне; повторный вызов во время сборки ничего не делает. */
  const startDeep = (ticket: Ticket, sessionId: string): boolean => {
    const slug = fastSlug(ticket.taskId)
    if (deepRunning.has(slug)) return true
    if (!deepRuntime) {
      console.error('[customer-form] bft-deep: модель портала недоступна (ctx.llm)')
      return false
    }
    const runtime = deepRuntime
    const fast = fastFiles(FAST_ROOT, slug)
    deepRunning.add(slug)
    void (async () => {
      // «Собирается» — сразу: разведка по источникам идёт до сборки, заказчик видит экран ожидания.
      const startedAt = new Date().toISOString()
      await saveDeepState(deepFiles(fast, slug), { stage: 'building', startedAt })
      void mirrorRequest(ticket.taskId, sessionId)
      const { state, sources, sourcesPath } = await runDeep(fast, slug, deepRequestRef(ticket.taskId, sessionId), runtime, startedAt, { mode: 'live' })
      // Полный БФТ и карта источников — в папку заявки, не дожидаясь трекера.
      void mirrorRequest(ticket.taskId, sessionId)
      await reportDeep(backlog, ticket, slug, deepFiles(fast, slug), state, sources ? sourcesPath : undefined)
    })().catch((e) => console.error('[customer-form] bft-deep упал:', e)).finally(() => deepRunning.delete(slug))
    return true
  }
  /**
   * Форма вопросов по БФТ (ADR-0018). Запись формы — под замком по id: ответы
   * из формы и правки PO могут прийти одновременно.
   */
  const formLocks = new Map<string, Promise<unknown>>()
  const withFormLock = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const run = (formLocks.get(key) ?? Promise.resolve()).then(fn, fn)
    formLocks.set(key, run.catch(() => undefined))
    return run
  }
  const formGate = new SubmitGate()
  /** Пауза после последнего ответа до пересборки БФТ: отвечают пачкой — собираем один раз. */
  const FORM_REBUILD_MS = Number(process.env.FORM_REBUILD_MS ?? 120_000)
  const rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** Ссылка формы для PO: короткий открытый адрес за nginx (BFT_FORM_PUBLIC=1) или маршрут портала. */
  const formUrl = (id: string): string => {
    const pretty = process.env.BFT_FORM_PUBLIC === '1' ? publicPortalUrl(`/form?id=${id}`) : undefined
    return pretty ?? portalUrl(`/api/customer-form.form?id=${encodeURIComponent(id)}`)
  }
  /** Готовый полный БФТ заявки — то, из чего форма берёт вопросы. */
  const deepDocOf = async (slug: string) => {
    const files = fastFiles(FAST_ROOT, slug)
    const deep = await readDeepState(deepFiles(files, slug))
    const md = deep?.stage === 'ready' ? await readFile(deepFiles(files, slug).md, 'utf8').catch(() => '') : ''
    const primary = await readFile(files.primary, 'utf8').then((t) => JSON.parse(t) as PrimaryDoc, () => undefined)
    const people: FormPerson[] = primary?.args.people ?? []
    const title = formTitle(/^# (.+)$/m.exec(md)?.[1] ?? slug)
    return { files, deep, md, people, title }
  }
  type DeepDoc = Awaited<ReturnType<typeof deepDocOf>>
  /** Свести форму с текущим документом (готовый БФТ пересобран — новые вопросы). */
  const syncForm = (form: BftForm, doc: DeepDoc): boolean =>
    doc.deep?.stage === 'ready' && doc.md && doc.deep.finishedAt ? refreshForm(form, { md: doc.md, deepAt: doc.deep.finishedAt, people: doc.people }) : false
  /** Форма заявки; нет — новая (сохраняется только при правке или выдаче ссылки). */
  const formFor = async (slug: string, sessionId: string, doc: DeepDoc): Promise<{ form: BftForm; stored: boolean }> => {
    const stored = await formOfRequest(doc.files.dir)
    const form = stored ?? newForm({ slug, sessionId, title: doc.title })
    if (!stored || form.title === slug) form.title = doc.title
    return { form, stored: !!stored }
  }
  const storeForm = async (form: BftForm, doc: DeepDoc) => {
    await saveForm(form)
    await linkForm(doc.files.dir, form.id)
  }
  const removedOf = (form: BftForm): FormQuestion[] => {
    const all = new Map<string, FormQuestion>()
    for (const q of [...form.versions.flatMap((v) => v.questions), ...form.edits.added]) all.set(q.qid, q)
    return form.edits.removed.map((qid) => all.get(qid)).filter((q): q is FormQuestion => !!q)
  }
  /** Слой формы для страницы полного БФТ в портале. */
  const deepFormLayer = async (slug: string, sessionId: string): Promise<DeepFormLayer | undefined> => {
    const doc = await deepDocOf(slug)
    return withFormLock(slug, async () => {
      const { form, stored } = await formFor(slug, sessionId, doc)
      if (syncForm(form, doc) && stored) await saveForm(form)
      const version = latestVersion(form)
      if (!version) return undefined
      return {
        sessionId, questions: version.questions, answers: form.answers, removed: removedOf(form), version: version.v,
        ...(form.publishedAt && !form.revokedAt ? { link: formUrl(form.id) } : {}),
        api: { create: siblingHref(FORM_CREATE), revoke: siblingHref(FORM_REVOKE), edit: siblingHref(FORM_EDIT) },
      }
    })
  }
  /** Ответы пришли — пересобрать полный БФТ через паузу; идёт сборка — дождаться и собрать ещё раз. */
  const scheduleRebuild = (form: BftForm) => {
    clearTimeout(rebuildTimers.get(form.slug))
    rebuildTimers.set(form.slug, setTimeout(() => {
      rebuildTimers.delete(form.slug)
      void (async () => {
        if (deepRunning.has(form.slug)) return scheduleRebuild(form)
        const fresh = await readForm(form.id)
        const doc = await deepDocOf(form.slug)
        const last = fresh?.lastSubmitAt
        // Ответы уже учтены сборкой, начатой после них, — повторять не нужно.
        if (!last || (doc.deep?.startedAt && doc.deep.startedAt > last)) return
        const ticket = await backlog.find(form.sessionId).catch(() => undefined)
        if (!ticket) return console.error(`[customer-form] форма ${form.slug}: заявка не найдена — БФТ не пересобран`)
        console.error(`[customer-form] форма ${form.slug}: ответы — пересобираю полный БФТ`)
        startDeep(ticket, form.sessionId)
      })().catch((e) => console.error('[customer-form] пересборка по ответам формы упала:', e))
    }, FORM_REBUILD_MS))
  }
  // Пересборка по ответам и после рестарта: форма с ответами новее сборки.
  void (async () => {
    const root = join(process.env.DSH_HOME ?? '/data', 'bft-forms')
    for (const name of await readdir(root).catch(() => [] as string[])) {
      const form = await readForm(name.replace(/\.json$/, ''))
      if (!form || form.revokedAt || !form.lastSubmitAt) continue
      const deep = await readDeepState(deepFiles(fastFiles(FAST_ROOT, form.slug), form.slug))
      if (deep?.stage !== 'building' && (!deep?.startedAt || deep.startedAt < form.lastSubmitAt)) scheduleRebuild(form)
    }
  })().catch(() => undefined)

  // Тот же запуск — согласованию из формы чата (confirm_bft_fast, fast-approval.ts).
  ctx.effect(() => {
    portalHooks.startDeep = startDeep
    return () => { portalHooks.startDeep = undefined }
  }, 'customer-form: полный БФТ по согласованию из чата')

  /**
   * Прогон качества (план качества, C0): фикстура <DSH_HOME>/quality/<name>/
   * (primary.json, необязательно sources.md, context_map.md, intake.json) →
   * fast из primary.json тем же кодом, что в чате → разведка (live) или карта
   * находок фикстуры → полный БФТ настоящей моделью портала → out/: fast.md,
   * sources.md, <name>.md, deep.json, metrics.json.
   */
  const qualityRunning = new Set<string>()
  const qualityRun = async (name: string, recon: 'fixture' | 'live', runtime: DeepRuntime, date?: string) => {
    const dir = join(QUALITY_ROOT, name)
    const doc = JSON.parse(await readFile(join(dir, 'primary.json'), 'utf8')) as PrimaryDoc
    const work = join(dir, 'work')
    const out = join(dir, 'out')
    await rm(work, { recursive: true, force: true })
    await rm(out, { recursive: true, force: true })
    console.error(`[customer-form] качество ${name}: сборка fast из primary.json`)
    const built = await buildFastFromPrimary(doc, { slug: name, source: `фикстура качества ${name}`, ...(date ? { date } : {}) }, work)
    if (!built.ok) throw new Error(`fast не собран: ${built.errors}`)
    const fast = built.files
    await writeFile(fast.primary, JSON.stringify(doc), 'utf8')
    for (const file of ['context_map.md', 'intake.json', 'approval.json']) {
      if (existsSync(join(dir, file))) await copyFile(join(dir, file), join(fast.dir, file))
    }
    const fixtureSources = recon === 'fixture' ? await readFile(join(dir, 'sources.md'), 'utf8').catch(() => '') : ''
    console.error(`[customer-form] качество ${name}: разведка ${recon === 'live' ? 'по источникам' : 'из фикстуры'}, затем полный БФТ (${runtime.route().provider}/${runtime.route().model})`)
    const startedAt = new Date().toISOString()
    const { state, sources, context, reconMs } = await runDeep(fast, name, `фикстура качества ${name}`, runtime, startedAt,
      recon === 'live' ? { mode: 'live' } : { mode: 'fixture', markdown: fixtureSources })
    console.error(`[customer-form] качество ${name}: ${state.stage}, попыток ${state.attempts ?? '—'}${state.error ? ` — ${state.error.slice(0, 300)}` : ''}`)
    const deep = deepFiles(fast, name)
    const deepMd = await readFile(deep.md, 'utf8').catch(() => '')
    const intake = await readIntake(fast)
    const golden = await readFile(join(SKILLS_PATH, 'bft-deep-swarm/examples/golden_deep_document.md'), 'utf8').then(goldenCanon, () => undefined)
    const report = qualityMetrics({
      doc: deepMd, fastMd: await readFile(fast.md, 'utf8'), sourcesMd: sources, contextMd: context, primary: doc, ...(golden ? { golden } : {}),
      ...(intake ? { intake } : {}), ...(state.quality ? { quality: state.quality } : {}), stage: state.stage, ...(reconMs !== undefined ? { reconMs } : {}),
    })
    const metrics = {
      fixture: name, recon, route: runtime.route(), startedAt, finishedAt: state.finishedAt ?? null, stage: state.stage,
      attempts: state.attempts ?? null, error: state.error ?? null, ...report,
    }
    await mkdir(out, { recursive: true })
    await copyFile(fast.md, join(out, 'fast.md'))
    await writeFile(join(out, 'sources.md'), sources, 'utf8')
    if (deepMd) await writeFile(join(out, `${name}.md`), deepMd, 'utf8')
    await copyFile(deep.state, join(out, 'deep.json')).catch(() => undefined)
    await writeFile(join(out, 'primary.json'), JSON.stringify(doc), 'utf8')
    await writeFile(join(out, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8')
    console.error(`[customer-form] качество ${name}: готово → ${out}`)
    return { fixture: name, stage: state.stage, attempts: state.attempts ?? null, out, metrics: report.metrics }
  }



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
      // «📌 …» — служебные пузыри портала (заявка, сценарий согласован): не обращение заказчика.
      if (textOf(message).trimStart().startsWith('📌')) return
      const sessionId = agent.session.id
      voice.remember(agent)
      const found = collectMaterials(materials, attachments, sessionId, message)
      void (async () => {
        try {
          const known = await backlog.find(sessionId)
          const ticket = await backlog.ensure(sessionId, textOf(message))
          if (!known && !linked.has(sessionId)) {
            linked.add(sessionId)
            // Чат — «Заявка #N — первые слова обращения»; папка заявки — в «Файлах рабочей области».
            titleSession(agent.session, ticket.taskId, textOf(message))
            void mirrorRequest(ticket.taskId, sessionId, textOf(message))
            // Пузырь инъекции dsh рисует сразу (даже пока модель недоступна) —
            // это и есть ссылка заказчику; модель видит его как контекст.
            agent.inject({
              id: randomUUID(),
              role: 'user',
              source: portalNoteSource('ticket'),
              content: [{ type: 'text', text: `📌 ${ticketRegistered(ticket)}${materialsLine(found)}` }],
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

    // Модели портала (ADR-0012): раздел «Портал» в «Настройках». Читать может
    // любой (раздел видит только администратор), менять — только администратор.
    scoped.effect(() => register({
      path: MODELS_ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        await modelsLoaded
        if (request.method === 'POST') {
          if (!isAdmin(request)) return Response.json({ error: 'Только администратор портала' }, { status: 403 })
          let body: unknown
          try { body = await request.json() } catch { return Response.json({ error: 'тело не JSON' }, { status: 400 }) }
          const before = portalModels.chat
          portalModels = mergePortalModels(portalModels, body)
          await writePortalModels(portalModels)
          try {
            // Модель чата трогаем, только если её выбор изменился: сброс — назад к профилю.
            if (!sameRoute(before, portalModels.chat) && (before || portalModels.chat)) {
              await applyChatModel(portalModels.chat ?? profileDefaultModel())
            }
          } catch (e) {
            console.error('[customer-form] модель чата не сохранилась:', e)
            // Не применилась — выбор не запоминаем, иначе он «включится» при следующем старте.
            portalModels = before ? { ...portalModels, chat: before } : (({ chat: _drop, ...rest }) => rest)(portalModels)
            await writePortalModels(portalModels)
            const message = e instanceof Error ? e.message : String(e)
            const reason = /overridden by a home patch or command-line overlay/.test(message)
              ? 'модель чата задана оверлеем /data/override.patch.yml — уберите его или поменяйте модель там'
              : message
            return Response.json({ error: `Модель чата не применилась: ${reason}` }, { status: 409 })
          }
        }
        const chat = defaults?.currentSelection()
        const deepEnv = process.env.PORTAL_DEEP_PROVIDER && process.env.PORTAL_DEEP_MODEL
          ? { provider: process.env.PORTAL_DEEP_PROVIDER, model: process.env.PORTAL_DEEP_MODEL } : undefined
        return Response.json({
          // chat — модель, которая работает сейчас (её может задать и оверлей);
          // chatChoice — выбор администратора (null — по профилю).
          chat: chat ? { provider: chat.provider, model: chat.model } : null,
          chatChoice: portalModels.chat ?? null,
          profile: profileDefaultModel(),
          deep: portalModels.deep ?? null,
          deepEnv: deepEnv ?? null,
        }, { headers: { 'cache-control': 'no-store' } })
      },
    }), 'customer-form: модели портала')

    // Администратор портала (ADR-0012): вход за паролем и защита записи настроек.
    scoped.effect(() => register({
      path: ADMIN_PAGE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: adminPage,
    }), 'customer-form: администратор')
    scoped.effect(() => register({
      path: ADMIN_STATUS,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => Response.json({ admin: isAdmin(request), configured: !!process.env.ADMIN_PASSWORD?.trim() }, { headers: { 'cache-control': 'no-store' } }),
    }), 'customer-form: статус администратора')
    // Точный маршрут проверяется раньше перехватчика шлюза /api: администратора
    // передаём шлюзу как есть, остальным — отказ «только администратор».
    const gateway = connection as unknown as GatewayInternals
    for (const endpoint of ADMIN_ONLY_ENDPOINTS) {
      scoped.effect(() => register({
        path: `/api/${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: Request) => {
          if (!isAdmin(request)) return adminOnlyResponse(request, endpoint)
          const forward = gateway.interceptors?.get('/api')?.fetchHandler
          const peer = gateway.browserPeer
          if (!forward || !peer) {
            console.error('[customer-form] шлюз /api недоступен для передачи', endpoint)
            return new Response('gateway unavailable', { status: 503 })
          }
          return forward.fetch(request, peer)
        },
      }), `customer-form: только администратор ${endpoint}`)
    }
    // Чтение файлов рабочей области (dsh-api-workspace-files) по замыслу dsh
    // не ограничено её корнем: read/readBytes/stat примут /proc/self/environ.
    // Не-администратору — только пути внутри рабочей области портала.
    const insideWorkspace = (value: string): boolean => {
      if (!value || value.includes('\0') || /^[a-z]+:/i.test(value)) return false
      const root = posix.normalize(workspacePath).replace(/\/+$/, '')
      const target = posix.normalize(value.startsWith('/') ? value : posix.join(root, value))
      return target === root || target.startsWith(`${root}/`)
    }
    const pathsIn = (value: unknown, out: string[] = []): string[] => {
      if (Array.isArray(value)) value.forEach((item) => pathsIn(item, out))
      else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) {
          if ((key === 'path' || key === 'baseFile') && typeof item === 'string') out.push(item)
          else pathsIn(item, out)
        }
      }
      return out
    }
    for (const endpoint of ['workspaceFiles/read', 'workspaceFiles/readBytes', 'workspaceFiles/stat']) {
      scoped.effect(() => register({
        path: `/api/${endpoint}`,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: Request) => {
          const forward = gateway.interceptors?.get('/api')?.fetchHandler
          const peer = gateway.browserPeer
          if (!forward || !peer) return new Response('gateway unavailable', { status: 503 })
          if (!isAdmin(request)) {
            let body: { rpcId?: string; payload?: unknown } = {}
            try { body = (await request.clone().json()) as typeof body } catch { /* разберёт шлюз */ }
            const paths = pathsIn(body.payload)
            if (!paths.length || !paths.every(insideWorkspace)) {
              console.error(`[customer-form] ${endpoint}: путь вне рабочей области отклонён`)
              return Response.json({ type: 'server-response', rpcId: body.rpcId ?? 'r', result: { ok: false, error: { code: 'portal/outside-workspace', message: 'Файл вне рабочей области портала', details: {} } } })
            }
          }
          return forward.fetch(request, peer)
        },
      }), `customer-form: рабочая область ${endpoint}`)
    }
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
        const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
        const slug = ticket ? fastSlug(ticket.taskId) : ''
        const files = fastFiles(FAST_ROOT, slug)
        // Идёт сборка (rev16) — экран ожидания; он сам перезагрузится в документ.
        const progress = fastProgress.get(sessionId)
        if (progress && await stillBuilding(progress, files)) {
          return new Response(waitingPage(sessionId, progress, siblingHref('/api/customer-form.bftFastStatus')), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
        }
        const html = ticket ? await readFile(files.html, 'utf8').catch(() => undefined) : undefined
        if (!html) {
          return new Response('<!doctype html><meta charset="utf-8"><p style="font:14px sans-serif;color:#888;padding:16px">Быстрая версия БФТ ещё не собрана.</p>',
            { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } })
        }
        const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
        // ?full=1 — канонический bft-fast навыка как есть (он же в заявке).
        const params = new URL(request.url).searchParams
        if (params.has('full')) return new Response(html, { headers })
        // Первичные требования согласованы — та же вкладка показывает полный БФТ (ADR-0012);
        // ?view=fast — вернуться к первичным требованиям.
        const fastApproved = (await fastState(files))?.approvedAt
        const deep = fastApproved ? await readDeepState(deepFiles(files, slug)) : undefined
        if (deep && params.get('view') !== 'fast') {
          const fastUrl = siblingHref(`${fastPagePath(sessionId)}&view=fast`)
          if (deep.stage === 'building') return new Response(waitingPage(sessionId, { stage: 'building', startedAt: deep.startedAt }, siblingHref('/api/customer-form.bftDeepStatus'), 'deep'), { headers })
          if (deep.stage === 'failed') return new Response(deepFailedPage(sessionId, deep.error ?? 'неизвестная ошибка', siblingHref('/api/customer-form.bftDeepRetry'), fastUrl), { headers })
          const deepHtml = await readFile(deepFiles(files, slug).html, 'utf8').catch(() => undefined)
          if (deepHtml) {
            const layer = await deepFormLayer(slug, sessionId).catch((e) => { console.error('[customer-form] слой формы вопросов:', e); return undefined })
            return new Response(customerDeepPage(deepHtml, sessionId, fastUrl, deep.questions, layer), { headers })
          }
        }
        // Заказчику (rev21) — тот же документ: How to demo таблицей, зоны и контакты, без полей для PO.
        const state = await fastState(files)
        const doc = await readFile(files.primary, 'utf8').then((s) => JSON.parse(s) as PrimaryDoc).catch(() => undefined)
        const demo = sharedDemos().get(sessionId)?.demo
        return new Response(customerFastPage(html, {
          sessionId, slug, approveUrl: siblingHref('/api/customer-form.bftFastApprove'),
          ...(state?.approvedAt ? { approvedAt: state.approvedAt } : {}),
          ...(demo ? { demo } : {}),
          ...(doc ? { people: doc.args.people ?? [], ...(doc.brief ? { brief: doc.brief } : {}) } : {}),
        }), { headers })
      },
    }), 'customer-form: /api/customer-form.bftFast')

    // Форма вопросов по БФТ (ADR-0018). Открытые маршруты — по ссылке-ключу (UUID формы):
    // nginx отдаёт их без Authentik как /bft/form, /bft/form/answer, /bft/preview.
    const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...PUBLIC_HEADERS } })
    /** Форма по ключу, сведённая с текущим БФТ; нет, не выдана или отозвана — причина. */
    const openForm = async (id: string): Promise<{ form: BftForm; doc: DeepDoc } | { gone: 'missing' | 'revoked' }> => {
      const found = isFormId(id) ? await readForm(id) : undefined
      if (!found || !found.publishedAt) return { gone: 'missing' }
      if (found.revokedAt) return { gone: 'revoked' }
      const doc = await deepDocOf(found.slug)
      return withFormLock(found.slug, async () => {
        const form = (await readForm(id)) ?? found
        if (syncForm(form, doc)) await saveForm(form)
        return { form, doc }
      })
    }
    scoped.effect(() => register({
      path: FORM_PAGE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const opened = await openForm(new URL(request.url).searchParams.get('id') ?? '')
        if ('gone' in opened) return html(formGonePage(opened.gone === 'revoked'), opened.gone === 'revoked' ? 410 : 404)
        const version = latestVersion(opened.form)
        if (!version) return html(formGonePage(false), 404)
        const links = publicHrefs(request)
        return html(formPage(opened.form, version, { previewHref: `${links.preview}?id=${opened.form.id}`, answerHref: links.answer }))
      },
    }), 'customer-form: форма вопросов')
    scoped.effect(() => register({
      path: FORM_PREVIEW,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const opened = await openForm(new URL(request.url).searchParams.get('id') ?? '')
        if ('gone' in opened) return html(formGonePage(opened.gone === 'revoked'), opened.gone === 'revoked' ? 410 : 404)
        const version = latestVersion(opened.form)
        const deepHtml = await readFile(deepFiles(opened.doc.files, opened.form.slug).html, 'utf8').catch(() => undefined)
        if (!version || !deepHtml) return html(formGonePage(false), 404)
        const links = publicHrefs(request)
        return html(previewPage(deepHtml, opened.form, version, { formHref: `${links.form}?id=${opened.form.id}`, building: opened.doc.deep?.stage === 'building' }))
      },
    }), 'customer-form: предпросмотр БФТ по ссылке формы')
    scoped.effect(() => register({
      path: FORM_ANSWER,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const raw = await request.text().catch(() => '')
        if (raw.length > 512_000) return Response.json({ error: 'слишком большой ответ' }, { status: 413, headers: PUBLIC_HEADERS })
        let body: { id?: unknown; author?: unknown; answers?: unknown }
        try { body = JSON.parse(raw) as typeof body } catch { return Response.json({ error: 'ожидаю JSON' }, { status: 400, headers: PUBLIC_HEADERS }) }
        const id = typeof body.id === 'string' ? body.id : ''
        if (!isFormId(id)) return Response.json({ error: 'форма не найдена' }, { status: 404, headers: PUBLIC_HEADERS })
        if (!formGate.allow(id)) return Response.json({ error: 'слишком часто — подождите несколько минут' }, { status: 429, headers: PUBLIC_HEADERS })
        const opened = await openForm(id)
        if ('gone' in opened) return Response.json({ error: opened.gone === 'revoked' ? 'ссылка отозвана' : 'форма не найдена' }, { status: opened.gone === 'revoked' ? 410 : 404, headers: PUBLIC_HEADERS })
        const result = await withFormLock(opened.form.slug, async () => {
          const form = (await readForm(id)) ?? opened.form
          const res = submitAnswers(form, Array.isArray(body.answers) ? body.answers : [], typeof body.author === 'string' ? body.author : undefined)
          if ('saved' in res && res.saved) {
            await saveForm(form)
            await writeFile(answersPath(opened.doc.files.dir), answersMarkdown(form), 'utf8')
            scheduleRebuild(form)
            const taskId = Number(/^zayavka-(\d+)$/.exec(form.slug)?.[1])
            if (taskId) void mirrorRequest(taskId, form.sessionId)
          }
          return res
        })
        if ('error' in result) return Response.json({ error: result.error }, { status: 400, headers: PUBLIC_HEADERS })
        return Response.json({ ok: true, saved: result.saved }, { headers: PUBLIC_HEADERS })
      },
    }), 'customer-form: ответы формы вопросов')

    // Правка вопросов и выдача ссылки — в портале (за Authentik), со страницы полного БФТ.
    /** Заявка и готовый полный БФТ по sessionId из тела запроса. */
    const deepOfRequest = async (request: Request) => {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
      const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
      if (!ticket) return { ok: false as const, error: Response.json({ error: 'заявка не найдена' }, { status: 404 }) }
      const slug = fastSlug(ticket.taskId)
      const doc = await deepDocOf(slug)
      if (doc.deep?.stage !== 'ready' || !doc.md) return { ok: false as const, error: Response.json({ error: 'полный БФТ ещё не готов' }, { status: 409 }) }
      return { ok: true as const, body, sessionId, slug, doc }
    }
    scoped.effect(() => register({
      path: FORM_EDIT,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const got = await deepOfRequest(request)
        if (!got.ok) return got.error
        const op = got.body.op
        if (op !== 'add' && op !== 'edit' && op !== 'remove' && op !== 'restore') return Response.json({ error: 'op — add, edit, remove или restore' }, { status: 400 })
        return withFormLock(got.slug, async () => {
          const { form } = await formFor(got.slug, got.sessionId, got.doc)
          syncForm(form, got.doc)
          const error = editQuestions(form, got.body as unknown as EditOp, got.doc.people)
          if (error) return Response.json({ error }, { status: 400 })
          syncForm(form, got.doc)
          await storeForm(form, got.doc)
          return Response.json({ ok: true, version: latestVersion(form)?.v ?? 0 })
        })
      },
    }), 'customer-form: правка вопросов формы')
    scoped.effect(() => register({
      path: FORM_CREATE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const got = await deepOfRequest(request)
        if (!got.ok) return got.error
        return withFormLock(got.slug, async () => {
          let { form } = await formFor(got.slug, got.sessionId, got.doc)
          if (form.revokedAt) form = reissue(form).fresh
          syncForm(form, got.doc)
          form.publishedAt ??= new Date().toISOString()
          await storeForm(form, got.doc)
          return Response.json({ ok: true, id: form.id, url: formUrl(form.id) })
        })
      },
    }), 'customer-form: сформировать форму вопросов')
    scoped.effect(() => register({
      path: FORM_REVOKE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const got = await deepOfRequest(request)
        if (!got.ok) return got.error
        return withFormLock(got.slug, async () => {
          const form = await formOfRequest(got.doc.files.dir)
          if (!form?.publishedAt || form.revokedAt) return Response.json({ error: 'ссылка не выдана' }, { status: 409 })
          // Старый ключ — «ссылка отозвана»; список, правки и ответы — под новым, ещё не выданным.
          const { old, fresh } = reissue(form)
          await saveForm(old)
          await storeForm(fresh, got.doc)
          return Response.json({ ok: true })
        })
      },
    }), 'customer-form: отозвать ссылку формы')

    // Прогон качества (план качества, C0): только администратор и только при заданном ADMIN_PASSWORD.
    // Ответ синхронный — сборка идёт минуты; ход — в журнале контейнера.
    scoped.effect(() => register({
      path: QUALITY_RUN,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        if (!process.env.ADMIN_PASSWORD?.trim() || !isAdmin(request)) return Response.json({ error: 'Только администратор портала' }, { status: 403 })
        const body = (await request.json().catch(() => ({}))) as { fixture?: unknown; recon?: unknown; date?: unknown }
        const name = typeof body.fixture === 'string' ? body.fixture : ''
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name)) return Response.json({ error: 'fixture — имя папки в quality/ (буквы, цифры, - и _)' }, { status: 400 })
        const recon = body.recon === 'live' ? 'live' : body.recon === undefined || body.recon === 'fixture' ? 'fixture' : undefined
        if (!recon) return Response.json({ error: 'recon — fixture или live' }, { status: 400 })
        const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : undefined
        if (!existsSync(join(QUALITY_ROOT, name, 'primary.json'))) return Response.json({ error: `нет ${name}/primary.json в папке качества` }, { status: 404 })
        if (!deepRuntime) return Response.json({ error: 'модель портала недоступна' }, { status: 503 })
        if (qualityRunning.has(name)) return Response.json({ error: `прогон ${name} уже идёт` }, { status: 409 })
        qualityRunning.add(name)
        try {
          return Response.json(await qualityRun(name, recon, deepRuntime, date), { headers: { 'cache-control': 'no-store' } })
        } catch (e) {
          console.error(`[customer-form] качество ${name}: сбой`, e)
          return Response.json({ error: (e as Error).message.slice(0, 2000) }, { status: 500 })
        } finally {
          qualityRunning.delete(name)
        }
      },
    }), 'customer-form: прогон качества')

    // E2E (rev17): сбои трекера по заказу — только при флаге <DSH_HOME>/e2e-hooks,
    // его ставит и снимает harness/e2e-customer.sh. В бою эндпоинт отвечает 404.
    scoped.effect(() => register({
      path: '/api/customer-form.e2e',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        if (!existsSync(`${process.env.DSH_HOME ?? '/data'}/e2e-hooks`)) return new Response('not found', { status: 404 })
        const { action, marker } = (await request.json().catch(() => ({}))) as { action?: string; marker?: string }
        if (action === 'expireToken') backlog.expireTokenForTest()
        else if (action === 'failCreate' && marker) backlog.failCreateForTest(marker)
        else return Response.json({ error: 'unknown action' }, { status: 400 })
        return Response.json({ ok: true })
      },
    }), 'customer-form: /api/customer-form.e2e')

    // Все заявки (ADR-0012, шаг 7): статус заявки и документов, ссылки на документ и выгрузку.
    scoped.effect(() => register({
      path: REQUESTS_PAGE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        const items = await backlog.overview(await backlog.sessionIds()).catch((e) => {
          console.error('[customer-form] все заявки не загрузились:', e)
          return undefined
        })
        const rows = await Promise.all((items ?? []).map(async (item): Promise<RequestRow> => {
          const slug = fastSlug(item.taskId)
          const files = fastFiles(FAST_ROOT, slug)
          const fast = await fastState(files)
          const deep = fast?.approvedAt ? await readDeepState(deepFiles(files, slug)) : undefined
          return { ...item, ...(fast ? { fast: fast.approvedAt ? 'approved' as const : 'review' as const } : {}), ...(deep ? { deep: deep.stage } : {}) }
        }))
        return new Response(requestsPage(rows, items === undefined), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
      },
    }), 'customer-form: все заявки')

    // Список БФТ для Инбокса PO (ADR-0020): заявки, краткий статус и артефакты — JSON.
    // Читает его сервис Инбокса на этой же машине (127.0.0.1); снаружи — за Authentik, как «Все заявки».
    scoped.effect(() => register({
      path: '/api/customer-form.bftList',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        const headers = { 'cache-control': 'no-store' }
        const items = await backlog.overview(await backlog.sessionIds()).catch((e) => {
          console.error('[customer-form] список БФТ не загрузился:', e)
          return undefined
        })
        if (!items) return Response.json({ ok: false, error: 'трекер не ответил' }, { status: 502, headers })
        const cards = await Promise.all(items.map(async (item) => {
          const slug = fastSlug(item.taskId)
          const files = fastFiles(FAST_ROOT, slug)
          const fast = await fastState(files)
          const deep = fast?.approvedAt ? await readDeepState(deepFiles(files, slug)) : undefined
          const demo = sharedDemos().get(item.sessionId)
          const form = await formOfRequest(files.dir).catch(() => undefined)
          const questions = form ? latestVersion(form)?.questions ?? [] : []
          const state: BftState = {
            ...(demo ? { demo: { approvedAt: demo.approvedAt } } : {}),
            ...(fast ? { fast: { approvedAt: fast.approvedAt, rev: fast.rev } } : {}),
            ...(deep ? { deep: { stage: deep.stage, startedAt: deep.startedAt, finishedAt: deep.finishedAt } } : {}),
            ...(form ? { form: { id: form.id, publishedAt: form.publishedAt, revokedAt: form.revokedAt, total: questions.length, answered: questions.filter((q) => form.answers[q.qid]?.status === 'answer').length } } : {}),
          }
          return bftCard(item, state, { portal: portalUrl, form: formUrl, ticket: item.url && !isLoopbackUrl(item.url) ? item.url : undefined })
        }))
        return Response.json({ ok: true, newUrl: portalUrl('/'), items: cards }, { headers })
      },
    }), 'customer-form: /api/customer-form.bftList')

    // Полный БФТ: ход сборки для экрана ожидания и «Собрать заново» (ADR-0012).
    scoped.effect(() => register({
      path: '/api/customer-form.bftDeepStatus',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
        const state = ticket ? await readDeepState(deepFiles(fastFiles(FAST_ROOT, fastSlug(ticket.taskId)), fastSlug(ticket.taskId))) : undefined
        return Response.json({ stage: state?.stage ?? 'none', startedAt: state?.startedAt ?? null }, { headers: { 'cache-control': 'no-store' } })
      },
    }), 'customer-form: /api/customer-form.bftDeepStatus')
    scoped.effect(() => register({
      path: '/api/customer-form.bftDeepRetry',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown }
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
        const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
        if (!ticket) return Response.json({ error: 'заявка не найдена' }, { status: 404 })
        if (!(await fastState(fastFiles(FAST_ROOT, fastSlug(ticket.taskId))))?.approvedAt) return Response.json({ error: 'первичные требования не согласованы' }, { status: 409 })
        return startDeep(ticket, sessionId) ? Response.json({ ok: true }) : Response.json({ error: 'модель портала недоступна' }, { status: 503 })
      },
    }), 'customer-form: /api/customer-form.bftDeepRetry')

    // Скачать документ БФТ: doc=fast|deep, format=md|docx|pdf (ADR-0012, шаг 5).
    scoped.effect(() => register({
      path: '/api/customer-form.bftDownload',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const params = new URL(request.url).searchParams
        const sessionId = params.get('session') ?? ''
        const doc = params.get('doc') === 'deep' ? 'deep' : 'fast'
        const format = (['md', 'docx', 'pdf'] as const).find((f) => f === params.get('format')) as ExportFormat | undefined
        const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
        if (!ticket || !format) return new Response('документ не найден', { status: 404 })
        const slug = fastSlug(ticket.taskId)
        const files = fastFiles(FAST_ROOT, slug)
        const md = doc === 'deep' ? deepFiles(files, slug).md : files.md
        const deepState = doc === 'deep' ? await readDeepState(deepFiles(files, slug)) : undefined
        if (doc === 'deep' && deepState?.stage !== 'ready') return new Response('полный БФТ ещё не собран', { status: 404 })
        try {
          const path = await exportDocument(md, format, deepState?.questions)
          const name = `${doc === 'deep' ? slug : `${slug}-fast`}.${format}`
          return new Response(await readFile(path), { headers: { 'content-type': EXPORT_TYPES[format], 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' } })
        } catch (e) {
          console.error('[customer-form] выгрузка БФТ:', e)
          return new Response(`не удалось собрать ${format}: ${(e as Error).message}`, { status: 500 })
        }
      },
    }), 'customer-form: /api/customer-form.bftDownload')

    // Ход сборки для экрана ожидания: опрос раз в 2 с.
    scoped.effect(() => register({
      path: '/api/customer-form.bftFastStatus',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request: Request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        const progress = fastProgress.get(sessionId)
        const ticket = progress ? await backlog.find(sessionId).catch(() => undefined) : undefined
        const building = ticket ? await stillBuilding(progress, fastFiles(FAST_ROOT, fastSlug(ticket.taskId))) : !!progress && progress.stage !== 'ready'
        return Response.json({ stage: building ? progress!.stage : progress ? 'ready' : 'none', startedAt: progress?.startedAt ?? null }, { headers: { 'cache-control': 'no-store' } })
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
        try {
          const { approvedAt } = await approveFastRequest(backlog, ticket, sessionId)
          // Вопрос «Документ верный?» в чате снят: ответ уже дан кнопкой (confirm_bft_fast).
          releaseFastAsk(sessionId, 'approved')
          return Response.json({ approvedAt })
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 409 })
        }
      },
    }), 'customer-form: /api/customer-form.bftFastApprove')

    // Страница документа пишет в чат (замечания, «Добавить требования»): карточка
    // вопроса «Документ верный?» занимает место поля ввода — сначала снять её.
    scoped.effect(() => register({
      path: '/api/customer-form.fastAskRelease',
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
        const released = sessionId ? releaseFastAsk(sessionId, 'remarks') : false
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: { released } } })
      },
    }), 'customer-form: /api/customer-form.fastAskRelease')

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
          // «Смотреть все заявки» — страница портала (ADR-0012): доска трекера заказчику без входа не видна.
          const items = await backlog.overview(sessionIds)
          return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: { items, boardUrl: REQUESTS_PAGE } } })
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
        const building = ticket ? await stillBuilding(fastProgress.get(sessionId), fastFiles(FAST_ROOT, fastSlug(ticket.taskId))) : false
        const deep = ticket && fast?.approvedAt ? await readDeepState(deepFiles(fastFiles(FAST_ROOT, fastSlug(ticket.taskId)), fastSlug(ticket.taskId))) : undefined
        const value = {
          ticket: ticket ? { taskId: ticket.taskId, url: ticket.url, demoApprovedAt: ticket.demoApprovedAt } : null,
          files: sessionId ? materials.list(sessionId) : [],
          demo: record ? { rev: record.rev, title: record.demo.title, approved: !!record.approvedAt } : null,
          bftFast: building
            ? { url: fastPagePath(sessionId), rev: null, approvedAt: null, building: true }
            : fast ? { url: fastPagePath(sessionId), rev: fast.rev, approvedAt: fast.approvedAt ?? null, building: false } : null,
          bftDeep: deep ? { stage: deep.stage, startedAt: deep.startedAt, finishedAt: deep.finishedAt ?? null } : null,
        }
        return Response.json({ type: 'server-response', rpcId, result: { ok: true, value } })
      },
    }), 'customer-form: /api/customer-form.sessionInfo')
  })
}

/** Полный БФТ — в заявку: документ и страница ревью, или причина сбоя. */
async function reportDeep(backlog: Backlog, ticket: Ticket, slug: string, files: { md: string; html: string }, state: DeepState, sourcesPath?: string): Promise<void> {
  try {
    if (state.stage !== 'ready') {
      await backlog.comment(ticket, `<p><strong>⚠ Полный БФТ не собран</strong> — ${moscowTime(state.finishedAt ?? state.startedAt)}</p><p>${(state.error ?? '').slice(0, 500).replace(/[<>&]/g, '')}</p>`)
      return
    }
    await backlog.comment(ticket, `<p><strong>📄 Полный БФТ собран</strong> (bft-deep в портале) — ${moscowTime(state.finishedAt ?? state.startedAt)}</p><p>Документ и страница ревью — во вложении ${slug}.md и ${slug}.html.</p>`)
    await backlog.attach(ticket, `${slug}.md`, await readFile(files.md))
    await backlog.attach(ticket, `${slug}.html`, await readFile(files.html))
    // Карта находок Jira/Confluence — PO видит, на что опирался полный БФТ.
    if (sourcesPath) await backlog.attach(ticket, `${slug}-istochniki.md`, await readFile(sourcesPath))
  } catch (e) {
    console.error('[customer-form] полный БФТ не ушёл в задачу:', e)
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
