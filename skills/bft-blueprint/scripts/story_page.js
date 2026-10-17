/* bft-blueprint · история через экраны. Данные — #story-data (собирает bft-story-render.py).
   Стандарт формы — resources/story_line.md: карточка шага = картинка · контур · заголовок · пояснение. */
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("story-data").textContent);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const openQ = D.questions.filter(q => q.open);
  const qAt = where => D.questions.filter(q => q.where === where);
  const hasOpen = where => openQ.some(q => q.where === where);

  /* ---------- контур: иконка по ключевому слову ---------- */
  const ICON = {
    web: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M2 6h12"/>',
    mail: '<rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5 8 9l5.5-4.5"/>',
    bell: '<path d="M4 11V7a4 4 0 0 1 8 0v4l1 1H3z"/><path d="M6.8 13.6a1.4 1.4 0 0 0 2.4 0"/>',
    sms: '<path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H6l-3 2.5V11a1.5 1.5 0 0 1-.5-1z"/>',
    ticket: '<path d="M2 5V3.5h12V5a1.5 1.5 0 0 0 0 3 1.5 1.5 0 0 0 0 3v1.5H2V11a1.5 1.5 0 0 0 0-3 1.5 1.5 0 0 0 0-3z"/><path d="M6 4v8" stroke-dasharray="1.5 1.5"/>',
    scan: '<path d="M2 5V3h3M11 3h3v2M14 11v2h-3M5 13H2v-2"/><path d="M5 6v4M7 6v4M9.5 6v4M11 6v4"/>',
    app: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>',
    pin: '<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/>',
    call: '<path d="M3 2.5h3l1.2 3-1.7 1.2a8 8 0 0 0 3.8 3.8l1.2-1.7 3 1.2v3a1 1 0 0 1-1 1A11 11 0 0 1 2 3.5a1 1 0 0 1 1-1z"/>',
    chat: '<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>',
    dot: '<circle cx="8" cy="8" r="3"/>'
  };
  function contourIcon(c) {
    const s = c.toLowerCase();
    const rules = [[/sms|смс/, "sms"], [/email|e-mail|письм/, "mail"], [/push|пуш|оповещ|уведомл/, "bell"], [/витрин|сайт/, "web"],
      [/билет/, "ticket"], [/сканер/, "scan"], [/приложен/, "app"], [/офлайн/, "pin"], [/звонок/, "call"], [/чат/, "chat"]];
    for (const [re, k] of rules) if (re.test(s)) return k;
    return "dot";
  }
  const chip = c => `<span class="ctr"><svg viewBox="0 0 16 16" aria-hidden="true">${ICON[contourIcon(c)]}</svg>${esc(c)}</span>`;
  const chips = ids => [...new Set(ids.map(id => D.screens[id].contour))].map(chip).join(" ");

  /* ---------- упрощённый экран: крупно, только главное ---------- */
  function wrapT(t, n) { const w = String(t).split(" "); const o = []; let c = ""; for (const x of w) { if ((c + " " + x).trim().length > n) { if (c) o.push(c); c = x } else c = (c + " " + x).trim() } if (c) o.push(c); return o }
  function mock(id) {
    const t = D.screens[id], W = 150, H = 250, ink = "#1f1f1f", g = "#9a958c", OF = "#6b3fd4", P = 11, IW = W - 2 * P;
    const T = (x, yy, s, fs, fw, fill, a) => `<text x="${x}" y="${yy}" font-size="${fs}" font-weight="${fw || 400}" fill="${fill || ink}"${a ? ` text-anchor="${a}"` : ""}>${esc(s)}</text>`;
    const label = `${t.contour}: ${D.stepsByScreen[id] || ""}`;
    if (t.view === "неизвестен") {
      return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} — не определён"><rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="20" fill="#fdf3f2" stroke="#c0392b" stroke-width="1.6" stroke-dasharray="6 4"/><circle cx="${W / 2}" cy="${H / 2 - 14}" r="20" fill="#c0392b"/>${T(W / 2, H / 2 - 6, "?", 24, 800, "#fff", "middle")}${wrapT(t.contour, 16).map((l, i) => T(W / 2, H / 2 + 30 + i * 14, l, 11, 600, "#c0392b", "middle")).join("")}${T(W / 2, H / 2 + 30 + wrapT(t.contour, 16).length * 14, "не определён", 11, 600, "#c0392b", "middle")}</svg>`;
    }
    let y, out = "", frame;
    if (t.device === "web") { y = 26; frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10" fill="#fff" stroke="#2b2b2b" stroke-width="1.5"/><path d="M1,11 a10,10 0 0 1 10,-10 h${W - 22} a10,10 0 0 1 10,10 v7 h-${W - 2}z" fill="#efede8"/>` + [0, 1, 2].map(i => `<circle cx="${10 + i * 7}" cy="10" r="2.2" fill="#bdb8af"/>`).join("") }
    else if (t.device === "mail") { y = 12; frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10" fill="#fff" stroke="#2b2b2b" stroke-width="1.5"/>` }
    else if (t.device === "lock") { y = 78; frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="22" fill="#e6e2db" stroke="#2b2b2b" stroke-width="1.5"/><rect x="${W / 2 - 20}" y="7" width="40" height="7" rx="3.5" fill="#2b2b2b"/>` + T(W / 2, 56, "09:41", 30, 300, "#555", "middle") }
    else { y = 24; frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="22" fill="#fff" stroke="#2b2b2b" stroke-width="1.5"/><rect x="${W / 2 - 20}" y="7" width="40" height="7" rx="3.5" fill="#2b2b2b"/>` }
    for (const it of t.el) {
      const k = it[0];
      if (k === "from") { out += `<path d="M${P},${y} h18 v12 h-18z M${P},${y} l9,7 l9,-7" fill="none" stroke="${g}" stroke-width="1.3"/>` + T(P + 24, y + 10, it[1], 10, 600, g); y += 22 }
      else if (k === "hdr") { const ok = it[1].startsWith("✓ "); out += ok ? `<circle cx="${P + 7}" cy="${y + 7}" r="7" fill="${ink}"/><path d="M${P + 3.5},${y + 7} l2.5,2.5 l4.5,-5" fill="none" stroke="#fff" stroke-width="1.8"/>` + T(P + 19, y + 11.5, it[1].slice(2), 12, 700) : T(P, y + 11.5, it[1], 12, 700); y += 22 }
      else if (k === "text") { wrapT(it[1], 22).forEach(l => { out += T(P, y + 11, l, 10.5, 400, g); y += 13 }); y += 5 }
      else if (k === "offer") { const ls = wrapT(it[1], 13), h = ls.length * 16 + 16; out += `<rect x="${P}" y="${y}" width="${IW}" height="${h}" rx="9" fill="${OF}"/>`; ls.forEach((l, i) => out += T(P + 10, y + 20 + i * 16, l, 13, 800, "#fff")); y += h + 9 }
      else if (k === "cta" || k === "cta2") { const fs = it[1].length > 16 ? 9.5 : 11; out += `<rect x="${P}" y="${y}" width="${IW}" height="26" rx="13" fill="${k === "cta" ? ink : "#fff"}" stroke="${ink}" stroke-width="1.2"/>` + T(W / 2, y + 17, it[1], fs, 700, k === "cta" ? "#fff" : ink, "middle"); y += 32 }
      else if (k === "link") { out += T(P, y + 12, it[1], 11, 700, ink) + `<line x1="${P}" y1="${y + 15}" x2="${P + Math.min(IW, it[1].length * 6)}" y2="${y + 15}" stroke="${ink}"/>`; y += 22 }
      else if (k === "tiles") { const tw = (IW - 8) / 2; [0, 1].forEach(i => { const x = P + i * (tw + 8); out += `<rect x="${x}" y="${y}" width="${tw}" height="58" rx="7" fill="#fff" stroke="#d6d2ca"/><rect x="${x + 5}" y="${y + 5}" width="${tw - 10}" height="24" rx="4" fill="#ece9e3"/><rect x="${x + 5}" y="${y + 35}" width="${tw - 22}" height="6" rx="3" fill="#cfcac0"/><rect x="${x + 5}" y="${y + 46}" width="${tw - 34}" height="5" rx="2.5" fill="#e3dfd8"/><rect x="${x + tw - 27}" y="${y + 8}" width="22" height="13" rx="6.5" fill="${OF}"/>` }); y += 66 }
      else if (k === "rows" || k === "rowsOffer") { for (let i = 0; i < it[1]; i++) { out += `<rect x="${P}" y="${y}" width="26" height="26" rx="5" fill="#ece9e3"/><rect x="${P + 33}" y="${y + 5}" width="58" height="6" rx="3" fill="#cfcac0"/><rect x="${P + 33}" y="${y + 16}" width="40" height="5" rx="2.5" fill="#e3dfd8"/>`; if (k === "rowsOffer") out += `<rect x="${W - P - 28}" y="${y + 6}" width="28" height="14" rx="7" fill="${OF}"/>`; y += 34 } }
      else if (k === "chips") { let x = P; it[1].forEach(c => { const w = c.length * 6 + 14; if (x + w > W - P) return; out += `<rect x="${x}" y="${y}" width="${w}" height="20" rx="10" fill="#fff" stroke="#9a958c"/>` + T(x + 7, y + 14, c, 10, 600); x += w + 5 }); y += 30 }
      else if (k === "kv") { out += T(P, y + 12, it[1], 10.5, 400, g) + T(W - P, y + 12, it[2], 11, 700, ink, "end") + `<line x1="${P}" y1="${y + 19}" x2="${W - P}" y2="${y + 19}" stroke="#eee"/>`; y += 24 }
      else if (k === "img") { out += `<rect x="${P}" y="${y}" width="${IW}" height="56" rx="7" fill="#ece9e3"/><path d="M${P + 20},${y + 44} l18,-20 l14,14 l10,-9 l18,15z" fill="#d6d1c8"/>`; y += 64 }
      else if (k === "camera") { out += `<rect x="${P}" y="${y}" width="${IW}" height="112" rx="8" fill="#2b2b2b"/>`;[[P + 10, y + 10, 1, 1], [W - P - 10, y + 10, -1, 1], [P + 10, y + 102, 1, -1], [W - P - 10, y + 102, -1, -1]].forEach(([x, yy, dx, dy]) => out += `<path d="M${x},${yy + 14 * dy} V${yy} H${x + 14 * dx}" fill="none" stroke="#fff" stroke-width="2.4"/>`); for (let i = 0; i < 20; i++) out += `<rect x="${P + 28 + i * 4.3}" y="${y + 38}" width="${i % 3 ? 1.4 : 2.8}" height="36" fill="#fff"/>`; y += 120 }
      else if (k === "ok" || k === "no") { const cx = W / 2, cy = y + 30, col = k === "ok" ? "#2f6b2a" : "#c0392b"; out += `<circle cx="${cx}" cy="${cy}" r="24" fill="${col}"/>` + (k === "ok" ? `<path d="M${cx - 11},${cy} l8,8 l14,-15" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M${cx - 9},${cy - 9} l18,18 M${cx + 9},${cy - 9} l-18,18" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>`); y += 64; out += T(cx, y + 6, it[1], 14, 800, k === "ok" ? ink : "#c0392b", "middle"); y += 22 }
      else if (k === "barcode") { out += `<rect x="${P}" y="${y}" width="${IW}" height="70" rx="8" fill="#fff" stroke="#d6d2ca"/>`; for (let i = 0; i < 24; i++) out += `<rect x="${P + 14 + i * 4.6}" y="${y + 12}" width="${i % 3 ? 1.5 : 3}" height="46" fill="${ink}"/>`; y += 80 }
      else if (k === "notif") { const tl = wrapT(it[2], 17), ls = wrapT(it[3], 20), h = 34 + tl.length * 15 + ls.length * 13; out += `<rect x="${P - 3}" y="${y}" width="${IW + 6}" height="${h}" rx="12" fill="#fff"/><rect x="${P + 5}" y="${y + 8}" width="16" height="16" rx="4" fill="${OF}"/>` + T(P + 26, y + 20, it[1], 9.5, 600, g); tl.forEach((l, i) => out += T(P + 5, y + 42 + i * 15, l, 11.5, 800)); ls.forEach((l, i) => out += T(P + 5, y + 42 + tl.length * 15 + i * 13, l, 10.5, 400, "#444")); y += h + 10 }
    }
    const alt = t.view === "альтернативный" ? `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${t.device === "web" || t.device === "mail" ? 10 : 22}" fill="none" stroke="#c0392b" stroke-width="2.2"/>` : "";
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${frame}${out}${alt}</svg>`;
  }
  const scrHTML = id => `<span class="scr">${hasOpen(id) ? '<span class="dot" title="Открытый вопрос — подробности по клику"></span>' : ""}${mock(id)}</span>`;

  /* ---------- карточки ---------- */
  const persona = id => D.personas.find(p => p.id === id);
  function bigOf(v) { const m = String(v || "").split("·"), big = (m[0] || "").trim(); return /^[—–-]?$/.test(big) ? { big: "", cap: "" } : { big, cap: m.slice(1).join("·").trim() } }
  function cardHTML(s) {
    const dot = hasOpen(s.id) ? '<span class="dot" title="Открытый вопрос"></span>' : "";
    if (s.kind === "intro" || s.kind === "final") {
      const p = persona(s.persona), b = bigOf(s.kind === "intro" ? p.before : p.after);
      return `<div class="tale ${s.kind}" data-k="${s.id}" role="button" tabindex="0">${dot}<div class="beat">${s.kind === "intro" ? "Знакомьтесь" : "И с тех пор"}</div>${b.big ? `<div class="big">${esc(b.big)}</div>${b.cap ? `<div class="bigc">${esc(b.cap)}</div>` : ""}` : ""}<b class="ttl">${esc(s.title)}</b><p class="txt">${esc(s.text)}</p>${s.was ? `<div class="was"><b>Раньше</b>${esc(s.was)}</div>` : ""}</div>`;
    }
    if (s.kind === "band") {
      return `<div class="band" data-k="${s.id}" role="button" tabindex="0">${dot}<div class="beat">Шаг ${s.n} · ${esc(s.span)}</div><b class="ttl">${esc(s.title)}</b><p class="txt">${esc(s.text)}</p></div>`;
    }
    const w = s.screens.length * 170 + (s.screens.length - 1) * 14 + 28 + 24;
    return `<div class="sf" data-k="${s.id}" role="button" tabindex="0" style="width:${w}px"><span class="stepn">${s.n}</span>${dot}<div class="sfr">${s.screens.map(scrHTML).join("")}</div>${chips(s.screens)}<b class="ttl">${esc(s.title)}</b><p class="txt">${esc(s.text)}</p></div>`;
  }

  /* ---------- холст ---------- */
  const NC = D.stages.length + 2;
  const grid = document.getElementById("grid");
  grid.style.gridTemplateColumns = `150px repeat(${NC}, max-content)`;
  const heads = ["Было", ...D.stages.map(s => `${s.id} · ${s.name}${s.when ? " · " + s.when : ""}`), "Стало"];
  let h = `<div class="sh corner"></div>` + heads.map(x => `<div class="sh">${esc(x)}</div>`).join("");
  D.personas.forEach((p, pi) => {
    const rc = "row" + (pi % 2);
    h += `<div class="ln ${rc}">${esc(p.lane)}<small>${esc(p.name)}</small></div>`;
    const steps = D.steps.filter(s => s.persona === p.id);
    for (let c = 0; c < NC; c++) {
      const band = steps.find(s => s.kind === "band" && s.c0 === c);
      if (band) { h += `<div class="${rc}" style="grid-column:span ${band.c1 - band.c0 + 1}">${cardHTML(band)}</div>`; c = band.c1; continue }
      const here = steps.filter(s => s.kind !== "band" && s.c0 === c);
      h += `<div class="${rc}"><div class="cell">${here.map(cardHTML).join("")}</div></div>`;
    }
  });
  grid.innerHTML = h;

  /* стрелки истории: шаг за шагом слева направо */
  function drawLinks() {
    grid.querySelector("svg.links")?.remove();
    const g = grid.getBoundingClientRect();
    const box = el => { const r = el.getBoundingClientRect(); return { l: r.left - g.left, r: r.right - g.left, t: r.top - g.top, b: r.bottom - g.top } };
    const yOf = (el, B) => el.classList.contains("band") ? (B.t + B.b) / 2 : B.t + Math.min(150, (B.b - B.t) / 2);
    let s = `<svg class="links" width="${grid.scrollWidth}" height="${grid.scrollHeight}"><defs><marker id="ms" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#2f6b2a"/></marker></defs>`;
    D.personas.forEach(p => {
      const ids = D.steps.filter(x => x.persona === p.id).map(x => x.id);
      for (let i = 0; i + 1 < ids.length; i++) {
        const ea = grid.querySelector(`[data-k="${ids[i]}"]`), eb = grid.querySelector(`[data-k="${ids[i + 1]}"]`);
        if (!ea || !eb) continue;
        const A = box(ea), B = box(eb), ya = yOf(ea, A), yb = yOf(eb, B);
        if (B.l <= A.r) continue;
        const pts = Math.abs(ya - yb) < 3 ? [[A.r, ya], [B.l, yb]] : [[A.r, ya], [B.l - 16, ya], [B.l - 16, yb], [B.l, yb]];
        s += `<polyline points="${pts.map(q => q.join(",")).join(" ")}" fill="none" stroke="#2f6b2a" stroke-width="2.2" marker-end="url(#ms)"/>`;
      }
    });
    grid.insertAdjacentHTML("beforeend", s + "</svg>");
  }
  drawLinks();
  window.addEventListener("resize", drawLinks);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawLinks);

  /* ---------- легенда и открытые вопросы ---------- */
  const usedContours = [...new Set(Object.keys(D.screens).filter(id => D.stepsByScreen[id]).map(id => D.screens[id].contour))];
  document.getElementById("legend").innerHTML =
    `<span class="t">Контуры</span>${usedContours.map(chip).join("")}<span class="t">Знаки</span>` +
    `<span><span class="dot inl"></span>открытый вопрос</span><span><span class="alt"></span>альтернативный экран</span><span><span class="wait"></span>ждёт, пока действует другой</span>`;
  const stepOf = where => D.steps.find(s => s.id === where) || D.steps.find(s => s.screens.includes(where));
  document.getElementById("qs").innerHTML = `<h2>Открытые вопросы · ${openQ.length}</h2>` + (openQ.length
    ? `<table><tr><th>ID</th><th>Кому</th><th>Вопрос</th><th>Где</th></tr>${openQ.map(q => { const s = stepOf(q.where); return `<tr><td>${q.id}</td><td>${esc(q.to)}</td><td>${esc(q.text)}</td><td>${s ? `<a href="#" data-go="${s.id}">${esc(persona(s.persona).lane)} · ${s.n ? "шаг " + s.n : s.kind === "intro" ? "было" : "стало"}</a>` : "—"}</td></tr>` }).join("")}</table>`
    : `<p class="none">Нет — история согласуется без уточнений.</p>`);

  /* ---------- панель шага ---------- */
  const pn = document.getElementById("pn");
  function stepLabel(s) { return s.kind === "intro" ? "Знакомьтесь" : s.kind === "final" ? "И с тех пор" : `Шаг ${s.n} · ${s.span}` }
  function openPanel(id) {
    const s = D.steps.find(x => x.id === id); if (!s) return;
    const p = persona(s.persona);
    const qs = [...qAt(s.id), ...s.screens.flatMap(qAt)];
    pn.innerHTML = `<button class="x" aria-label="Закрыть">×</button><div class="k">${esc(p.lane)} · ${esc(stepLabel(s))}</div><h2>${esc(s.title)}</h2>` +
      (s.screens.length ? `<div>${chips(s.screens)}</div><div class="vis">${s.screens.map(scrHTML).join("")}</div>` : "") +
      `<p class="txt">${esc(s.text)}</p>${s.was ? `<div class="was"><b>Раньше</b>${esc(s.was)}</div>` : ""}` +
      (qs.length ? `<h3>Вопросы</h3><ul>${qs.map(q => `<li>${q.open ? '<span class="dot inl"></span>' : ""}<b>${esc(q.to)}:</b> ${esc(q.text)}${q.open ? "" : ` <span class="ans">— ${esc(q.answer)}</span>`}</li>`).join("")}</ul>` : "") +
      `<h3>Источник в БФТ</h3><div class="src">${esc(s.source)}${s.screens.map(x => `<br>${x}: ${esc(D.screens[x].source)}`).join("")}</div>`;
    document.body.classList.add("panel");
  }
  const closePanel = () => document.body.classList.remove("panel");
  document.getElementById("scrim").addEventListener("click", closePanel);

  /* ---------- история по шагам ---------- */
  let showP = D.personas[0].id, showI = 0;
  const show = document.getElementById("show");
  function scene() {
    const steps = D.steps.filter(s => s.persona === showP), s = steps[showI], p = persona(showP);
    const b = s.kind === "intro" || s.kind === "final" ? bigOf(s.kind === "intro" ? p.before : p.after) : null;
    const vis = s.screens.length ? `<div class="vis${s.screens.length > 1 ? " two" : ""}">${s.screens.map(scrHTML).join("")}</div>`
      : b && b.big ? `<div><div class="big">${esc(b.big)}</div><div class="bigc">${esc(b.cap)}</div></div>` : `<div></div>`;
    show.querySelector(".stage").innerHTML = `<div class="scene ${s.kind}">${vis}<div><div class="n">${esc(stepLabel(s))}</div><h2>${esc(s.title)}</h2><p class="say">${esc(s.text)}</p>${s.was ? `<div class="before"><b>Раньше</b><span>${esc(s.was)}</span></div>` : ""}${s.screens.length ? `<div style="margin-top:14px">${chips(s.screens)}</div>` : ""}</div></div>`;
    show.querySelector(".who").innerHTML = D.personas.map(x => `<button data-p="${x.id}" class="${x.id === showP ? "on" : ""}">${esc(x.lane)}</button>`).join("");
    show.querySelector(".dots").innerHTML = steps.map((_, i) => `<i class="${i === showI ? "on" : ""}"></i>`).join("");
    show.querySelector(".prev").disabled = showI === 0;
    show.querySelector(".next").disabled = showI === steps.length - 1;
  }
  function openShow(pid, i) { showP = pid; showI = i || 0; document.body.classList.add("showing"); scene() }
  function step(d) { const n = D.steps.filter(s => s.persona === showP).length; showI = Math.max(0, Math.min(n - 1, showI + d)); scene() }
  document.getElementById("play").addEventListener("click", () => openShow(D.personas[0].id, 0));
  show.addEventListener("click", e => {
    if (e.target.closest(".x")) document.body.classList.remove("showing");
    else if (e.target.closest(".prev")) step(-1);
    else if (e.target.closest(".next")) step(1);
    else { const b = e.target.closest("[data-p]"); if (b) openShow(b.dataset.p, 0) }
  });
  let tx = null;
  show.addEventListener("touchstart", e => { tx = e.touches[0].clientX }, { passive: true });
  show.addEventListener("touchend", e => { if (tx === null) return; const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); tx = null });

  /* ---------- клики и клавиатура ---------- */
  document.addEventListener("click", e => {
    const go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); openPanel(go.dataset.go); return }
    if (e.target.closest(".pn .x")) { closePanel(); return }
    const card = e.target.closest("#grid [data-k]");
    if (card) openPanel(card.dataset.k);
  });
  document.addEventListener("keydown", e => {
    if (document.body.classList.contains("showing")) {
      if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1); else if (e.key === "Escape") document.body.classList.remove("showing");
      return;
    }
    if (e.key === "Escape") closePanel();
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("#grid [data-k]")) { e.preventDefault(); openPanel(e.target.dataset.k) }
  });
})();
