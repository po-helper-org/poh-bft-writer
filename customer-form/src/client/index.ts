/**
 * customer-form · браузерная половина (rev4: ничего своего).
 *
 * Решение владельца: форма заказчика — это ГЛАВНАЯ страница dsh как есть;
 * единственное изменение — скрытый сайдбар. Никаких своих компонентов,
 * оверлеев и дизайн-систем: канон харнесса. Плюс одно действие при старте —
 * чаты заказчика живут в workspace «Customer-requests» (создаём/подключаем,
 * как это делает poh-bft-plugin для своих чатов).
 */
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'

// Имена СЛУЖБ cordis, не пакетов (грабля «pending» — см. ADR-0007 rev3).
export const inject = ['slots', 'connection', 'uiWorkspace', 'workspaces']

/** Классы ui-layout 0.1.7-rc.2 (как в poh-mobile-skin; хэши — с мажорами ядра). */
const HIDE_SIDEBAR_CSS = `
/* Портал заказчика: сайдбар скрыт — остаётся чистый стартовый экран dsh. */
.pI_x6G_sidebarCol { display: none !important; }
.pI_x6G_frame { grid-template-columns: 0 1fr !important; }
`

/** Имя рабочего пространства чатов заказчика (папка в списке чатов). */
const WORKSPACE_NAME = 'Customer-requests'

export function apply(ctx: ClientContext): void {
  // 1) Скрыть сайдбар: один <style>, никаких перемещений DOM (урок poh-mobile-skin).
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'customer-form')
  style.textContent = HIDE_SIDEBAR_CSS
  document.head.appendChild(style)

  // 2) Чаты заказчика — в workspace «Customer-requests»: создаём по имени
  //    (идемпотентно, как workspaces.create({path}) у poh-bft-plugin) и
  //    подключаем как активный, чтобы новый чат открывался там.
  void (async () => {
    try {
      const workspaces = ctx.get('workspaces') as IWorkspaces | undefined
      const uiWorkspace = ctx.get('uiWorkspace') as
        | { connectWorkspace(id: WorkspaceId): Promise<unknown> } | undefined
      if (!workspaces || !uiWorkspace) return
      // create({path}) идемпотентен по пути (поведение из poh-bft-plugin).
      // Абсолютный путь знает только узел (DSH_HOME) — спрашиваем эндпоинтом.
      const host = ctx.get('connection') as unknown as {
        rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; value?: { path?: string } }> }
      }
      const res = await host.rpc.call('/api', 'customer-form.workspacePath', {})
      const path = res.ok ? res.value?.path : undefined
      if (!path) throw new Error('узел не отдал путь workspace')
      const workspace = await workspaces.create({ path })
      // connectWorkspace и отдаёт SessionId (поведение из poh-bft-plugin),
      // и подключает workspace — открываем сессию явно, чтобы композер
      // погасил «Choose workspace» и заказчик сразу писал в чат.
      // connectWorkspace достаточно: подключает workspace и открывает сессию
      // (SessionId нам не нужен; sessions.open не публичный — грабля MiniChat).
      await uiWorkspace.connectWorkspace(workspace.workspaceId)
    } catch (e) {
      console.error('[customer-form] workspace не подключился, чаты пойдут в текущий:', e)
    }
  })()
}
