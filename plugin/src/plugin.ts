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
import { BftReader } from './bft-reader.js'
import { BFT_CHANNEL, dispatch, type RpcResult } from './channel.js'
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
}

interface HarnessContext {
  get(name: string): unknown
  effect(fn: () => (() => void | Promise<void>) | void, label?: string): void
  inject(names: string[], apply: (scoped: HarnessContext) => void): void
  /**
   * Подписка на события композиции (`ctx.on` cordis). Из всех событий нужна одна —
   * `agent/status`: агент закончил ход, и файлы эпика могли измениться. Форма
   * структурная, как и остальное здесь: `{ status: 'idle' | 'running' }`
   * (`packages/core/agent/src/runtime-types.ts` харнесса).
   */
  on?(event: 'agent/status', listener: (payload: { status: 'idle' | 'running' }) => void): () => unknown
}

/**
 * Пауза между `idle` агента и сверкой доски. Агент заканчивает ход несколькими
 * инструментами подряд, а несколько агентов — вразнобой; сверять после каждого
 * значило бы дёргать `backlog` десятки раз ради одного результата.
 */
const RECONCILE_DEBOUNCE_MS = 1500

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
 * Поднимает раздел требований.
 *
 * Служба соединения берётся отложенной инъекцией, а не жёстким требованием:
 * без веб-интерфейса композиция всё равно должна подниматься, и отсутствие
 * соединения обязано гасить раздел, а не весь запуск.
 */
export function apply(ctx: HarnessContext, config: PluginConfig): void {
  const reader = new BftReader(toBftConfig(config, process.env))

  ctx.inject(['connection'], (scoped: HarnessContext) => {
    const connection = scoped.get('connection') as ConnectionLike
    scoped.effect(
      () => connection.rpc.handle(
        BFT_CHANNEL,
        (endpoint, payload) => dispatch(reader, endpoint, payload),
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
    let timer: ReturnType<typeof setTimeout> | undefined
    let running = false
    let again = false
    const run = (): void => {
      if (running) { again = true; return }
      running = true
      reader.reconcile()
        .then(({ edits }) => {
          for (const edit of edits) {
            if (edit.ok) console.info(`[poh-bft-plugin] доска обновлена: ${edit.id} ${edit.stage ?? ''} ${edit.addRef ?? ''}`.trim())
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

  // Служба настроек тоже необязательна: без неё раздел работает на умолчаниях, как и до
  // появления карточки. Адрес таблицы из окружения (`BFT_INITIATIVES_SHEET_URL`) кладётся
  // слоем композиции — тем самым настройка PO оказывается ВЫШЕ окружения по построению,
  // а очистка поля возвращает значение из окружения обратно. Ручного «если пусто, возьми
  // env» нигде нет: это слоение делает сама служба настроек.
  const sheetFromEnv = process.env.BFT_INITIATIVES_SHEET_URL?.trim()
  ctx.inject(['settings'], (scoped: HarnessContext) => {
    const settings = scoped.get('settings') as SettingsLike
    settings.register(BFT_SETTINGS_NS, Settings, sheetFromEnv ? { base: { sheetUrl: sheetFromEnv } } : {})
  })
}
