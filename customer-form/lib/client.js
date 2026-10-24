window.__ModuleLoader__.load({
	id: "customer-form",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		// src/client/index.tsx
		const inject = ["@deepseek-ai/dsh-client-ui-renderer", "@deepseek-ai/dsh-client-ui-primitives"];
		/** Стиль канона dsh: переменные темы харнесса, скругления как у композера. */
		const s = {
			screen: {
				position: "fixed",
				inset: 0,
				zIndex: 90,
				overflow: "auto",
				background: "var(--dsh-bg, #fff)",
				color: "var(--dsh-fg, inherit)",
				fontFamily: "inherit",
				display: "flex",
				flexDirection: "column"
			},
			center: {
				width: "min(720px, calc(100vw - 32px))",
				margin: "0 auto",
				flex: "1",
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				padding: "48px 0 32px"
			},
			brandRow: {
				display: "flex",
				alignItems: "center",
				gap: 10,
				marginBottom: 26
			},
			brandMark: {
				width: 30,
				height: 30,
				borderRadius: 9,
				fontSize: 15,
				fontWeight: 800,
				background: "var(--dsh-accent, #0f62fe)",
				color: "#fff",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center"
			},
			brandName: {
				fontSize: 15,
				fontWeight: 700,
				letterSpacing: "-.01em"
			},
			h1: {
				fontSize: 28,
				fontWeight: 800,
				letterSpacing: "-.02em",
				margin: "0 0 8px"
			},
			sub: {
				fontSize: 14.5,
				opacity: .65,
				margin: "0 0 26px",
				lineHeight: 1.6
			},
			who: {
				display: "flex",
				gap: 8,
				margin: "0 0 10px"
			},
			input: {
				flex: 1,
				minWidth: 0,
				border: "none",
				outline: "none",
				background: "transparent",
				color: "inherit",
				font: "inherit",
				fontSize: 14,
				padding: "9px 12px",
				borderRadius: 9,
				borderBottom: "1px solid var(--dsh-border, #d5dbe4)"
			},
			composer: {
				border: "1px solid var(--dsh-border, #d5dbe4)",
				borderRadius: 18,
				background: "var(--dsh-bg-elevated, var(--dsh-bg, #fff))",
				padding: "12px 14px 10px",
				boxShadow: "0 1px 3px rgba(16,24,40,0.06)"
			},
			area: {
				width: "100%",
				border: "none",
				outline: "none",
				resize: "vertical",
				minHeight: 120,
				background: "transparent",
				color: "inherit",
				font: "inherit",
				fontSize: 15.5,
				lineHeight: 1.6
			},
			composerBar: {
				display: "flex",
				alignItems: "center",
				gap: 6,
				marginTop: 8
			},
			iconBtn: {
				border: "none",
				background: "transparent",
				cursor: "pointer",
				fontSize: 17,
				padding: "7px 9px",
				borderRadius: 9,
				color: "inherit",
				opacity: .8
			},
			chips: {
				display: "flex",
				flexWrap: "wrap",
				gap: 6,
				marginTop: 8
			},
			chip: {
				display: "inline-flex",
				alignItems: "center",
				gap: 5,
				fontSize: 12.5,
				border: "1px solid var(--dsh-border, #d5dbe4)",
				borderRadius: 8,
				padding: "4px 9px",
				background: "var(--dsh-bg, #fff)",
				opacity: .9,
				maxWidth: 260,
				overflow: "hidden",
				textOverflow: "ellipsis",
				whiteSpace: "nowrap"
			},
			status: {
				fontSize: 12.5,
				opacity: .6,
				marginTop: 10,
				textAlign: "center"
			},
			taskPill: {
				display: "inline-block",
				marginTop: 12,
				padding: "9px 14px",
				borderRadius: 10,
				background: "var(--dsh-accent-soft, #eef4ff)",
				color: "var(--dsh-accent, #1d4ed8)",
				fontWeight: 700,
				fontSize: 13.5,
				textDecoration: "none"
			},
			chat: {
				display: "flex",
				flexDirection: "column",
				minHeight: 0
			},
			msgs: {
				overflowY: "auto",
				flex: 1,
				minHeight: 120,
				maxHeight: "44vh",
				padding: "4px 2px"
			},
			msg: {
				maxWidth: "86%",
				margin: "7px 0",
				padding: "10px 14px",
				borderRadius: 14,
				fontSize: 14.5,
				lineHeight: 1.6,
				whiteSpace: "pre-wrap"
			},
			msgUser: {
				alignSelf: "flex-end",
				background: "var(--dsh-accent, #0f62fe)",
				color: "#fff",
				borderBottomRightRadius: 5
			},
			msgBot: {
				alignSelf: "flex-start",
				border: "1px solid var(--dsh-border, #d5dbe4)",
				background: "var(--dsh-bg-elevated, var(--dsh-bg, #fff))",
				borderBottomLeftRadius: 5
			},
			widget: {
				border: "1px solid var(--dsh-border, #d5dbe4)",
				borderRadius: 14,
				background: "var(--dsh-bg-elevated, var(--dsh-bg, #fff))",
				padding: "12px 15px",
				margin: "10px 0"
			},
			wTitle: {
				fontSize: 11.5,
				fontWeight: 800,
				letterSpacing: ".08em",
				textTransform: "uppercase",
				opacity: .55,
				margin: "0 0 8px"
			},
			srow: {
				display: "flex",
				alignItems: "center",
				gap: 8,
				fontSize: 13.5,
				margin: "5px 0"
			},
			dot: (filled) => ({
				width: 15,
				height: 15,
				borderRadius: "50%",
				flex: "0 0 15px",
				fontSize: 10,
				color: "#fff",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				background: filled ? "var(--dsh-ok, #0c7a43)" : "var(--dsh-border, #d5dbe4)"
			}),
			qbtn: {
				display: "block",
				width: "100%",
				textAlign: "left",
				fontSize: 13.5,
				cursor: "pointer",
				border: "1px solid var(--dsh-border, #d5dbe4)",
				borderRadius: 10,
				background: "transparent",
				color: "inherit",
				padding: "8px 12px",
				margin: "5px 0",
				font: "inherit"
			},
			think: {
				display: "inline-flex",
				gap: 4,
				alignSelf: "flex-start",
				margin: "8px 2px"
			},
			thinkDot: (i) => ({
				width: 7,
				height: 7,
				borderRadius: "50%",
				background: "var(--dsh-border, #c9d2de)",
				animation: `cfblink 1s ${i * .2}s infinite`
			}),
			sync: {
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 14,
				justifyContent: "center",
				flex: 1,
				opacity: .85
			},
			ring: {
				width: 42,
				height: 42,
				borderRadius: "50%",
				border: `4px solid var(--dsh-accent-soft, #eef4ff)`,
				borderTopColor: "var(--dsh-accent, #0f62fe)",
				animation: "cfspin 0.9s linear infinite"
			},
			finalTitle: {
				fontSize: 20,
				fontWeight: 800,
				margin: "0 0 6px"
			},
			link: {
				color: "var(--dsh-accent, #1d4ed8)",
				fontWeight: 650,
				textDecoration: "none"
			}
		};
		function apply(ctx) {
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "customer-form"
			}, CustomerScreen));
		}
		function CustomerScreen() {
			const [phase, setPhase] = (0, react.useState)("form");
			const [name, setName] = (0, react.useState)("");
			const [email, setEmail] = (0, react.useState)("");
			const [text, setText] = (0, react.useState)("");
			const [files, setFiles] = (0, react.useState)([]);
			const [links, setLinks] = (0, react.useState)(/* @__PURE__ */ new Set());
			const [busy, setBusy] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)("");
			const [taskUrl, setTaskUrl] = (0, react.useState)("");
			const taskId = (0, react.useRef)(0);
			const [msgs, setMsgs] = (0, react.useState)([]);
			const [reply, setReply] = (0, react.useState)("");
			const [widget, setWidget] = (0, react.useState)(null);
			const [glossary, setGlossary] = (0, react.useState)([]);
			const [questions, setQuestions] = (0, react.useState)([]);
			const [finalLinks, setFinalLinks] = (0, react.useState)(null);
			const [listening, setListening] = (0, react.useState)(false);
			const areaRef = (0, react.useRef)(null);
			const fileRef = (0, react.useRef)(null);
			const msgsRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const style = document.createElement("style");
				style.textContent = "@keyframes cfblink{50%{opacity:.25}}@keyframes cfspin{to{transform:rotate(360deg)}}";
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			}, []);
			(0, react.useEffect)(() => {
				msgsRef.current?.scrollTo({
					top: msgsRef.current.scrollHeight,
					behavior: "smooth"
				});
			}, [msgs]);
			const call = async (endpoint, payload) => {
				return (await (await fetch(`/api/customer-form.${endpoint}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						type: "client-request",
						rpcId: crypto.randomUUID(),
						payload: payload ?? {}
					})
				})).json()).result;
			};
			const onText = (v) => {
				setText(v);
				const found = v.match(/https?:\/\/[^\s]+/g) ?? [];
				setLinks(new Set(found.map((u) => u.replace(/[.,;)]+$/, ""))));
			};
			const upload = async (list) => {
				if (!list) return;
				for (const f of Array.from(list)) {
					setStatus(`⏳ ${f.name}…`);
					const json = await (await fetch("/api/customer-form.uploadFile", {
						method: "POST",
						headers: {
							"content-type": "application/octet-stream",
							"x-cf-filename": encodeURIComponent(f.name)
						},
						body: await f.arrayBuffer()
					})).json();
					if (json.ref) setFiles((prev) => [...prev, {
						name: json.name ?? f.name,
						ref: json.ref
					}]);
					else setStatus(json.error ?? "не удалось загрузить");
				}
				setStatus("");
			};
			const mic = () => {
				const w = window;
				const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
				if (!Ctor || listening) {
					if (!Ctor) setStatus("Браузер не поддерживает диктовку — напишите текстом");
					return;
				}
				const rec = new Ctor();
				rec.lang = "ru-RU";
				rec.interimResults = false;
				rec.continuous = true;
				rec.onresult = (e) => {
					let chunk = "";
					for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript;
					onText(text + (text ? " " : "") + chunk.trim());
				};
				rec.onend = () => setListening(false);
				rec.onerror = () => setListening(false);
				rec.start();
				setListening(true);
			};
			const submit = async () => {
				if (!text.trim() && files.length === 0) {
					setStatus("Напишите хотя бы пару слов");
					return;
				}
				setBusy(true);
				setStatus("Создаём задачу…");
				const t0 = performance.now();
				const res = await call("submit", {
					name: name.trim(),
					email: email.trim(),
					text,
					links: [...links],
					files: files.map((f) => f.ref)
				});
				setBusy(false);
				if (!res.ok || !res.value) {
					setStatus(res.error?.message ?? "не ушло");
					return;
				}
				const v = res.value;
				taskId.current = v.taskId;
				setTaskUrl(v.url);
				setStatus(performance.now() - t0 < 1e3 ? "" : "задача создана (чуть дольше секунды)");
				setPhase("chat");
				turn("Здравствуйте! Изучаю то, что вы прислали. Сразу уточню главное, чтобы PO не приходил с вопросами…");
			};
			const turn = async (first) => {
				if (first) {
					setMsgs((m) => [...m, {
						who: "bot",
						text: first
					}]);
					setWidget({
						rows: [],
						done: 0,
						total: 7
					});
				}
				setBusy(true);
				const res = await call("chat", {
					taskId: taskId.current,
					message: text
				});
				setBusy(false);
				if (!res.ok || !res.value) {
					setMsgs((m) => [...m, {
						who: "bot",
						text: res.error?.message ?? "связь споткнулась, повторите"
					}]);
					return;
				}
				const v = res.value;
				setMsgs((m) => [
					...m,
					{
						who: "user",
						text
					},
					{
						who: "bot",
						text: v.reply
					}
				]);
				setWidget(v.scorecard);
				setQuestions(v.questions ?? []);
				setGlossary(v.glossary ?? []);
				setText("");
			};
			const sendChat = async () => {
				if (!reply.trim() || busy) return;
				const message = reply;
				setReply("");
				setMsgs((m) => [...m, {
					who: "user",
					text: message
				}]);
				setBusy(true);
				const res = await call("chat", {
					taskId: taskId.current,
					message
				});
				setBusy(false);
				if (!res.ok || !res.value) {
					setMsgs((m) => [...m, {
						who: "bot",
						text: res.error?.message ?? "связь споткнулась"
					}]);
					return;
				}
				const v = res.value;
				setMsgs((m) => [...m, {
					who: "bot",
					text: v.reply
				}]);
				setWidget(v.scorecard);
				setQuestions(v.questions ?? []);
				setGlossary(v.glossary ?? []);
			};
			const finalize = async () => {
				setPhase("sync");
				const res = await call("finalize", { taskId: taskId.current });
				if (res.ok && res.value) setFinalLinks(res.value);
				setTimeout(() => setPhase("done"), 1100);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: s.screen,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("style", { children: `@keyframes cfblink{50%{opacity:.25}}@keyframes cfspin{to{transform:rotate(360deg)}}` }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: s.center,
					children: [
						phase === "form" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: s.brandRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: s.brandMark,
									children: "Б"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: s.brandName,
									children: "Система БФТ"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
								style: s.h1,
								children: "Введите свои мысли"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: s.sub,
								children: "Опишите инициативу как удобно: текстом, голосом, файлами. Ассистент задаст пару уточняющих вопросов — и постановка уйдёт в работу без встреч."
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: s.who,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: s.input,
									placeholder: "ФИО",
									value: name,
									onChange: (e) => setName(e.target.value)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									style: s.input,
									placeholder: "email",
									type: "email",
									value: email,
									onChange: (e) => setEmail(e.target.value)
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: s.composer,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										ref: areaRef,
										style: s.area,
										value: text,
										placeholder: "Что нужно, зачем и когда хотите результат…",
										onChange: (e) => onText(e.target.value)
									}),
									(files.length > 0 || links.size > 0) && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: s.chips,
										children: [[...links].map((l) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: s.chip,
											children: ["🔗 ", l.replace(/^https?:\/\//, "").slice(0, 34)]
										}, l)), files.map((f) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											style: s.chip,
											children: ["📎 ", f.name]
										}, f.ref))]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: s.composerBar,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: {
													...s.iconBtn,
													opacity: listening ? 1 : void 0,
													color: listening ? "#c0392b" : void 0
												},
												title: "Прикрепить файлы, фото, документы",
												onClick: () => fileRef.current?.click(),
												children: "📎"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
												ref: fileRef,
												type: "file",
												multiple: true,
												hidden: true,
												onChange: (e) => {
													upload(e.target.files);
													e.currentTarget.value = "";
												}
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												style: s.iconBtn,
												title: "Диктовка",
												onClick: mic,
												children: listening ? "⏹" : "🎤"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "primary",
												disabled: busy,
												onClick: () => void submit(),
												children: "Отправить →"
											})
										]
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: s.status,
								children: status
							})
						] }),
						phase === "chat" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: s.chat,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: {
										...s.brandRow,
										marginBottom: 14
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: s.brandMark,
											children: "Б"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: s.brandName,
											children: "Система БФТ · постановка"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
											href: taskUrl,
											target: "_blank",
											rel: "noreferrer",
											style: {
												...s.taskPill,
												marginTop: 0
											},
											children: "✓ Запрос создан"
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									ref: msgsRef,
									style: s.msgs,
									children: [msgs.map((m, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										style: {
											...s.msg,
											...m.who === "user" ? s.msgUser : s.msgBot
										},
										children: m.text
									}, i)), busy && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: s.think,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: s.thinkDot(0) }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: s.thinkDot(1) }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { style: s.thinkDot(2) })
										]
									})]
								}),
								widget && widget.rows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: s.widget,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											style: s.wTitle,
											children: [
												"Постановка · ",
												widget.done,
												"/",
												widget.total
											]
										}),
										widget.rows.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: s.srow,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: s.dot(r.filled),
												children: r.filled ? "✓" : ""
											}), r.title]
										}, r.key)),
										glossary.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
											style: {
												...s.status,
												textAlign: "left",
												marginTop: 8
											},
											children: ["Глоссарий: ", glossary.map((g) => `${g.term} — ${g.expansion}`).join("; ")]
										}),
										questions.map((q) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											style: s.qbtn,
											onClick: () => setReply(q),
											children: ["❓ ", q]
										}, q))
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: s.composer,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
										style: {
											...s.area,
											minHeight: 56
										},
										value: reply,
										placeholder: "Ответьте текстом или нажмите вопрос выше…",
										onChange: (e) => setReply(e.target.value),
										onKeyDown: (e) => {
											if (e.key === "Enter" && !e.shiftKey) {
												e.preventDefault();
												sendChat();
											}
										}
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: s.composerBar,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: {
													fontSize: 12.5,
													opacity: .55
												},
												children: "ссылки и файлы — в следующем сообщении текстом"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: { flex: 1 } }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "ghost",
												onClick: () => void finalize(),
												children: "Завершить сбор →"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												variant: "primary",
												disabled: busy || !reply.trim(),
												onClick: () => void sendChat(),
												children: "→"
											})
										]
									})]
								})
							]
						}),
						phase === "sync" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: s.sync,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: s.ring }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { opacity: .7 },
								children: "Синхронизируем данные…"
							})]
						}),
						phase === "done" && finalLinks && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: s.brandRow,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: s.brandMark,
									children: "✓"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: s.brandName,
									children: "Готово"
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
								style: s.h1,
								children: "Постановка собрана"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								style: s.sub,
								children: [
									"Отслеживание: ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: finalLinks.url,
										target: "_blank",
										rel: "noreferrer",
										style: s.link,
										children: "задача"
									}),
									" ·",
									" ",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: finalLinks.board,
										target: "_blank",
										rel: "noreferrer",
										style: s.link,
										children: "доска запросов"
									})
								]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								style: {
									...s.sub,
									marginTop: -14
								},
								children: "Summary и полный контекст — в комментариях задачи. Дальше за PO и командой: статус смотрите на доске."
							})
						] })
					]
				})]
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map