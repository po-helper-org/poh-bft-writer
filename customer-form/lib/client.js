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
		/** Классы ui-layout 0.1.7-rc.2 (как в poh-mobile-skin; хэши — с мажорами ядра). */
		const HIDE_SIDEBAR_CSS = `
/* Портал заказчика: сайдбар скрыт — остаётся чистый стартовый экран dsh. */
.pI_x6G_sidebarCol { display: none !important; }
.pI_x6G_frame { grid-template-columns: 0 1fr !important; }
`;
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
					const workspace = await workspaces.create({ path });
					await uiWorkspace.connectWorkspace(workspace.workspaceId);
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