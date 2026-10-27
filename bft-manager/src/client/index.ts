/**
 * bft-manager · браузерная половина (ADR-0009).
 *
 * Одна запись в слое оверлеев оболочки (`shell.overlay`, как страницы
 * poh-bft-plugin): кнопка-меню в левом верхнем углу главной и полноэкранная
 * страница «Управление БФТ» поверх неё.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import { BftManager, type Call } from './BftPage.js'
import { CSS } from './styles.js'

// Имена СЛУЖБ cordis, не пакетов (грабля «pending» — ADR-0007 rev3).
export const inject = ['slots', 'connection']

interface SlotsLike {
  inject(name: string, register: () => () => void): void
  register(options: Record<string, unknown>, component: ComponentType<never>): () => void
}

interface HostRpcLike {
  rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }> }
}

export function apply(ctx: ClientContext): void {
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'bft-manager')
  style.textContent = CSS
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'bft-manager: стили')

  const host = ctx.get('connection') as unknown as HostRpcLike
  const call: Call = async <T,>(endpoint: string, payload?: unknown) => {
    try {
      const res = await host.rpc.call('/api', endpoint, payload ?? {})
      return res.ok ? { ok: true as const, value: res.value as T } : { ok: false as const, message: res.error?.message ?? 'ошибка узла' }
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : String(e) }
    }
  }

  const slots = ctx.get('slots') as SlotsLike
  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'bft-manager', inject: () => ({ call }) },
    BftManager as ComponentType<never>,
  ))
}
