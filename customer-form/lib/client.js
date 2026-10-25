window.__ModuleLoader__.load({
	id: "customer-form",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// src/client/index.ts
		const inject = [
			"slots",
			"connection",
			"uiWorkspace",
			"workspaces"
		];
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
		/** Есть ли workspace с этим путём (ждём загрузки списка, не дольше 5 с). */
		async function knownWorkspace(workspaces, path) {
			const list = workspaces.list;
			for (let i = 0; i < 50 && list.getSnapshot().phase !== "ready"; i++) await new Promise((resolve) => setTimeout(resolve, 100));
			return list.getSnapshot().items.some((item) => item.path === path);
		}
		function apply(ctx) {
			const style = document.createElement("style");
			style.setAttribute("data-plugin", "customer-form");
			style.textContent = HIDE_SIDEBAR_CSS;
			document.head.appendChild(style);
			(async () => {
				try {
					const workspaces = ctx.get("workspaces");
					const uiWorkspace = ctx.get("uiWorkspace");
					if (!workspaces || !uiWorkspace) return;
					const res = await ctx.get("connection").rpc.call("/api", "customer-form.workspacePath", {});
					const path = res.ok ? res.value?.path : void 0;
					if (!path) throw new Error("узел не отдал путь workspace");
					if (await knownWorkspace(workspaces, path)) return;
					const workspace = await workspaces.create({ path });
					for (let attempt = 0;; attempt++) try {
						await uiWorkspace.openWorkspace(workspace.workspaceId);
						break;
					} catch (e) {
						if (attempt >= 20) throw e;
						await new Promise((resolve) => setTimeout(resolve, 250));
					}
				} catch (e) {
					console.error("[customer-form] workspace не подключился, чаты пойдут в текущий:", e);
				}
			})();
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map