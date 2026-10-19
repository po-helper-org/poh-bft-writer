/* bft-blueprint · история через экраны. Данные — #story-data (собирает bft-story-render.py).
   Стандарт формы — resources/story_line.md: карточка шага = картинка · контур · заголовок · пояснение. */
(function () {
  "use strict";
  const D = JSON.parse(document.getElementById("story-data").textContent);
  const { esc, chip } = BPK;
  const chips = ids => [...new Set(ids.map(id => D.screens[id].contour))].map(chip).join(" ");
  const openQ = D.questions.filter(q => q.open);
  const qAt = where => D.questions.filter(q => q.where === where);
  const hasOpen = where => openQ.some(q => q.where === where);

  /* ---------- упрощённый экран: крупно, только главное ---------- */
  const mock = id => BPK.mockSVG(D.screens[id], `${D.screens[id].contour}: ${D.stepsByScreen[id] || ""}`);
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
