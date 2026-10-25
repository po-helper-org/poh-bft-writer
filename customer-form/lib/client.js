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
			"workspaces",
			"sessions",
			"locale"
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
		/**
		* Русский языковой пакет экрана заказчика — штатный механизм dsh-client-locale
		* (addLanguage + register), не свой UI. Язык по умолчанию выбирает профиль
		* (locale.preference: ru); всё, чего здесь нет, берётся из en.
		* Заголовок героя — инструкция HowToDemo п.2 «Введите свои мысли».
		*/
		const RU_CONVERSATION = {
			"hero.headline": "Введите свои мысли",
			"hero.preview": "Портал заказчика",
			"hero.chooseWorkspace": "Раздел заявок",
			"placeholder.hero": "Опишите инициативу своими словами: что нужно, как сейчас, что мешает. Прикрепите файлы и ссылки",
			"placeholder.default": "Ответьте или дополните заявку",
			"placeholder.workspace": "Готовим раздел заявок…",
			"placeholder.unavailable": "Чат недоступен",
			"input.commands": "Прикрепить файлы",
			"input.file": "Файл",
			"input.stop": "Остановить ответ",
			"input.send": "Отправить",
			"input.send.queue": "Отправить следом",
			"input.send.steer": "Уточнить сейчас",
			"attachment.pending": "Вложения",
			"attachment.dropTitle": "Перетащите сюда файлы или изображения",
			"attachment.dropDesc": "Изображений — до {count}, по {size} каждое",
			"attachment.dropBlocked": "Сейчас добавить файлы нельзя",
			"attachment.directoryDesktopOnly": "Папки целиком в браузере не добавить — прикрепите файлы по одному"
		};
		/** Форма уточняющих вопросов (ask_user_question) — HowToDemo п.8. */
		const RU_QUESTION = {
			"error.incomplete": "Сначала ответьте на этот вопрос.",
			"error.unanswered": "Выберите вариант или впишите свой ответ.",
			"nav.prev": "Предыдущий вопрос",
			"nav.next": "Следующий вопрос",
			"nav.minimize": "Свернуть вопросы",
			"nav.maximize": "Развернуть вопросы",
			"nav.cancel": "Закрыть вопросы",
			"option.recommended": "Рекомендуем",
			"custom.placeholder": "Свой ответ",
			"action.skip": "Пропустить",
			"action.next": "Дальше"
		};
		/** Статусы хода в ленте, которые видит заказчик. */
		const RU_CHAT = {
			"message.stepProcess.questions": "Ждём ваших ответов",
			"message.stepProcess.done.questions": "Вопросы заданы",
			"message.turnProcess.worked": "Готово",
			"message.turnProcess.deepDivingFor": "Изучаю {duration}",
			"message.turnProcess.took": "Заняло {duration}",
			"message.turnProcess.failed": "Не получилось",
			"chat.deepDiving": "Изучаю…",
			"message.turnError": "Ассистент не ответил",
			"row.failed": "Ошибка"
		};
		const RU_COMMON = {
			submit: "Отправить",
			submitting: "Отправляем…"
		};
		function apply(ctx) {
			const style = document.createElement("style");
			style.setAttribute("data-plugin", "customer-form");
			style.textContent = HIDE_SIDEBAR_CSS;
			document.head.appendChild(style);
			const locale = ctx.get("locale");
			ctx.effect(() => locale.addLanguage({
				id: "ru",
				label: "Русский",
				fallback: "en"
			}), "customer-form: язык ru");
			const dictionaries = {
				conversation: RU_CONVERSATION,
				question: RU_QUESTION,
				chat: RU_CHAT,
				common: RU_COMMON
			};
			for (const [namespace, dictionary] of Object.entries(dictionaries)) ctx.effect(() => locale.register(namespace, "ru", dictionary), `customer-form: словарь ru/${namespace}`);
			(async () => {
				try {
					const workspaces = ctx.get("workspaces");
					const uiWorkspace = ctx.get("uiWorkspace");
					const sessions = ctx.get("sessions");
					if (!workspaces || !uiWorkspace || !sessions) return;
					const res = await ctx.get("connection").rpc.call("/api", "customer-form.workspacePath", {});
					const path = res.ok ? res.value?.path : void 0;
					if (!path) throw new Error("узел не отдал путь workspace");
					const workspace = await workspaces.create({ path });
					for (let attempt = 0;; attempt++) try {
						uiWorkspace.openSession(await sessions.create({ workspaceId: workspace.workspaceId }));
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