/**
 * Регистрация раздела в харнессе.
 *
 * Тип контекста описан здесь структурно, а не импортом из `@deepseek-ai/cordis`.
 * Это тот же приём, которым сам эталонный плагин описывает службу соединения
 * (`ConnectionLike` в его `plugin.ts`): берём ровно то, чем пользуемся, и не
 * заводим типовой зависимости ради трёх методов. Форма проверена по рабочему
 * коду харнесса, а не додумана.
 */
import { BftReader } from './bft-reader.js'
import { BFT_CHANNEL, dispatch, type RpcResult } from './channel.js'
import { toBftConfig, type PluginConfig } from './plugin-config.js'

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
}

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
}
