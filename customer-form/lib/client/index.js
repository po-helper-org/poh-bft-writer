// Имена СЛУЖБ cordis, не пакетов (грабля «pending» — см. ADR-0007 rev3).
export const inject = ['slots', 'connection', 'uiWorkspace', 'workspaces'];
/**
 * Классы ui-layout 0.1.7-rc.2 (как в poh-mobile-skin; хэши — с мажорами ядра).
 * Сайдбар выпадает из грида, поэтому центр растягиваем на его колонку, а правую
 * панель держим в своей: инлайн-ширины колонок dsh продолжает менять сам.
 */
const HIDE_SIDEBAR_CSS = `
/* Портал заказчика: сайдбар скрыт — остаётся чистый стартовый экран dsh. */
.pI_x6G_sidebarCol, .pI_x6G_handle { display: none !important; }
.pI_x6G_centerCol { grid-column: 1 / 3 !important; }
.pI_x6G_rightbarCol { grid-column: 3 !important; }
`;
/** Имя рабочего пространства чатов заказчика (папка в списке чатов). */
const WORKSPACE_NAME = 'Customer-requests';
/** Есть ли workspace с этим путём (ждём загрузки списка, не дольше 5 с). */
async function knownWorkspace(workspaces, path) {
    const list = workspaces.list;
    for (let i = 0; i < 50 && list.getSnapshot().phase !== 'ready'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return list.getSnapshot().items.some((item) => item.path === path);
}
export function apply(ctx) {
    // 1) Скрыть сайдбар: один <style>, никаких перемещений DOM (урок poh-mobile-skin).
    const style = document.createElement('style');
    style.setAttribute('data-plugin', 'customer-form');
    style.textContent = HIDE_SIDEBAR_CSS;
    document.head.appendChild(style);
    // 2) Чаты заказчика — в workspace «Customer-requests»: создаём по имени
    //    (идемпотентно, как workspaces.create({path}) у poh-bft-plugin) и
    //    подключаем как активный, чтобы новый чат открывался там.
    void (async () => {
        try {
            const workspaces = ctx.get('workspaces');
            const uiWorkspace = ctx.get('uiWorkspace');
            if (!workspaces || !uiWorkspace)
                return;
            // create({path}) идемпотентен по пути (поведение из poh-bft-plugin).
            // Абсолютный путь знает только узел (DSH_HOME) — спрашиваем эндпоинтом.
            const host = ctx.get('connection');
            const res = await host.rpc.call('/api', 'customer-form.workspacePath', {});
            const path = res.ok ? res.value?.path : undefined;
            if (!path)
                throw new Error('узел не отдал путь workspace');
            // Workspace уже есть → штатное восстановление dsh само откроет последний
            // чат в нём (вернувшийся заказчик видит свой диалог). Наш openWorkspace
            // поверх него дрался бы за сессию и плодил пустые.
            if (await knownWorkspace(workspaces, path))
                return;
            const workspace = await workspaces.create({ path });
            // openWorkspace = «новый чат в workspace»: подключает и открывает сессию.
            // На чистом томе список workspace догоняет create не сразу — ждём.
            for (let attempt = 0;; attempt++) {
                try {
                    await uiWorkspace.openWorkspace(workspace.workspaceId);
                    break;
                }
                catch (e) {
                    if (attempt >= 20)
                        throw e;
                    await new Promise((resolve) => setTimeout(resolve, 250));
                }
            }
        }
        catch (e) {
            console.error('[customer-form] workspace не подключился, чаты пойдут в текущий:', e);
        }
    })();
}
