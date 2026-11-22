/**
 * Регистрация раздела в харнессе.
 *
 * Тип контекста описан здесь структурно, а не импортом из `@deepseek-ai/cordis`.
 * Это тот же приём, которым сам эталонный плагин описывает службу соединения
 * (`ConnectionLike` в его `plugin.ts`): берём ровно то, чем пользуемся, и не
 * заводим типовой зависимости ради трёх методов. Форма проверена по рабочему
 * коду харнесса, а не додумана.
 */
import z from '@deepseek-ai/schemastery'
import { existsSync as fsExistsSync, readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { BftReader } from './bft-reader.js'
import { CATALOG_GUARD_ORDER, CATALOG_GUARD_SECTION, catalogGuardText, isStale } from './catalog-guard.js'
import { BFT_CHANNEL, BFT_ENDPOINTS, dispatch, type RpcResult } from './channel.js'
import { bftFetchRoute, type BftFetchRoute } from './api-route.js'
import { OnboardingService } from './onboarding-host.js'
import { MAX_UPLOAD_BYTES, sanitizeFilename, uploadDir } from './intake.js'
import { BoxClient } from './box-client.js'
import { fastDocPath } from './intake-fast.js'
import type { IntakeService } from './channel.js'
import { toBftConfig, type PluginConfig } from './plugin-config.js'
import { BFT_SETTINGS_NS, DEFAULT_SYNC_PROMPT, type BftSettings } from './settings.js'

export const name = 'poh-bft-plugin'

/** Форма службы соединения, которой нам достаточно. */
interface ConnectionLike {
  rpc: {
    handle: (
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
      options?: { authority?: string },
    ) => () => Promise<void> | void
  }
  /** Ядро 0.1.7+: точные маршруты на общем канале `/api` (см. src/api-route.ts). */
  fetch?: { register: (route: BftFetchRoute) => () => Promise<void> | void }
}

interface HarnessContext {
  get(name: string): unknown
  effect(fn: () => (() => void | Promise<void>) | void, label?: string): void
  inject(names: string[], apply: (scoped: HarnessContext) => void): void
  /**
   * Подписка на события композиции (`ctx.on` cordis). Формы структурные, как и
   * остальное здесь, и взяты из `packages/core/agent/src/runtime-types.ts` и
   * `packages/core/session/src/index.ts` харнесса: `agent/status` — агент начал
   * или закончил ход (файлы эпика могли измениться, сессия сменила состояние),
   * `agent/error` — агент упал, `session/disposed` — сессию удалили.
   */
  on?(event: 'agent/status', listener: (payload: { agent: AgentLike; status: 'idle' | 'running' }) => void): () => unknown
  on?(event: 'agent/error', listener: (payload: { agent: AgentLike; error: unknown }) => void): () => unknown
  on?(event: 'session/disposed', listener: (session: { id: string }) => void): () => unknown
}

/** Агент харнесса — нужна только его сессия: по ней журнал находит отрезок работы. */
interface AgentLike {
  session: { id: string }
}

/**
 * Пауза между `idle` агента и сверкой доски. Агент заканчивает ход несколькими
 * инструментами подряд, а несколько агентов — вразнобой; сверять после каждого
 * значило бы дёргать `backlog` десятки раз ради одного результата.
 */
const RECONCILE_DEBOUNCE_MS = 1500

/**
 * Форма реестра системного промпта (`ctx.systemPrompt`, @deepseek-ai/dsh-system-prompt):
 * одна регистрация секции, текст — провайдер на каждую сборку. Структурно, как остальное.
 */
interface SystemPromptLike {
  section(section: { name: string; order: number; text: string | (() => string) }): () => void
}

/**
 * Форма службы настроек харнесса (`ctx.settings`, @deepseek-ai/dsh-settings), которой нам
 * достаточно: одна регистрация пространства имён. Структурно, как и остальные службы здесь.
 */
interface SettingsLike {
  register(
    ns: string,
    schema: unknown,
    options?: { base?: Partial<BftSettings> },
  ): unknown
}

/**
 * Схема пространства имён настроек раздела (см. src/settings.ts).
 *
 * Узел её только регистрирует: карточку рисует браузерная половина, а читает значения она
 * сама через `ctx.settingsScope`. Регистрация здесь нужна затем, что вкладка «Плагины»
 * показывает лишь те пространства имён, которые отдаёт хост, — без неё карточка не появится,
 * сколько её ни регистрируй в браузере.
 */
const Settings: z<BftSettings> = z.object({
  formUrl: z.string().default(''),
  sheetUrl: z.string().default(''),
  syncPrompt: z.string().default(DEFAULT_SYNC_PROMPT),
})

/**
 * Схема строки профиля `bft-requirements`.
 *
 * Ядро 0.1.7 убрало `settings.register`: настройки, которые PO правит из интерфейса, теперь —
 * поля Config самого плагина, помеченные `.volatile()`; служба настроек отдаёт их форме по id
 * записи профиля и пишет правки в cordis.patch.yml профиля. Поэтому Config объявляет ВСЕ поля
 * строки: схема schemastery отбрасывает незнакомые ключи, и неописанный `workspaceRoot` пропал
 * бы из конфига ещё до apply(). Полей без умолчаний здесь нарочно нет (кроме трёх настроек PO):
 * пустое значение по-прежнему означает «взять из окружения» (toBftConfig).
 */
export const Config: z<PluginConfig & BftSettings> = z.object({
  workspaceRoot: z.string(),
  docsPath: z.string(),
  indexPath: z.string(),
  taskType: z.string(),
  backlogBin: z.string(),
  entireBaseUrl: z.string(),
  entireBranchUrl: z.string(),
  entireRequired: z.boolean(),
  sessionPath: z.string(),
  skillsPath: z.string(),
  claudeBin: z.string(),
  claudeArgs: z.union([z.array(z.string()), z.string()]),
  formUrl: z.string().default('').volatile(),
  // Слой окружения — умолчание схемы: очистка поля в форме возвращает адрес из окружения.
  sheetUrl: z.string().default(process.env.BFT_INITIATIVES_SHEET_URL?.trim() ?? '').volatile(),
  syncPrompt: z.string().default(DEFAULT_SYNC_PROMPT).volatile(),
}) as unknown as z<PluginConfig & BftSettings>

/**
 * Поднимает раздел требований.
 *
 * Служба соединения берётся отложенной инъекцией, а не жёстким требованием:
 * без веб-интерфейса композиция всё равно должна подниматься, и отсутствие
 * соединения обязано гасить раздел, а не весь запуск.
 */
export function apply(ctx: HarnessContext, config: PluginConfig): void {
  const reader = new BftReader(toBftConfig(config, process.env))
  // Интейк → Коробка (Т8): адрес и ui-токен из окружения; в compose их задаёт
  // start.sh (BFT_BOX_URL внутри сети, BFT_BOX_UI_TOKEN из BOX_TOKENS).
  const boxClient = new BoxClient({
    baseUrl: process.env.BFT_BOX_URL ?? '',
    token: process.env.BFT_BOX_UI_TOKEN ?? '',
    fetch: (url, init) => fetch(url, init as RequestInit),
  })
  const intake: IntakeService = {
    doc: async (slug) => {
      try {
        // readDocument ждёт путь от корня воркспейса (проверка «внутри docsRoot»),
        // а fastDocPath — от docsPath: приставляем каталог документов.
        return await reader.readDocument(`${config.docsPath}/${fastDocPath(slug)}`)
      } catch {
        return null
      }
    },
    start: (input) => boxClient.start(input),
    board: () => boxClient.board(),
    submitOutcome: (input) => boxClient.submitOutcome(input),
  }
  // Онбординг: DSH_HOME из окружения харнесса (в контейнере — /data), порты —
  // те же инъекции fs, что у читателя; fetch — глобальный (node 18+).
  const onboarding = new OnboardingService({
    home: process.env.DSH_HOME ?? '',
    fs: { readTextFile: (p) => fs.readFile(p, 'utf8'), writeTextFile: (p, t) => fs.writeFile(p, t, 'utf8') },
    env: process.env,
    fetch: (url, init) => fetch(url, init as RequestInit),
  })
  // Выгрузка раздела или остановка харнесса гасит живые ходы Claude Code: дочерний
  // `claude -p` иначе переживёт узел и продолжит править документы, а раздел после
  // перезапуска будет считать сессию прерванной и разрешит второй ход по тому же файлу.
  ctx.effect(() => () => { reader.dispose() }, 'poh-bft-plugin: остановка ходов Claude Code')

  ctx.inject(['connection'], (scoped: HarnessContext) => {
    const connection = scoped.get('connection') as ConnectionLike
    // Ядро 0.1.7+: маршрут на каждую подкоманду, см. src/api-route.ts.
    const register = connection.fetch?.register
    if (typeof register === 'function') {
      const handler = (endpoint: string, payload: unknown) => dispatch(reader, endpoint, payload, onboarding, intake)
      for (const endpoint of BFT_ENDPOINTS) {
        scoped.effect(() => register(bftFetchRoute(endpoint, handler)), `poh-bft-plugin: /api/bft.${endpoint}`)
      }
      // Интейк, выгрузка вложений (Т7): бинарное тело, не JSON-конверт — файл
      // с встречи в base64 раздувался бы в полтора раза. Заголовки несут имя и
      // слаг; кладём в workspace/bft/uploads/<ts>-<slug>/ (контракт скилла: путь).
      scoped.effect(() => register({
        path: '/api/bft.intakeUpload',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request: Request) => {
          const cfg = toBftConfig(config, process.env)
          const dir = uploadDir(request.headers.get('x-bft-slug') ?? 'intake')
          // Имя приходит percent-encoded (HTTP-заголовки ASCII): браузерный клиент
          // кодирует; decodeURIComponent с защитой от чужого мусора.
          const rawName = request.headers.get('x-bft-filename') ?? ''
          let decodedName = rawName
          try { decodedName = decodeURIComponent(rawName) } catch { /* оставляем как есть */ }
          const filename = sanitizeFilename(decodedName)
          if (!filename) return Response.json({ error: 'Пустое имя файла' }, { status: 400 })
          const body = Buffer.from(await request.arrayBuffer())
          if (body.byteLength === 0) return Response.json({ error: 'Пустой файл' }, { status: 400 })
          if (body.byteLength > MAX_UPLOAD_BYTES) {
            return Response.json({ error: `Файл больше ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ` }, { status: 413 })
          }
          const target = join(cfg.workspaceRoot ?? process.cwd(), dir, filename)
          await fs.mkdir(dirname(target), { recursive: true })
          await fs.writeFile(target, body)
          return Response.json({ path: dir + '/' + filename, bytes: body.byteLength })
        },
      }), 'poh-bft-plugin: /api/bft.intakeUpload')
      return
    }
    // Ядро 0.1.2: собственный канал /bft.
    scoped.effect(
      () => connection.rpc.handle(
        BFT_CHANNEL,
        (endpoint, payload) => dispatch(reader, endpoint, payload, onboarding, intake),
        { authority: 'loopback' },
      ),
      'poh-bft-plugin: канал /bft',
    )
  })

  // Доска ← артефакты по факту работы агента. Событие приходит для любого агента
  // и любой сессии — фильтровать нечем и незачем: сверка идемпотентна и дешева
  // (один `task list --json`), а правка на доске случается только при расхождении.
  // Ошибка сверки — в консоль харнесса, не в его падение: раздел без доски жив.
  if (typeof ctx.on === 'function') {
    // Харнесс поднялся: всё, что числилось «агент ходит», оборвалось на перезапуске.
    reader.markInterrupted().catch((error: unknown) => { console.warn('[poh-bft-plugin] журнал работы:', error) })

    // Состояние сессий по требованиям — из тех же событий. Чужие сессии журнал не
    // знает и молча пропускает (touchSession ничего не пишет).
    const track = (sessionId: string, state: 'running' | 'idle' | 'failed' | 'gone'): void => {
      reader.touchSession(sessionId, state)
        .catch((error: unknown) => { console.warn('[poh-bft-plugin] состояние сессии:', error) })
    }
    ctx.effect(() => {
      const offs = [
        ctx.on!('agent/status', ({ agent, status }) => { track(agent.session.id, status) }),
        ctx.on!('agent/error', ({ agent }) => { track(agent.session.id, 'failed') }),
        ctx.on!('session/disposed', (session) => { track(session.id, 'gone') }),
      ]
      return () => { for (const off of offs) off() }
    }, 'poh-bft-plugin: состояние сессий по требованиям')

    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    let again = false
    const run = (): void => {
      if (running) { again = true; return }
      running = true
      reader.reconcile()
        .then(({ edits }) => {
          for (const edit of edits) {
            if (edit.ok) console.info(`[poh-bft-plugin] доска обновлена: ${edit.id} ${edit.stage ?? ''} ${(edit.addRefs ?? []).join(' ')}`.trim())
            else console.warn(`[poh-bft-plugin] доска не обновлена: ${edit.id}: ${edit.error ?? ''}`)
          }
        })
        .catch((error: unknown) => { console.warn('[poh-bft-plugin] сверка доски не удалась:', error) })
        .finally(() => {
          running = false
          if (again) { again = false; run() }
        })
    }
    ctx.effect(() => {
      const off = ctx.on!('agent/status', ({ status }) => {
        if (status !== 'idle') return
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => { timer = undefined; run() }, RECONCILE_DEBOUNCE_MS)
      })
      return () => {
        if (timer !== undefined) clearTimeout(timer)
        off()
      }
    }, 'poh-bft-plugin: сверка доски после хода агента')
  }

  // Страж дублей (catalog-guard.ts): секция промпта с каталогом инициатив. Реестр промпта
  // берётся отложенной инъекцией — композиция без агентов его не поднимает, и раздел без него
  // жив. Провайдер текста синхронный по контракту реестра, поэтому он отдаёт последний снимок
  // скана и лишь заказывает новый, когда снимок стар: первый ход после перезапуска увидит
  // каталог, если стартовый скан ниже успел, иначе — инструкцию свериться через CLI.
  if (config.catalogGuard !== false) {
    let refreshing = false
    const refresh = (): void => {
      if (refreshing) return
      refreshing = true
      reader.catalogSnapshot()
        .catch((error: unknown) => { console.warn('[poh-bft-plugin] снимок каталога:', error) })
        .finally(() => { refreshing = false })
    }
    refresh()
    ctx.inject(['systemPrompt'], (scoped: HarnessContext) => {
      const systemPrompt = scoped.get('systemPrompt') as SystemPromptLike
      scoped.effect(
        () => systemPrompt.section({
          name: CATALOG_GUARD_SECTION,
          order: CATALOG_GUARD_ORDER,
          text: () => {
            const snapshot = reader.catalogSnapshotSync()
            if (isStale(snapshot?.at, Date.now())) refresh()
            return catalogGuardText(snapshot)
          },
        }),
        'poh-bft-plugin: страж дублей каталога БФТ',
      )
    })
  }

  // Служба настроек тоже необязательна: без неё раздел работает на умолчаниях, как и до
  // появления карточки. Адрес таблицы из окружения (`BFT_INITIATIVES_SHEET_URL`) кладётся
  // слоем композиции — тем самым настройка PO оказывается ВЫШЕ окружения по построению,
  // а очистка поля возвращает значение из окружения обратно. Ручного «если пусто, возьми
  // env» нигде нет: это слоение делает сама служба настроек.
  const sheetFromEnv = process.env.BFT_INITIATIVES_SHEET_URL?.trim()
  ctx.inject(['settings'], (scoped: HarnessContext) => {
    const settings = scoped.get('settings') as Partial<SettingsLike>
    // Ядро 0.1.7+: регистрации нет, поля формы — volatile-поля Config (см. выше).
    if (typeof settings.register !== 'function') return
    settings.register(BFT_SETTINGS_NS, Settings, sheetFromEnv ? { base: { sheetUrl: sheetFromEnv } } : {})
  })
}
