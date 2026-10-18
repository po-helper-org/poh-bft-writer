/* bft-blueprint · карта инициативы. Данные — #map-data (собирает bft-map-render.py).
   Три слоя чтения: «Что видят» (история), «Что делаем» (задачи команд), «Как это работает»
   (Frontstage, Backstage, Support). Подробности — по клику, в боковой панели. */
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("map-data").textContent);
  const { esc, wrapT, chip, mockSVG } = BPK;
  const body = document.body, grid = document.getElementById("grid");
  const MARK = "[УТОЧНИТЬ";
  const U = t => String(t || "").includes(MARK);

  /* ---------- справочники ---------- */
  const COLS = [...D.stages, { id: "стало", name: "Итог", when: "" }];
  const colOf = st => COLS.findIndex(c => c.id === st);
  const TEAM = {}; D.teams.forEach((t, i) => TEAM[t.id] = { name: t.name, c: `var(--t${i % 10})` });
  const teamC = t => t.team === "?" ? "var(--red)" : TEAM[t.team].c;
  const teamN = t => t.team === "?" ? "Команда?" : TEAM[t.team].name;
  const TASK = {}; D.tasks.forEach(t => TASK[t.id] = t);
  const PROC = {}; D.processes.forEach(p => PROC[p.id] = p);
  const qOf = where => D.questions.filter(q => q.where === where && q.open);
  const asks = id => qOf(id).filter(q => q.kind === "вопрос").length;
  const blocks = id => qOf(id).filter(q => q.kind === "блокер");
  const scrOpen = id => D.storyQuestions.some(q => q.where === id);
  const LAYER = { front: ["Frontstage", "видит гость", "#0f8b8d"], back: ["Backstage", "за кадром", "#2563c9"], sup: ["Support", "основа", "#6b5fb0"] };
  const PERSONA_ICON = ['<circle cx="8" cy="5.5" r="2.6"/><path d="M3 14c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5"/>', '<path d="M4 2v5a2 2 0 0 0 2 2v5M6 2v4M8 2v5a2 2 0 0 1-2 2M12 14V2c-1.5 1-2.5 3-2.5 5.5H12"/>'];
  const who = p => `<span class="who"><svg viewBox="0 0 16 16">${PERSONA_ICON[Math.min(1, D.personas.findIndex(x => x.id === p.id))]}</svg>${esc(p.name)}</span>`;
  const mock = (id, w) => `<span class="scrw" style="position:relative;display:block${w ? `;width:${w}px` : ""}">${scrOpen(id) ? '<span class="dot" style="top:-4px;right:-5px"></span>' : ""}${mockSVG(D.screens[id], D.screens[id].contour)}</span>`;

  /* ---------- шапка ---------- */
  const uniqBlk = [...new Set(D.questions.filter(q => q.open && q.kind === "блокер").map(q => q.text))];
  document.getElementById("blk").innerHTML = uniqBlk.length ? `<button class="tool blk" data-guide="blk"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5"/><path d="M3.5 12.5l9-9"/></svg>Блокеры · ${uniqBlk.length}</button>` : "";
  const used = {}; D.tasks.forEach(t => used[t.team] = (used[t.team] || 0) + 1);
  document.getElementById("teams").innerHTML = D.teams.filter(t => used[t.id]).map(t => `<button class="tchip" data-tf="${t.id}" style="--c:${TEAM[t.id].c}"><i></i>${esc(t.name)}<b>${used[t.id]}</b></button>`).join("") +
    (used["?"] ? `<button class="tchip" data-tf="?" style="--c:var(--red)"><i class="u"></i>Команда не определена<b>${used["?"]}</b></button>` : "");

  /* ---------- карточки ---------- */
  function seenHTML(c) {
    return D.seen.filter(s => s.col === c).map(s => {
      const p = D.personas.find(x => x.id === s.persona);
      if (s.final) return `<div class="seen fin" data-seen="${s.key}" role="button" tabindex="0">${who(p)}${s.big ? `<b class="big">${esc(s.big)}</b>` : ""}<b>${esc(s.title)}</b></div>`;
      const sub = s.steps.length > 1 ? s.steps.slice(1).map(x => x.title).join(" → ") : s.steps[0].text;
      return `<div class="seen" data-seen="${s.key}" role="button" tabindex="0"><span class="th">${mock(s.steps[0].screens[0])}</span><div class="sx">${who(p)}<b>${esc(s.steps[0].title)}</b><p>${esc(sub)}</p></div></div>`;
    }).join("");
  }
  function taskHTML(t) {
    const b = blocks(t.id).length, a = asks(t.id);
    return `<button class="wk${b ? " blk" : ""}" data-task="${t.id}" data-team="${t.team}" style="--c:${teamC(t)}"><span class="tm${t.team === "?" ? " u" : ""}"><i></i>${esc(teamN(t))}${b ? '<span class="bl">Блокер</span>' : a ? `<span class="qn" title="Открытых вопросов: ${a}">${a}</span>` : ""}</span><span class="tx">${esc(t.text)}</span></button>`;
  }
  function procHTML(p) {
    const t = TASK[p.task], b = blocks(p.id).length + blocks(p.task).length;
    return `<button class="hw ${p.layer}${b ? " blk" : ""}" data-proc="${p.id}" data-team="${t.team}" style="--c:${teamC(t)}"><span>${esc(p.text)}</span><i title="${esc(teamN(t))}"></i></button>`;
  }

  /* ---------- холст ---------- */
  grid.className = "map";
  grid.style.gridTemplateColumns = `96px repeat(${COLS.length}, minmax(224px, 1fr))`;
  grid.style.minWidth = `${96 + COLS.length * 236}px`;
  let h = `<div class="mh corner"></div>` + COLS.map((c, i) => `<div class="mh${i < COLS.length - 1 ? " arrow" : ""}"><span class="n">${i === COLS.length - 1 ? "✓" : i + 1}</span><span class="hx"><b>${esc(c.name)}</b>${c.when ? `<small>${esc(c.when)}</small>` : ""}</span></div>`).join("");
  h += `<div class="ml">Что видят</div>` + COLS.map((_, c) => `<div class="mc">${seenHTML(c)}</div>`).join("");
  h += `<div class="ml top">Что делаем</div>` + COLS.map((col, c) => `<div class="mc top">${D.tasks.filter(t => t.stage === col.id).map(taskHTML).join("")}</div>`).join("");
  if (D.processes.length) {
    h += `<div class="hsec"><span>Как это работает</span></div>`;
    ["front", "back", "sup"].filter(l => D.processes.some(p => p.layer === l)).forEach(l => {
      h += `<div class="ml hrow l-${l}">${LAYER[l][0]}<small>${LAYER[l][1]}</small></div>` + COLS.map(col => `<div class="mc how l-${l}">${D.processes.filter(p => p.layer === l && p.stage === col.id).map(procHTML).join("")}</div>`).join("");
    });
  }
  grid.innerHTML = h;

  /* стрелки между процессами — из «Цепочки» */
  function drawLinks() {
    grid.querySelector("svg.hwl")?.remove();
    const g = grid.getBoundingClientRect();
    const R = el => { const r = el.getBoundingClientRect(); return { l: r.left - g.left, r: r.right - g.left, t: r.top - g.top, b: r.bottom - g.top, cx: (r.left + r.right) / 2 - g.left, cy: (r.top + r.bottom) / 2 - g.top } };
    let s = `<svg class="hwl" width="${grid.scrollWidth}" height="${grid.scrollHeight}"><defs><marker id="mh" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0L10,5L0,10z" fill="#8c877d"/></marker></defs>`;
    const path = pts => `<path d="M${pts.map(p => p.map(Math.round).join(",")).join(" L")}" fill="none" stroke="#8c877d" stroke-width="1.5" marker-end="url(#mh)"/>`;
    const seen = new Set();
    D.links.forEach(l => {
      if (!PROC[l.src] || !PROC[l.dst]) return;
      // на карте — только соседние шаги; полная цепочка живёт в карточке процесса
      if (Math.abs(colOf(PROC[l.src].stage) - colOf(PROC[l.dst].stage)) > 1) return;
      const key = [l.src, l.dst].sort().join(); if (seen.has(key)) return; seen.add(key);
      const ea = grid.querySelector(`[data-proc="${l.src}"]`), eb = grid.querySelector(`[data-proc="${l.dst}"]`); if (!ea || !eb) return;
      const A = R(ea), B = R(eb);
      if (Math.abs(A.cx - B.cx) < 40) s += B.t > A.b ? path([[A.cx, A.b], [A.cx, B.t]]) : path([[A.cx, A.t], [A.cx, B.b]]);
      else if (B.l > A.r) s += Math.abs(A.cy - B.cy) < 3 ? path([[A.r, A.cy], [B.l, B.cy]]) : path([[A.r, A.cy], [B.l - 12, A.cy], [B.l - 12, B.cy], [B.l, B.cy]]);
      else if (A.l > B.r) s += path([[A.l, A.cy], [B.r + 12, A.cy], [B.r + 12, B.cy], [B.r, B.cy]]);
    });
    grid.insertAdjacentHTML("beforeend", s + "</svg>");
  }
  window.addEventListener("load", drawLinks); window.addEventListener("resize", drawLinks);

  /* ---------- телефон: шаг за шагом сверху вниз ---------- */
  document.getElementById("mstack").innerHTML = COLS.map((col, c) => {
    const tasks = D.tasks.filter(t => t.stage === col.id), procs = D.processes.filter(p => p.stage === col.id);
    return `<section class="ms"><div class="mh2"><span class="n">${c === COLS.length - 1 ? "✓" : c + 1}</span><div><b>${esc(col.name)}</b>${col.when ? `<small>${esc(col.when)}</small>` : ""}</div></div>
      <div class="wl">${seenHTML(c)}</div>${tasks.length ? `<span class="lb">Что делаем</span><div class="wl">${tasks.map(taskHTML).join("")}</div>` : ""}
      ${procs.length ? `<span class="lb">Как это работает</span><div class="wl">${procs.map(procHTML).join("")}</div>` : ""}</section>`;
  }).join("");

  /* ---------- боковая панель ---------- */
  const side = document.getElementById("side");
  function openSide(tag, color, title, meta, html, wide) {
    side.innerHTML = `<div class="stop"><span class="tag" style="--c:${color}">${esc(tag)}</span><h3>${esc(title)}</h3><div class="meta">${meta}</div><button class="x" aria-label="Закрыть">×</button></div><div class="sin">${html}</div>`;
    body.classList.toggle("wide", !!wide); body.classList.add("open"); side.scrollTop = 0;
  }
  const closeSide = () => body.classList.remove("open", "wide");
  const qHTML = list => list.length ? `<ul class="qlist">${list.map(q => `<li class="${q.kind === "блокер" ? "b" : ""}">${q.kind === "блокер" ? "Блокер: " : ""}${esc(q.text)}<small>${esc(q.to)}</small></li>`).join("")}</ul>` : "";

  function openSeen(key) {
    const s = D.seen.find(x => x.key === key), p = D.personas.find(x => x.id === s.persona), col = COLS[s.col];
    const html = s.steps.map(st => `<div class="stp">${st.screens.length ? `<div class="chips2">${[...new Set(st.screens.map(id => D.screens[id].contour))].map(chip).join("")}</div><div class="vis">${st.screens.map(id => mock(id, 170)).join("")}</div>` : ""}
      <h5>${esc(st.title)}</h5><p>${esc(st.text)}</p>${st.was ? `<div class="was"><b>Раньше</b>${esc(st.was)}</div>` : ""}
      ${qHTML(D.storyQuestions.filter(q => q.where === st.id || st.screens.includes(q.where)).map(q => ({ ...q, kind: "вопрос" })))}<div class="src">Источник: ${esc(st.source)}</div></div>`).join("");
    openSide(p.name, "#2f6b2a", col.name, `${esc(p.lane)} · ${s.steps.length} ${s.steps.length === 1 ? "шаг" : "шага"}`, html);
  }

  function openTask(id) {
    const t = TASK[id], procs = D.processes.filter(p => p.task === id);
    let x = `<h4>Зачем</h4><div class="why">${esc(t.why)}</div>`;
    const qs = qOf(id); if (qs.length) x += `<h4>Что не решено</h4>${qHTML(qs)}`;
    if (procs.length) x += `<h4>Как это работает</h4><div class="chips2">${procs.map(p => chainChip(p.id, LAYER[p.layer][0])).join("")}</div>`;
    const fd = idefOf(t); if (fd) x += `<h4>IDEF0 ${fd.local ? LOCAL : ""}</h4>${idefHTML(t, fd, "t")}`;
    x += `<h4>Требования БФТ</h4><div class="reqs">${t.reqs.map(r => `<span>${r}</span>`).join("")}</div>`;
    openSide(teamN(t), teamC(t), t.text, `задача ${t.id} · ${esc(COLS[colOf(t.stage)].name)} · ${esc(t.status)}`, x);
  }

  /* цепочка процесса: что до и что после */
  function chainChip(id, lab) {
    if (!PROC[id]) return `<span class="cc ev">${esc(id)}</span>`;
    const p = PROC[id], t = TASK[p.task];
    return `<button class="cc" data-proc="${id}" style="--c:${teamC(t)}"><i></i><span><b>${esc(p.text)}</b><small>${esc(lab)}</small></span></button>`;
  }
  function critHTML(p) {
    return p.criteria.map(c => `<li class="${c.state}"><span class="ic">${c.state === "blocker" ? "!" : c.state === "ask" ? "?" : "✓"}</span><span>${esc(c.text.replace(/\s*—\s*БЛОКЕР/, ""))}${c.state === "blocker" ? "<em>Блокер</em>" : ""}<small>${esc(c.source)}</small></span></li>`).join("");
  }
  /* ---------- схемы как код: документ или правка в этом браузере ---------- */
  const lsGet = k => { try { return localStorage.getItem(k) || "" } catch (e) { return "" } };
  const lsSet = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch (e) { } };
  const dslKey = (kind, id, draft) => `bp-dsl-${D.epic}-${kind}-${id}${draft ? "-draft" : ""}`;
  const hasErr = m => m.issues.some(i => i.level === "ERROR");
  /* текст блока из документа; блока нет — заготовка с ключами грамматики */
  const BLANK = { seq: "описание: \nA -> B: ", idef0: "вход: \nуправление: \nвыход: \nмеханизм: " };
  const docSrc = (kind, id) => (kind === "seq" ? PROC[id].src : TASK[id].idef && TASK[id].idef.src) || `\`\`\`${kind} ${id}\n${BLANK[kind]}\n\`\`\``;
  /* проверка блока для этой карточки: разбор как у линтера + ID блока совпадает с карточкой */
  function checkFor(kind, id, text) {
    const m = BPD.checkText(text, D.parts), off = BPD.extract(text).offset;
    if (m.kind && (m.kind !== kind || m.id !== id)) m.issues.unshift({ line: 0, level: "ERROR", code: "DG000", msg: `здесь блок \`\`\`${kind} ${id}\`\`\`, а не \`\`\`${m.kind} ${m.id}\`\`\`` });
    return { m, off };
  }
  /* действующая схема: применённая правка (если она без ошибок), иначе — документ */
  function seqOf(p) {
    const ov = lsGet(dslKey("seq", p.id));
    if (ov) { const { m } = checkFor("seq", p.id, ov); if (!hasErr(m)) return { ...m, local: true } }
    return { desc: p.desc, parts: p.parts, steps: p.steps, local: false };
  }
  function idefOf(t) {
    const ov = lsGet(dslKey("idef0", t.id));
    if (ov) { const { m } = checkFor("idef0", t.id, ov); if (!hasErr(m)) return { ...m, local: true } }
    return t.idef ? { ...t.idef, local: false } : null;
  }
  const teamHex = t => t.team === "?" ? "#c0392b" : getComputedStyle(document.documentElement).getPropertyValue(TEAM[t.team].c.slice(4, -1)).trim();
  const pname = (m, k) => ((m.parts && m.parts[k]) || D.parts[k] || [k])[0];
  const LOCAL = '<span class="loc">правка в браузере</span>';
  function seqHTML(m, uid) {
    const hid = BPD.hiddenSteps(m, D.parts);
    let x = `<div class="seqw">${BPD.seqSVG(m, D.parts, uid)}</div><div class="seqk"><span><i style="background:#2f6b2a"></i>видно человеку</span><span><i style="background:#2563c9"></i>скрыто от гостя</span><span>- - → ответ</span></div>`;
    if (hid.length) x += `<details class="pd"><summary>Что скрыто от гостя · ${hid.length}</summary><ol class="hidl">${hid.map(([n, s]) => `<li value="${n}"><b>${esc(pname(m, s.src))} → ${esc(pname(m, s.dst))}</b> ${esc(s.text)}</li>`).join("")}</ol></details>`;
    return x;
  }
  function idefHTML(t, f, uid) {
    const o = { title: t.text, color: teamHex(t), dashed: t.team === "?", uid };
    return BPD.idefSVG(f, o) + (f.children && f.children.length ? `<div class="lb2">Декомпозиция A0 → A1…A${f.children.length}</div><div class="idefw">${BPD.idefDecompSVG(f, { ...o, uid: uid + "d" })}</div>` : "");
  }

  function openProc(id, tab) {
    const p = PROC[id], t = TASK[p.task], L = LAYER[p.layer], sq = seqOf(p), fd = idefOf(t);
    const pre = D.links.filter(l => l.dst === id), post = D.links.filter(l => l.src === id);
    let x = `<div class="pchain"><div class="pc"><span class="lb">← До</span>${pre.map(l => chainChip(l.src, l.what)).join("") || '<span class="cc ev">—</span>'}</div>
      <div class="pc"><span class="lb">Этот процесс</span><div class="meb">${esc(p.text)}</div></div>
      <div class="pc"><span class="lb">После →</span>${post.map(l => chainChip(l.dst, l.what)).join("") || '<span class="cc ev">—</span>'}</div></div>`;
    if (p.before || p.after) x += `<div class="pab"><div><span class="lb">Было</span>${esc(p.before || "—")}</div><span class="ar">→</span><div><span class="lb">Станет</span><b>${esc(p.after || "—")}</b></div></div>`;
    if (p.criteria.length) x += `<h4>Что требуется</h4><ul class="crit">${critHTML(p)}</ul>`;
    const qs = [...qOf(id), ...qOf(p.task)]; if (qs.length) x += `<h4>Вопросы и блокеры</h4>${qHTML(qs)}`;
    x += `<h4 id="phow">Как устроено ${sq.local ? LOCAL : ""}</h4>`;
    if (sq.desc) x += `<p class="pdesc${U(sq.desc) ? " ask" : ""}">${esc(sq.desc)}</p>`;
    x += sq.steps.length ? seqHTML(sq, "m") : '<div class="pempty">Схемы пока нет — соберите её в «Схеме как коде» ниже</div>';
    if (fd) x += `<details class="pd"${fd.local ? " open" : ""}><summary>Задача целиком — IDEF0${fd.children && fd.children.length ? ` · декомпозиция на ${fd.children.length}` : ""}</summary>${fd.local ? LOCAL : ""}${idefHTML(t, fd, "p")}</details>`;
    x += `<details class="pd"><summary>Требования БФТ · ${t.reqs.length}</summary><div class="reqs">${t.reqs.map(r => `<span>${r}</span>`).join("")}</div>${p.source ? `<div class="src">Источник: ${esc(p.source)}</div>` : ""}</details>`;
    x += `<div class="pwork"><h4>Дополнить</h4><textarea id="pnote" placeholder="Контекст техлида: что подправить, что уже известно, ссылки">${esc(lsGet(noteKey(id)))}</textarea>
      <div class="pai"><div><b>Системная аналитика с ИИ</b><small>промпт собран из карточки: требования, цепочка, схема, вопросы и ваша заметка</small></div>
      <button class="tool" data-ai="copy" data-kind="sa" data-id="${id}">Скопировать промпт</button><a class="tool" data-ai="open" data-kind="sa" data-id="${id}" target="_blank" rel="noopener">Открыть в Claude ↗</a></div></div>`;
    x += `<div class="pwork dsl" id="dsl" data-id="${id}"><h4>Схема как код</h4>
      <div class="dtabs" role="tablist"><button data-dt="seq">Sequence · ${id}</button><button data-dt="idef0">IDEF0 · задача ${t.id}</button></div>
      <textarea class="dsrc" spellcheck="false" aria-label="Текст схемы"></textarea>
      <div class="dstat" aria-live="polite"></div><ul class="diss"></ul><div class="dprev"></div>
      <div class="dbtn"><button class="tool pri" data-dsl="apply">Применить к карточке</button><button class="tool" data-dsl="copy">Скопировать блок</button><button class="tool" data-dsl="reset">Вернуть из документа</button></div>
      <div class="pai"><div><b>Собрать схему с ИИ</b><small>промпт: грамматика, участники и контекст карточки. Ответ ИИ вставьте в поле — проверка сразу</small></div>
      <button class="tool" data-ai="copy" data-kind="dsl" data-id="${id}">Скопировать промпт</button><a class="tool" data-ai="open" data-kind="dsl" data-id="${id}" target="_blank" rel="noopener">Открыть в Claude ↗</a></div>
      <small class="dhint">Правка живёт в этом браузере. В документ — блок через <code>bft-diagram-apply.py</code>, затем перерисовать карту.</small></div>`;
    openSide(`${L[0]} · ${L[1]}`, L[2], p.text, `<span class="pteam" style="--c:${teamC(t)}"><i></i>${esc(teamN(t))}</span> · задача ${t.id} «${esc(t.text)}» · ${esc(COLS[colOf(p.stage)].name)}`, x, true);
    const ta = document.getElementById("pnote");
    ta.addEventListener("input", () => { lsSet(noteKey(id), ta.value); refreshAi() });
    dslTab(tab || "seq");
    const src = side.querySelector(".dsrc"); let tm = 0;
    src.addEventListener("input", () => { const d = side.querySelector("#dsl"); lsSet(dslKey(d.dataset.kind, d.dataset.target, true), src.value); clearTimeout(tm); tm = setTimeout(dslCheck, 150) });
  }
  const noteKey = id => `bp-note-${D.epic}-${id}`;

  /* редактор: вкладка, проверка, предпросмотр */
  function dslTab(kind) {
    const d = side.querySelector("#dsl"), p = PROC[d.dataset.id], target = kind === "seq" ? p.id : p.task;
    d.dataset.kind = kind; d.dataset.target = target;
    d.querySelectorAll("[data-dt]").forEach(b => { b.classList.toggle("on", b.dataset.dt === kind); b.setAttribute("aria-selected", b.dataset.dt === kind) });
    d.querySelector(".dsrc").value = lsGet(dslKey(kind, target, true)) || lsGet(dslKey(kind, target)) || docSrc(kind, target);
    dslCheck(); refreshAi();
  }
  function dslCheck() {
    const d = side.querySelector("#dsl"); if (!d) return null;
    const kind = d.dataset.kind, target = d.dataset.target, { m, off } = checkFor(kind, target, d.querySelector(".dsrc").value);
    const err = m.issues.filter(i => i.level === "ERROR").length, warn = m.issues.length - err;
    d.querySelector(".dstat").className = "dstat " + (err ? "bad" : "good");
    d.querySelector(".dstat").textContent = err ? `✗ Ошибок: ${err}${warn ? ` · предупреждений: ${warn}` : ""} — схема не применится` : `✓ Синтаксис в порядке${warn ? ` · предупреждений: ${warn}` : ""}`;
    d.querySelector(".diss").innerHTML = m.issues.map(i => `<li class="${i.level === "ERROR" ? "e" : "w"}"><b>стр. ${i.line + off}</b><code>${i.code}</code>${esc(i.msg)}</li>`).join("");
    const t = TASK[PROC[d.dataset.id].task];
    const same = blockKey(d.querySelector(".dsrc").value) === blockKey(lsGet(dslKey(kind, target)) || docSrc(kind, target));
    d.querySelector(".dprev").innerHTML = err ? "" : same ? '<div class="psame">Совпадает со схемой в карточке — измените текст или вставьте ответ ИИ</div>'
      : `<div class="lb2">Предпросмотр</div>${kind === "seq" ? seqHTML(m, "v") : idefHTML(t, m, "v")}`;
    d.querySelector('[data-dsl="apply"]').disabled = !!err;
    return { m, err };
  }
  /* блок без пустых строк и отступов — чтобы сравнить «то же самое» */
  const blockKey = text => { const ex = BPD.extract(text); return ex.kind ? [ex.kind, ex.id, ...ex.body.map(l => l.trim()).filter(Boolean)].join("\n") : text.trim() };
  function dslAction(act) {
    const d = side.querySelector("#dsl"), kind = d.dataset.kind, target = d.dataset.target, ta = d.querySelector(".dsrc");
    if (act === "copy") { const ex = BPD.extract(ta.value); return copyText(ex.kind ? [`\`\`\`${ex.kind} ${ex.id}`, ...ex.body, "```"].join("\n") : ta.value, d.querySelector('[data-dsl="copy"]')) }
    if (act === "apply") { const r = dslCheck(); if (!r || r.err) return; const ex = BPD.extract(ta.value); lsSet(dslKey(kind, target), [`\`\`\`${ex.kind} ${ex.id}`, ...ex.body, "```"].join("\n")) }
    if (act === "reset") lsSet(dslKey(kind, target), "");
    lsSet(dslKey(kind, target, true), "");
    openProc(d.dataset.id, kind);
    if (act === "apply") { const h = side.querySelector(kind === "seq" ? "#phow" : "details.pd"); if (h) side.scrollTop = h.offsetTop - 110 }
  }

  /* ---------- промпты для ИИ ---------- */
  function procContext(id) {
    const p = PROC[id], t = TASK[p.task], nm = x => PROC[x] ? PROC[x].text : x, note = lsGet(noteKey(id));
    return `Процесс ${id}: ${p.text}
Задача ${t.id} «${t.text}», команда: ${teamN(t)}, шаг пути: ${COLS[colOf(p.stage)].name}, слой: ${LAYER[p.layer][0]}.
Было: ${p.before || "—"}. Станет: ${p.after || "—"}.
До: ${D.links.filter(l => l.dst === id).map(l => `${nm(l.src)} (${l.what})`).join("; ") || "—"}.
После: ${D.links.filter(l => l.src === id).map(l => `${nm(l.dst)} (${l.what})`).join("; ") || "—"}.

Что требуется (из БФТ):
${p.criteria.map(c => `- ${c.text} (${c.source})`).join("\n") || "—"}

Открытые вопросы:
${[...qOf(id), ...qOf(p.task)].map(q => `- ${q.kind === "блокер" ? "БЛОКЕР: " : ""}${q.text} (кому: ${q.to})`).join("\n") || "—"}
${note ? `\nЗаметка техлида: ${note}\n` : ""}
Источник: БФТ ${D.epic}${p.source ? `, ${p.source}` : ""}.`;
  }
  function aiPrompt(id) {
    const p = PROC[id], sq = seqOf(p);
    let n = 0; const steps = sq.steps.map(s => `${++n}. ${s.branch ? `[${s.branch}] ` : ""}${pname(sq, s.src)} → ${pname(sq, s.dst)}: ${s.text}`);
    return `Ты — системный аналитик. Проведи системную аналитику процесса инициативы «${D.title}».

${procContext(id)}

Как устроено${sq.desc ? `: ${sq.desc}` : ""}
${steps.join("\n") || "—"}

Задача:
1) найди пробелы, противоречия и неявные зависимости в процессе;
2) опиши альтернативные и ошибочные сценарии, которых нет в БФТ;
3) предложи, какие состояния, данные и интеграции нужны — помечай это как гипотезу для СА;
4) сформулируй вопросы «кому — что», без которых процесс не запустить.`;
  }
  function dslPrompt(id, kind) {
    const p = PROC[id], t = TASK[p.task], target = kind === "seq" ? id : t.id;
    const cur = lsGet(dslKey(kind, target, true)) || lsGet(dslKey(kind, target)) || docSrc(kind, target);
    const parts = Object.keys(D.parts).map(k => `${k}: ${D.parts[k][0]} (${{ p: "человек", i: "интерфейс", s: "система", x: "внешний" }[D.parts[k][1]]})`).join("; ");
    return `Ты — системный аналитик. Собери ${kind === "seq" ? `sequence-схему процесса ${id}` : `IDEF0 задачи ${t.id} «${t.text}» с декомпозицией на функции`} инициативы «${D.title}». Опирайся только на контекст ниже; чего в нём нет — пиши [УТОЧНИТЬ у <кого>], не придумывай.

Грамматика — строго:
${BPD.GRAMMAR[kind]}
${kind === "seq" ? `\nУчастники карты: ${parts}.\n` : ""}
${procContext(id)}

Сейчас:
${cur}

Верни только один блок \`\`\`${kind} ${target} … \`\`\` без пояснений до и после.`;
  }
  function promptFor(el) { return el.dataset.kind === "dsl" ? dslPrompt(el.dataset.id, side.querySelector("#dsl").dataset.kind) : aiPrompt(el.dataset.id) }
  function refreshAi() { side.querySelectorAll('[data-ai="open"]').forEach(a => a.href = "https://claude.ai/new?q=" + encodeURIComponent(promptFor(a))) }
  function copyText(txt, btn) {
    const lab = btn.textContent, done = () => { btn.textContent = "Скопировано ✓"; setTimeout(() => btn.textContent = lab, 1600) };
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(done).catch(() => { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done() } catch (er) { } ta.remove() });
  }

  /* ---------- инструкции, легенда, блокеры ---------- */
  const DOCS = "https://github.com/po-helper-org/poh-bft-writer/blob/main/docs/guides/blueprint/";
  const ARTICLES = [["service-blueprint.md", "#2563c9", "SB", "Методология Service Blueprint и карта опыта", "Откуда эта карта: Service Blueprint, карта процесса-опыта, линии взаимодействия, видимости и внутреннего взаимодействия."],
    ["how-to-read.md", "#2f6b2a", "?", "Как читать карту", "Что видят, что делаем, как это работает — и куда нажимать."],
    ["product-storytelling.md", "#6b3fd4", "PS", "Product Storytelling: история через экраны", "Как устроен сюжет «было → шаги → стало» и почему история помогает проектировать."],
    ["idef0.md", "#d06a12", "I0", "IDEF0: функция на одной схеме", "Входы, регуляторы, выходы, механизмы — и кому из команды это нужно."],
    ["bft.md", "#1c1c1c", "БФТ", "БФТ: бизнес-функциональные требования", "Откуда карта берёт каждый шаг и задачу и как вопросы с карты возвращаются в требования."]];
  function openGuide(kind) {
    if (kind === "help") openSide("Инструкции", "#555", "Как работать с картой", "", ARTICLES.map(([f, c, ic, t, d], i) => `<a class="art" href="${DOCS + f}" target="_blank" rel="noopener"><span class="ic" style="background:${c}">${ic}</span><span><b>${i + 1}. ${esc(t)}</b><span>${esc(d)}</span><em>Читать на GitHub ↗</em></span></a>`).join(""));
    else if (kind === "blk") openSide("Блокеры", "var(--red)", `Блокеров: ${uniqBlk.length}`, "", D.questions.filter(q => q.open && q.kind === "блокер").map(q => `<div class="bcard" data-${TASK[q.where] ? "task" : "proc"}="${q.where}"><b>${esc(q.text)}</b><small>${esc(q.to)} · ${esc(TASK[q.where] ? TASK[q.where].text : PROC[q.where].text)}</small></div>`).join(""));
    else openSide("Легенда", "#555", "Условные обозначения", "", `<div class="lg"><h4>Колонки</h4><div class="row"><i><span class="mh" style="position:static;padding:0!important;background:none"><span class="n">1</span></span></i><span>Шаг пути<small>слева направо — от подготовки до итога</small></span></div>
      <h4>Что видят</h4><div class="row"><i><span class="box" style="background:#fff;border:1px solid var(--line)"></span></i><span>Экран и фраза гостя или ресторана<small>по клику — все шаги этапа, экраны, вопросы</small></span></div>
      <h4>Что делаем — цвет команды</h4>${D.teams.filter(t => used[t.id]).map(t => `<div class="row"><i><span class="sw" style="background:${TEAM[t.id].c}"></span></i><span>${esc(t.name)}</span></div>`).join("")}${used["?"] ? `<div class="row"><i><span class="sw" style="border:1.5px dashed var(--red)"></span></i><span>Команда не определена</span></div>` : ""}
      <div class="row"><i><span class="qn">2</span></i><span>Открытые вопросы</span></div><div class="row"><i><span class="bl" style="margin:0">Блокер</span></i><span>Без решения задача не стартует</span></div>
      <h4>Как это работает</h4><div class="row"><i><span class="box" style="background:#e5f3f4"></span></i><span>Frontstage<small>то, что видит гость</small></span></div><div class="row"><i><span class="box" style="background:#e7edf8"></span></i><span>Backstage<small>за кадром</small></span></div><div class="row"><i><span class="box" style="background:#efecf6"></span></i><span>Support<small>общие ресурсы и внешние каналы</small></span></div>
      <div class="row"><i><span class="ln1"></span></i><span>Линия взаимодействия</span></div><div class="row"><i><span class="ln2"></span></i><span>Линия видимости</span></div><div class="row"><i><span class="ln3"></span></i><span>Линия внутреннего взаимодействия</span></div>
      <div class="row"><i><span class="dot inl"></span></i><span>На экране есть вопрос</span></div></div>`);
  }

  /* ---------- история по шагам ---------- */
  let showP = D.personas[0].id, showI = 0; const show = document.getElementById("show");
  function scene() {
    const steps = D.story.filter(s => s.persona === showP), s = steps[showI], p = D.personas.find(x => x.id === showP);
    const vis = s.screens.length ? `<div class="vis2">${s.screens.map(id => mockSVG(D.screens[id], D.screens[id].contour)).join("")}</div>` : s.big ? `<div class="big">${esc(s.big)}</div>` : "<div></div>";
    show.querySelector(".stage").innerHTML = `<div class="scene">${vis}<div><div class="n">${esc(s.label)}</div><h2>${esc(s.title)}</h2><p class="say">${esc(s.text)}</p>${s.was ? `<div class="was"><b>Раньше</b>${esc(s.was)}</div>` : ""}</div></div>`;
    show.querySelector(".whos").innerHTML = D.personas.map(x => `<button data-p="${x.id}" class="${x.id === showP ? "on" : ""}">${esc(x.lane)}</button>`).join("");
    show.querySelector(".prev").disabled = showI === 0; show.querySelector(".next").disabled = showI === steps.length - 1;
  }
  const stepShow = d => { const n = D.story.filter(s => s.persona === showP).length; showI = Math.max(0, Math.min(n - 1, showI + d)); scene() };
  document.getElementById("play").addEventListener("click", () => { showP = D.personas[0].id; showI = 0; body.classList.add("showing"); scene() });
  show.addEventListener("click", e => { if (e.target.closest(".x")) body.classList.remove("showing"); else if (e.target.closest(".prev")) stepShow(-1); else if (e.target.closest(".next")) stepShow(1); else { const b = e.target.closest("[data-p]"); if (b) { showP = b.dataset.p; showI = 0; scene() } } });

  /* ---------- клики и клавиатура ---------- */
  document.addEventListener("click", e => {
    const t = e.target;
    if (t.closest(".side .x") || t.closest(".scrim")) return closeSide();
    const ai = t.closest("[data-ai]");
    if (ai) {
      if (ai.dataset.ai === "open") { ai.href = "https://claude.ai/new?q=" + encodeURIComponent(promptFor(ai)); return }
      return copyText(promptFor(ai), ai);
    }
    const dt = t.closest("[data-dt]"); if (dt) return dslTab(dt.dataset.dt);
    const da = t.closest("[data-dsl]"); if (da) return dslAction(da.dataset.dsl);
    const tf = t.closest("[data-tf]");
    if (tf) { const on = tf.classList.contains("on"); document.querySelectorAll(".tchip").forEach(x => x.classList.toggle("on", !on && x === tf)); document.querySelectorAll(".wk,.hw").forEach(x => x.classList.toggle("dim", !on && x.dataset.team !== tf.dataset.tf)); return }
    const g = t.closest("[data-guide]"); if (g) return openGuide(g.dataset.guide);
    const pr = t.closest("[data-proc]"); if (pr) return openProc(pr.dataset.proc);
    const tk = t.closest("[data-task]"); if (tk) return openTask(tk.dataset.task);
    const sn = t.closest("[data-seen]"); if (sn) return openSeen(sn.dataset.seen);
  });
  document.addEventListener("keydown", e => {
    if (body.classList.contains("showing")) { if (e.key === "ArrowRight") stepShow(1); else if (e.key === "ArrowLeft") stepShow(-1); else if (e.key === "Escape") body.classList.remove("showing"); return }
    if (e.key === "Escape") closeSide();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-seen]")) { e.preventDefault(); openSeen(e.target.dataset.seen) }
  });
  window.BPMAP = { aiPrompt, dslPrompt, openProc, openTask, openSeen, dslTab, dslCheck };
})();
