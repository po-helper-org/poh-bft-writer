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
    if (t.idef) x += `<h4>IDEF0</h4>${idef0(t)}`;
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
  function openProc(id) {
    const p = PROC[id], t = TASK[p.task], L = LAYER[p.layer];
    const pre = D.links.filter(l => l.dst === id), post = D.links.filter(l => l.src === id);
    let x = `<div class="pchain"><div class="pc"><span class="lb">← До</span>${pre.map(l => chainChip(l.src, l.what)).join("") || '<span class="cc ev">—</span>'}</div>
      <div class="pc"><span class="lb">Этот процесс</span><div class="meb">${esc(p.text)}</div></div>
      <div class="pc"><span class="lb">После →</span>${post.map(l => chainChip(l.dst, l.what)).join("") || '<span class="cc ev">—</span>'}</div></div>`;
    if (p.before || p.after) x += `<div class="pab"><div><span class="lb">Было</span>${esc(p.before || "—")}</div><span class="ar">→</span><div><span class="lb">Станет</span><b>${esc(p.after || "—")}</b></div></div>`;
    if (p.criteria.length) x += `<h4>Что требуется</h4><ul class="crit">${critHTML(p)}</ul>`;
    const qs = [...qOf(id), ...qOf(p.task)]; if (qs.length) x += `<h4>Вопросы и блокеры</h4>${qHTML(qs)}`;
    if (p.steps.length) {
      const hid = hiddenSteps(p);
      x += `<h4>Как устроено</h4><div class="seqw">${seqSVG(p)}</div><div class="seqk"><span><i style="background:#2f6b2a"></i>видно человеку</span><span><i style="background:#2563c9"></i>скрыто от гостя</span><span>- - → ответ</span></div>`;
      if (hid.length) x += `<details class="pd"><summary>Что скрыто от гостя · ${hid.length}</summary><ol class="hidl">${hid.map(([n, s]) => `<li value="${n}"><b>${esc(D.parts[s.src][0])} → ${esc(D.parts[s.dst][0])}</b> ${esc(s.text)}</li>`).join("")}</ol></details>`;
    }
    if (t.idef) x += `<details class="pd"><summary>Задача целиком — IDEF0</summary>${idef0(t)}</details>`;
    x += `<details class="pd"><summary>Требования БФТ · ${t.reqs.length}</summary><div class="reqs">${t.reqs.map(r => `<span>${r}</span>`).join("")}</div>${p.source ? `<div class="src">Источник: ${esc(p.source)}</div>` : ""}</details>`;
    let note = ""; try { note = localStorage.getItem(noteKey(id)) || "" } catch (e) { }
    x += `<div class="pwork"><h4>Дополнить</h4><textarea id="pnote" placeholder="Контекст техлида: что подправить, что уже известно, ссылки">${esc(note)}</textarea>
      <div class="pai"><div><b>Системная аналитика с ИИ</b><small>промпт собран из карточки: требования, цепочка, схема, вопросы и ваша заметка</small></div>
      <button class="tool" data-ai="copy" data-id="${id}">Скопировать промпт</button><a class="tool" data-ai="open" data-id="${id}" target="_blank" rel="noopener">Открыть в Claude ↗</a></div></div>`;
    openSide(`${L[0]} · ${L[1]}`, L[2], p.text, `<span class="pteam" style="--c:${teamC(t)}"><i></i>${esc(teamN(t))}</span> · задача ${t.id} «${esc(t.text)}» · ${esc(COLS[colOf(p.stage)].name)}`, x, true);
    const ta = document.getElementById("pnote");
    ta.addEventListener("input", () => { try { localStorage.setItem(noteKey(id), ta.value) } catch (e) { } refreshAi(id) });
    refreshAi(id);
  }
  const noteKey = id => `bp-note-${D.epic}-${id}`;
  function refreshAi(id) { const a = side.querySelector('[data-ai="open"]'); if (a) a.href = "https://claude.ai/new?q=" + encodeURIComponent(aiPrompt(id)) }
  function aiPrompt(id) {
    const p = PROC[id], t = TASK[p.task]; let note = ""; try { note = localStorage.getItem(noteKey(id)) || "" } catch (e) { }
    const nm = x => PROC[x] ? PROC[x].text : x;
    let n = 0; const steps = p.steps.map(s => `${++n}. ${s.branch ? `[${s.branch}] ` : ""}${D.parts[s.src][0]} → ${D.parts[s.dst][0]}: ${s.text}`);
    return `Ты — системный аналитик. Проведи системную аналитику процесса инициативы «${D.title}».

Процесс: ${p.text}
Задача ${t.id} «${t.text}», команда: ${teamN(t)}, шаг пути: ${COLS[colOf(p.stage)].name}.
Было: ${p.before || "—"}. Станет: ${p.after || "—"}.
До: ${D.links.filter(l => l.dst === id).map(l => `${nm(l.src)} (${l.what})`).join("; ") || "—"}.
После: ${D.links.filter(l => l.src === id).map(l => `${nm(l.dst)} (${l.what})`).join("; ") || "—"}.

Что требуется (из БФТ):
${p.criteria.map(c => `- ${c.text} (${c.source})`).join("\n") || "—"}

Как устроено по БФТ:
${steps.join("\n") || "—"}

Открытые вопросы:
${[...qOf(id), ...qOf(p.task)].map(q => `- ${q.kind === "блокер" ? "БЛОКЕР: " : ""}${q.text} (кому: ${q.to})`).join("\n") || "—"}
${note ? `\nЗаметка техлида: ${note}\n` : ""}
Источник: БФТ ${D.epic}${p.source ? `, ${p.source}` : ""}.

Задача:
1) найди пробелы, противоречия и неявные зависимости в процессе;
2) опиши альтернативные и ошибочные сценарии, которых нет в БФТ;
3) предложи, какие состояния, данные и интеграции нужны — помечай это как гипотезу для СА;
4) сформулируй вопросы «кому — что», без которых процесс не запустить.`;
  }

  /* ---------- sequence: участники слева направо, справа от пунктира — скрыто от гостя ---------- */
  const hiddenKind = k => "sx".includes(D.parts[k][1]);
  const isHidden = s => hiddenKind(s.src) || hiddenKind(s.dst);
  function hiddenSteps(p) { return p.steps.map((s, i) => [i + 1, s]).filter(([, s]) => isHidden(s)) }
  function seqSVG(p) {
    const order = { p: 0, i: 1, s: 2, x: 3 };
    const P = [...new Set(p.steps.flatMap(s => [s.src, s.dst]))].sort((a, b) => order[D.parts[a][1]] - order[D.parts[b][1]]);
    const CW = 150, X0 = 20, cx = k => X0 + CW * P.indexOf(k) + CW / 2;
    const W = Math.max(X0 * 2 + CW * P.length, ...p.steps.filter(s => s.src === s.dst).map(s => cx(s.src) + 40 + s.text.length * 6.3 + X0));
    const rows = []; let cur = "";
    p.steps.forEach(s => { const br = s.branch || ""; if (br !== cur) { if (cur.startsWith("если") && !br.startsWith("иначе")) rows.push({ end: 1 }); if (cur.startsWith("иначе")) rows.push({ end: 1 }); if (br) rows.push({ br }); cur = br } rows.push({ s }) });
    if (cur) rows.push({ end: 1 });
    const H = 70 + rows.reduce((a, r) => a + (r.s ? (r.s.src === r.s.dst ? 40 : 34) : r.br ? 24 : 8), 0) + 16;
    const vis = P.findIndex(k => hiddenKind(k));
    let s = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;max-width:100%" role="img" aria-label="Как устроен процесс"><defs><marker id="sq" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#3a3a3a"/></marker></defs>`;
    if (vis > 0) { const xv = X0 + CW * vis; s += `<rect x="${xv}" y="0" width="${W - xv}" height="${H}" fill="#f1f3f7"/><line x1="${xv}" y1="0" x2="${xv}" y2="${H}" stroke="#7d7a73" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${xv + 6}" y="${H - 6}" font-size="10.5" fill="#7d7a73">за линией видимости — скрыто от гостя</text>` }
    P.forEach(k => {
      const x = cx(k), [n, t] = D.parts[k];
      s += `<line x1="${x}" y1="44" x2="${x}" y2="${H - 20}" stroke="#c9c4ba" stroke-dasharray="3 4"/>`;
      s += t === "p" ? `<circle cx="${x}" cy="14" r="7" fill="none" stroke="#1c1c1c" stroke-width="1.5"/><path d="M${x - 11},34 q11,-14 22,0" fill="none" stroke="#1c1c1c" stroke-width="1.5"/><text x="${x}" y="46" font-size="12" font-weight="700" text-anchor="middle">${esc(n)}</text>`
        : `<rect x="${x - 64}" y="8" width="128" height="30" rx="7" fill="${t === "i" ? "#e5f3f4" : t === "x" ? "#f3f1ec" : "#e7edf8"}" stroke="${t === "i" ? "#0f8b8d" : t === "x" ? "#9a958c" : "#2563c9"}" stroke-width="1.2"/><text x="${x}" y="27" font-size="11.5" font-weight="700" text-anchor="middle">${esc(n.length > 20 ? n.slice(0, 19) + "…" : n)}</text>`;
    });
    let y = 70, num = 0, top = 0; const xs = P.map(cx), L = Math.min(...xs) - 50, Rr = Math.max(...xs) + 50;
    rows.forEach(r => {
      if (r.br) { if (r.br.startsWith("если")) top = y; else s += `<line x1="${L}" y1="${y + 2}" x2="${Rr}" y2="${y + 2}" stroke="#9a958c" stroke-dasharray="5 4"/>`; s += `<text x="${L + 6}" y="${y + 16}" font-size="10.5" font-weight="800" fill="#6b6b6b">${esc(r.br.replace(/^если:\s*/, "ЕСЛИ ").replace(/^иначе:\s*/, "ИНАЧЕ "))}</text>`; y += 24; return }
      if (r.end) { s += `<rect x="${L}" y="${top}" width="${Rr - L}" height="${y - top + 4}" rx="6" fill="none" stroke="#9a958c"/>`; y += 8; return }
      const m = r.s; num++; const xa = cx(m.src), xb = cx(m.dst), hid = isHidden(m), col = hid ? "#2563c9" : "#1c1c1c", red = U(m.text);
      const badge = x => `<circle cx="${x}" cy="${y}" r="8" fill="${hid ? "#2563c9" : "#2f6b2a"}"/><text x="${x}" y="${y + 3.5}" font-size="9.5" font-weight="800" fill="#fff" text-anchor="middle">${num}</text>`;
      if (m.src === m.dst) { s += `<path d="M${xa},${y} h28 v16 h-26" fill="none" stroke="${col}" stroke-width="1.4" marker-end="url(#sq)"/><text x="${xa + 34}" y="${y + 12}" font-size="11.5" fill="${red ? "#c0392b" : col}">${esc(m.text)}</text>` + badge(xa - 12); y += 40; return }
      const dir = xb > xa ? 1 : -1;
      s += `<line x1="${xa}" y1="${y}" x2="${xb - dir * 2}" y2="${y}" stroke="${col}" stroke-width="1.4" ${m.kind === "ответ" ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#sq)"/><text x="${(xa + xb) / 2}" y="${y - 6}" font-size="11.5" text-anchor="middle" fill="${red ? "#c0392b" : col}">${esc(m.text)}</text>` + badge(xa + dir * 14);
      y += 34;
    });
    return s + "</svg>";
  }

  /* ---------- IDEF0: вход слева, выход справа, регуляторы сверху, механизмы снизу ---------- */
  function idef0(t) {
    const f = t.idef, bh = Math.max(130, 58 * Math.max(f.in.length, f.out.length)), W = 560, H = 340 + bh, bx = 195, by = 170, bw = 170, col = t.team === "?" ? "#c0392b" : getComputedStyle(document.documentElement).getPropertyValue(TEAM[t.team].c.slice(4, -1)).trim();
    const red = x => U(x) ? "#c0392b" : "#1c1c1c";
    const tsp = (ls, x, dy) => ls.map((l, i) => `<tspan x="${x}" dy="${i ? dy : 0}">${esc(l)}</tspan>`).join("");
    let s = `<svg class="idef" viewBox="0 0 ${W} ${H}" role="img" aria-label="IDEF0"><defs><marker id="ia" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1c1c1c"/></marker></defs><rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#faf9f6"/>`;
    const cap = (x, y, txt, a) => `<text x="${x}" y="${y}" font-size="11" font-weight="700" fill="#6b6b6b" letter-spacing=".6" text-anchor="${a}">${txt}</text>`;
    s += cap(8, by - 14, "ВХОД", "start") + cap(W - 8, by - 14, "ВЫХОД", "end") + cap(W / 2, 14, "РЕГУЛЯТОРЫ — правила и ограничения", "middle") + cap(W / 2, H - 6, "МЕХАНИЗМЫ — кто и чем исполняет", "middle");
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="#fff" stroke="${col}" stroke-width="2.2" ${t.team === "?" ? 'stroke-dasharray="6 3"' : ""}/><rect x="${bx}" y="${by}" width="${bw}" height="6" fill="${col}"/>`;
    const fl = wrapT(t.text, 18).slice(0, 5); s += `<text x="${bx + bw / 2}" y="${by + bh / 2 - (fl.length - 1) * 8 + 4}" font-size="13.5" font-weight="700" text-anchor="middle">${tsp(fl, bx + bw / 2, 16)}</text><text x="${bx + bw - 6}" y="${by + bh - 6}" font-size="11" fill="#6b6b6b" text-anchor="end">A${esc(t.id)}</text>`;
    f.in.forEach((v, i) => { const y = by + bh * (i + 1) / (f.in.length + 1), ls = wrapT(v, 22).slice(0, 3); s += `<path d="M8,${y} H${bx}" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#ia)"/><text x="8" y="${y - 6 - (ls.length - 1) * 15}" font-size="13" fill="${red(v)}">${tsp(ls, 8, 15)}</text>` });
    f.out.forEach((v, i) => { const y = by + bh * (i + 1) / (f.out.length + 1), ls = wrapT(v, 22).slice(0, 3); s += `<path d="M${bx + bw},${y} H${W - 8}" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#ia)"/><text x="${bx + bw + 8}" y="${y - 6 - (ls.length - 1) * 15}" font-size="13" fill="${red(v)}">${tsp(ls, bx + bw + 8, 15)}</text>` });
    const sideTxt = (arr, topSide) => { const k = arr.length, sl = W / k; arr.forEach((v, i) => { const ax = bx + bw * (i + 1) / (k + 1), tx = sl * i + sl / 2, ls = wrapT(v, Math.max(14, Math.floor(sl / 7.6))).slice(0, 4);
      s += topSide ? `<path d="M${tx},102 L${tx},116 L${ax},136 L${ax},${by}" fill="none" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#ia)"/><text x="${tx}" y="34" font-size="13" text-anchor="middle" fill="${red(v)}">${tsp(ls, tx, 15)}</text>`
        : `<path d="M${tx},${H - 76} L${tx},${H - 90} L${ax},${by + bh + 26} L${ax},${by + bh}" fill="none" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#ia)"/><text x="${tx}" y="${H - 58}" font-size="13" text-anchor="middle" fill="${red(v)}">${tsp(ls, tx, 15)}</text>` }) };
    sideTxt(f.ctl, true); sideTxt(f.mech, false);
    return s + "</svg>";
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
      if (ai.dataset.ai === "open") { ai.href = "https://claude.ai/new?q=" + encodeURIComponent(aiPrompt(ai.dataset.id)); return }
      const txt = aiPrompt(ai.dataset.id), done = () => ai.textContent = "Скопировано ✓";
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(done).catch(() => { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done() } catch (er) { } ta.remove() });
      return;
    }
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
  window.BPMAP = { aiPrompt, openProc, openTask, openSeen };
})();
