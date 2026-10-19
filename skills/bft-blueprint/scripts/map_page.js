/* bft-blueprint · карта инициативы. Данные — #map-data (собирает bft-backlog-build.py из проекта Backlog.md).
   Три слоя чтения: «Что видят» (история), «Что делаем» (задачи команд), «Как это работает»
   (Employee Actions, Technology, Backstage, Support). Подробности — по клику, в боковой панели. */
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
  const teamC = t => t.team === "?" || !TEAM[t.team] ? "var(--red)" : TEAM[t.team].c;
  const teamN = t => t.team === "?" || !TEAM[t.team] ? "Команда?" : TEAM[t.team].name;
  const TASK = {}; D.tasks.forEach(t => TASK[t.id] = t);
  const PROC = {}; D.cards.forEach(p => PROC[p.id] = p);
  const qOf = where => D.questions.filter(q => q.where === where && q.open);
  const asks = id => qOf(id).filter(q => q.kind === "вопрос").length;
  const blocks = id => qOf(id).filter(q => q.kind === "блокер");
  const scrOpen = id => D.storyQuestions.some(q => q.where === id);
  /* слои Service Blueprint: на виду у гостя — сотрудник и технологии; за линией видимости — Backstage; ниже — Support */
  const LAYER = { employee: ["Employee Actions", "действия сотрудника", "#a8541a"], technology: ["Technology", "что видит гость", "#0f8b8d"], backstage: ["Backstage", "за кадром", "#2563c9"], support: ["Support", "основа", "#6b5fb0"] };
  const PERSONA_ICON = ['<circle cx="8" cy="5.5" r="2.6"/><path d="M3 14c.6-3 2.6-4.5 5-4.5s4.4 1.5 5 4.5"/>', '<path d="M4 2v5a2 2 0 0 0 2 2v5M6 2v4M8 2v5a2 2 0 0 1-2 2M12 14V2c-1.5 1-2.5 3-2.5 5.5H12"/>'];
  const who = p => `<span class="who"><svg viewBox="0 0 16 16">${PERSONA_ICON[Math.min(1, D.personas.findIndex(x => x.id === p.id))]}</svg>${esc(p.name)}</span>`;
  const mock = (id, w) => `<span class="scrw" style="position:relative;display:block${w ? `;width:${w}px` : ""}">${scrOpen(id) ? '<span class="dot" style="top:-4px;right:-5px"></span>' : ""}${mockSVG(D.screens[id], D.screens[id].contour)}</span>`;

  /* ---------- шапка ---------- */
  const uniqBlk = [...new Set(D.questions.filter(q => q.open && q.kind === "блокер").map(q => q.text))];
  document.getElementById("blk").innerHTML = uniqBlk.length ? `<button class="mi blk" data-guide="blk"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M3.5 12.5l9-9"/></svg>Блокеры<b class="cnt">${uniqBlk.length}</b></button>` : "";
  const used = {}; D.tasks.forEach(t => used[t.team] = (used[t.team] || 0) + 1);
  const nTasks = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "задача" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "задачи" : "задач"}`;
  document.getElementById("teams").innerHTML = D.teams.filter(t => used[t.id]).map(t => `<button class="tchip" data-tf="${t.id}" style="--c:${TEAM[t.id].c}"><i></i>${esc(t.name)}<b>${nTasks(used[t.id])}</b></button>`).join("") +
    (used["?"] ? `<button class="tchip" data-tf="?" style="--c:var(--red)"><i class="u"></i>Команда не определена<b>${nTasks(used["?"])}</b></button>` : "");
  if (uniqBlk.length) document.getElementById("bdot").textContent = uniqBlk.length;

  /* ---------- меню: всё, что раньше было в шапке, — поверх карты ---------- */
  const burger = document.getElementById("burger");
  const menu = open => { body.classList.toggle("mopen", open); burger.setAttribute("aria-expanded", open); if (open) document.querySelector("#menu .play").focus() };
  /* фильтр по команде: подсветить её работу, на кнопке меню — чип с крестиком */
  function teamFilter(id) {
    document.querySelectorAll(".tchip").forEach(x => x.classList.toggle("on", x.dataset.tf === id));
    document.querySelectorAll(".wk,.hw").forEach(x => x.classList.toggle("dim", !!id && x.dataset.team !== id));
    const t = id && (id === "?" ? { name: "Команда не определена", c: "var(--red)" } : TEAM[id]);
    document.getElementById("fchip").innerHTML = t ? `<button class="fchip" data-tf-clear style="--c:${t.c}" aria-label="Снять фильтр"><i></i>${esc(t.name)}<span aria-hidden="true">×</span></button>` : "";
  }

  /* ---------- карточки ---------- */
  /* карточка «что видят» для ленты телефона: экран, персонаж, заголовок, две строки текста */
  const plural = (n, a, b, c) => n % 10 === 1 && n % 100 !== 11 ? a : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? b : c;
  function seenHTML(c) {
    return D.seen.filter(s => s.col === c).map(s => {
      const p = D.personas.find(x => x.id === s.persona), w = who(p);
      if (s.final) return `<div class="seen fin" data-seen="${s.key}" role="button" tabindex="0">${w}${s.big ? `<b class="big">${esc(s.big)}</b>` : ""}<b>${esc(s.title)}</b></div>`;
      const more = s.steps.length - 1;
      return `<div class="seen" data-seen="${s.key}" role="button" tabindex="0"><span class="th">${mock(s.steps[0].screens[0])}</span><div class="sx">${w}<b>${esc(s.steps[0].title)}</b><p>${esc(s.steps[0].text)}</p>${more ? `<span class="more">+${more} ${plural(more, "шаг", "шага", "шагов")}</span>` : ""}</div></div>`;
    }).join("");
  }
  function taskHTML(t) {
    const b = blocks(t.id).length, a = asks(t.id);
    return `<button class="wk${b ? " blk" : ""}" data-task="${t.id}" data-team="${t.team}" style="--c:${teamC(t)}"><span class="tm${t.team === "?" ? " u" : ""}"><i></i>${esc(teamN(t))}${b ? '<span class="bl">Блокер</span>' : a ? `<span class="qn" title="Открытых вопросов: ${a}">${a}</span>` : ""}</span><span class="tx">${esc(t.text)}</span></button>`;
  }
  function procHTML(p) {
    const b = blocks(p.id).length + blocks(p.task).length;
    return `<button class="hw ${p.layer}${b ? " blk" : ""}" data-proc="${p.id}" data-team="${p.team}" style="--c:${teamC(p)}"><span>${esc(p.text)}</span><i title="${esc(teamN(p))}"></i></button>`;
  }

  /* ---------- холст ---------- */
  grid.className = "map";
  grid.style.gridTemplateColumns = `96px repeat(${COLS.length}, minmax(224px, 1fr))`;
  grid.style.minWidth = `${96 + COLS.length * 236}px`;
  let h = `<div class="mh corner"></div>` + COLS.map((c, i) => `<div class="mh"><span class="n">${i === COLS.length - 1 ? "✓" : i + 1}</span><span class="hx"><b>${esc(c.name)}</b>${c.when ? `<small>${esc(c.when)}</small>` : ""}</span></div>`).join("");
  h += `<div class="ml do">Что делаем</div>` + COLS.map((col, c) => `<div class="mc do">${D.tasks.filter(t => t.stage === col.id).map(taskHTML).join("")}</div>`).join("");
  /* все четыре ряда — даже пустой: «сотрудника на виду у гостя нет» — тоже ответ */
  Object.keys(LAYER).forEach(l => {
    h += `<div class="ml hrow how l-${l}">${LAYER[l][0]}<small>${LAYER[l][1]}</small></div>` + COLS.map(col => `<div class="mc how l-${l}">${D.cards.filter(p => p.layer === l && p.stage === col.id).map(procHTML).join("")}</div>`).join("");
  });
  grid.innerHTML = h;

  /* стрелки между карточками — из ссылок в «Параметрах»: вход от карточки, выход к карточке */
  function drawLinks() {
    grid.querySelector("svg.hwl")?.remove();
    if (body.dataset.view !== "how") return;
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

  /* ---------- требования к экранам: документы «F3 · …» в backlog/docs/screens — вкладки и стек заметок ---------- */
  const IMG_MD = /^!\[(.*?)\]\((.+?)\)$/, SCR = {}, NOTE_OF = {};
  /* файл экрана: # заголовок, картинки до первой вкладки, ## вкладка, ### заметка, ниже — markdown */
  function parseNotes(text) {
    const doc = { title: "", images: [], tabs: [] }; let tab = null, note = null;
    text.split("\n").forEach(l => {
      let m;
      if (l.startsWith("### ")) { note = { title: l.slice(4).trim(), body: [] }; if (tab) tab.notes.push(note) }
      else if (l.startsWith("## ")) { tab = { name: l.slice(3).trim(), notes: [] }; doc.tabs.push(tab); note = null }
      else if (l.startsWith("# ")) doc.title = l.slice(2).trim();
      else if (note) note.body.push(l);
      else if (!tab && (m = l.trim().match(IMG_MD))) doc.images.push({ alt: m[1], src: m[2] });
    });
    doc.tabs.forEach(t => t.notes.forEach(n => n.md = n.body.join("\n").trim()));
    return doc;
  }
  Object.keys(D.notes || {}).forEach(id => { SCR[id] = parseNotes(D.notes[id]); NOTE_OF[id] = id; SCR[id].images.forEach(im => { const k = im.src.replace(/^screen:/, ""); if (im.src.startsWith("screen:") && !NOTE_OF[k]) NOTE_OF[k] = id }) });
  const imgSrc = s => s.startsWith("screen:") && D.screens[s.slice(7)] ? screenImg(s.slice(7)) : s;
  const mdInline = s => esc(s).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\[УТОЧНИТЬ у ([^\]]+)\]/g, '<mark>? $1</mark>');
  function mdHTML(text) {
    let k = -1;
    return text.split(/\n{2,}/).map(block => {
      const lines = block.split("\n"), im = block.trim().match(IMG_MD);
      if (im) { k++; return `<figure><img src="${esc(imgSrc(im[2]))}" alt="${esc(im[1])}" data-zoom="${k}"><figcaption>${esc(im[1])}</figcaption></figure>` }
      if (lines.every(l => /^\d+\.\s/.test(l))) return `<ol>${lines.map(l => `<li>${mdInline(l.replace(/^\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      if (lines.every(l => /^[-*] /.test(l))) return `<ul>${lines.map(l => `<li>${mdInline(l.slice(2))}</li>`).join("")}</ul>`;
      if (/^Источник:/.test(block)) return `<p class="snsrc">${mdInline(block)}</p>`;
      return `<p>${lines.map(mdInline).join("<br>")}</p>`;
    }).join("");
  }
  const notePreview = n => (n.md.split("\n").find(l => l.trim() && !IMG_MD.test(l.trim()) && !l.startsWith("Источник:")) || "").replace(/\*\*/g, "").replace(/\[УТОЧНИТЬ у ([^\]]+)\]/g, "? $1").replace(/^[-*] /, "");
  let snCur = null, snTab = 0, gallery = [];
  const snHead = (title, back) => `<div class="snbar">${back ? '<button class="snback" data-snback aria-label="Назад">←</button>' : ""}<h3>${esc(title)}</h3><button class="x" aria-label="Закрыть">×</button></div>`;
  function openScreen(id, tab) {
    snCur = NOTE_OF[id]; if (tab != null) snTab = tab; const d = SCR[snCur], t = d.tabs[snTab] || d.tabs[0];
    gallery = d.images.map(im => ({ alt: im.alt, src: imgSrc(im.src) }));
    side.innerHTML = snHead(d.title) + `<div class="snbody">${gallery.length ? `<div class="sngal${gallery.length > 1 ? " many" : ""}">${gallery.map((im, i) => `<img src="${esc(im.src)}" alt="${esc(im.alt)}" data-zoom="${i}">`).join("")}</div>` : ""}
      <nav class="snseg">${d.tabs.map((x, i) => `<button data-sntab="${i}"${x === t ? ' class="on"' : ""}>${esc(x.name)}</button>`).join("")}</nav>
      <ul class="snstack">${(t ? t.notes : []).map((n, i) => `<li data-snnote="${i}" tabindex="0"><b>${esc(n.title)}</b><span>${esc(notePreview(n))}</span>${n.md.includes(MARK) ? '<i class="q"></i>' : ""}</li>`).join("")}</ul></div>`;
    body.classList.remove("wide"); body.classList.add("open"); side.scrollTop = 0;
    side.dataset.ctx = "screen:" + snCur; side.dataset.note = "";
  }
  function openNote(i) {
    const d = SCR[snCur], n = d.tabs[snTab].notes[i];
    gallery = n.md.split(/\n{2,}/).map(b => b.trim().match(IMG_MD)).filter(Boolean).map(m => ({ alt: m[1], src: imgSrc(m[2]) }));
    side.innerHTML = snHead(n.title, true) + `<div class="snbody"><div class="snmd">${mdHTML(n.md)}</div></div>`; side.scrollTop = 0;
    side.dataset.ctx = "screen:" + snCur; side.dataset.note = `${d.tabs[snTab].name} · заметка «${n.title}»`;
  }
  /* просмотр картинки: крупно, ‹ › если их несколько; Esc или клик мимо — закрыть */
  const LB = document.getElementById("lb"); let lbI = 0;
  function zoom(i) {
    lbI = (i + gallery.length) % gallery.length; const im = gallery[lbI], many = gallery.length > 1;
    LB.innerHTML = `<figure><img src="${esc(im.src)}" alt="${esc(im.alt)}"><figcaption>${esc(im.alt)}${many ? ` · ${lbI + 1} из ${gallery.length}` : ""}</figcaption></figure>${many ? '<button class="nv p" data-lb="-1" aria-label="Предыдущая">‹</button><button class="nv n" data-lb="1" aria-label="Следующая">›</button>' : ""}<button class="lx" aria-label="Закрыть">×</button>`;
    LB.hidden = false;
  }

  /* ---------- первый экран: «Что видят» раскадровкой, путь уходит вправо ----------
     Колонка — этап истории шириной во столько кадров, сколько шагов у самого занятого персонажа;
     ряд — персонаж; пустая клетка — персонаж на этапе не участвует. Кадр — экран картинкой
     и подпись; несколько экранов у шага — кадры листаются сами и стрелками. */
  const hero = document.getElementById("hero");
  /* экран — картинка: SVG-макет отдаётся в <img>, как отдался бы PNG из макетов */
  const IMG = {};
  const screenImg = id => IMG[id] || (IMG[id] = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(mockSVG(D.screens[id], D.screens[id].contour)
    .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" font-family="Inter,-apple-system,Helvetica,Arial,sans-serif" ')));
  (function buildHero() {
    const persons = D.personas.filter(p => D.seen.some(s => s.persona === p.id));
    const cell = (p, c) => D.seen.find(s => s.persona === p.id && s.col === c);
    const width = c => Math.max(1, ...persons.map(p => { const s = cell(p, c); return s ? s.steps.length : 0 }));
    const FW = 196, GAP = 18, PAD = 16;
    const frame = (s, st) => {
      const n = st.screens.length, q = st.screens.some(scrOpen) || D.storyQuestions.some(qq => qq.where === st.id);
      const pic = n ? `<span class="track">${st.screens.map(id => `<span class="sld"><img src="${screenImg(id)}" alt="${esc(D.screens[id].contour)}" draggable="false"></span>`).join("")}</span>
        ${n > 1 ? `<span class="sl prev" data-sl="-1" aria-hidden="true">‹</span><span class="sl next" data-sl="1" aria-hidden="true">›</span>` : ""}` : "";
      const dots = n > 1 ? `<span class="dots">${st.screens.map((_, i) => `<i data-dot="${i}"${i ? "" : ' class="on"'}></i>`).join("")}</span>` : "";
      const notes = st.screens.some(id => NOTE_OF[id]);
      return `<div class="fr" data-seen="${s.key}"${notes ? ` data-screens="${st.screens.join(",")}"` : ""} role="button" tabindex="0" title="${esc(st.text)}"><span class="pic" data-n="${n}" data-i="0">${pic}${q ? '<span class="dot"></span>' : ""}</span>${dots}<span class="cap">${esc(st.title)}</span></div>`;
    };
    let x = `<div class="hgrid" style="--p:${persons.length};grid-template-columns:var(--lw) ${COLS.map((_, c) => `${width(c) * FW + (width(c) - 1) * GAP + 2 * PAD}px`).join(" ")}">`;
    x += '<div class="hc0"></div>' + COLS.map((col, c) => `<div class="hh"><span class="hhs"><span class="n">${c === COLS.length - 1 ? "✓" : c + 1}</span><b>${esc(col.name)}</b>${col.when ? `<small>${esc(col.when)}</small>` : ""}</span></div>`).join("");
    persons.forEach((p, i) => {
      x += `<div class="hl"><svg viewBox="0 0 16 16" aria-hidden="true">${PERSONA_ICON[Math.min(1, i)]}</svg><b>${esc(p.name.split(/[\s-]+/)[0])}</b><small>${esc(p.name)}</small></div>`;
      COLS.forEach((_, c) => {
        const s = cell(p, c);
        if (!s) x += '<div class="hcell"></div>';
        else if (s.final) x += `<div class="hcell"><div class="fr fin" data-seen="${s.key}" role="button" tabindex="0"><span class="pic">${s.big ? `<span class="big">${esc(s.big)}</span>` : '<span class="big">✓</span>'}</span><span class="cap">${esc(s.title)}</span></div></div>`;
        else x += `<div class="hcell">${s.steps.map(st => frame(s, st)).join("")}</div>`;
      });
    });
    hero.innerHTML = `<div class="hscroll" id="hscroll">${x}</div></div><button class="hnav prev" aria-label="Назад по пути">‹</button><button class="hnav next" aria-label="Дальше по пути">›</button>`;
    const sc = document.getElementById("hscroll"), prev = hero.querySelector(".prev"), next = hero.querySelector(".next");
    const sync = () => { prev.hidden = sc.scrollLeft < 8; next.hidden = sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 8 };
    sc.addEventListener("scroll", sync, { passive: true }); window.addEventListener("resize", sync); sync();
    prev.addEventListener("click", () => sc.scrollBy({ left: -sc.clientWidth * .8, behavior: "smooth" }));
    next.addEventListener("click", () => sc.scrollBy({ left: sc.clientWidth * .8, behavior: "smooth" }));
    /* вертикального содержимого у раскадровки нет: колесо мыши листает путь вправо-влево */
    sc.addEventListener("wheel", e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !e.ctrlKey) { e.preventDefault(); sc.scrollBy({ left: e.deltaY, behavior: "instant" }) } }, { passive: false });

    /* кадры внутри шага: сами листаются каждые 3 с, пока кадр на экране и под ним нет курсора */
    const multi = [...hero.querySelectorAll('.pic:not([data-n="0"]):not([data-n="1"])')].filter(el => el.dataset.n);
    const seen = new Set();
    if ("IntersectionObserver" in window) { const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting ? seen.add(e.target) : seen.delete(e.target)), { root: sc, threshold: .6 }); multi.forEach(el => io.observe(el)) }
    else multi.forEach(el => seen.add(el));
    const calm = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (multi.length && !calm) setInterval(() => seen.forEach(el => { if (!el.matches(":hover") && !body.classList.contains("open")) slide(el, 1) }), 3000);
  })();
  function slide(pic, d, to) {
    const n = +pic.dataset.n, i = to != null ? to : (+pic.dataset.i + d + n) % n;
    pic.dataset.i = i; pic.querySelector(".track").style.transform = `translateX(${-i * 100}%)`;
    pic.closest(".fr").querySelectorAll(".dots i").forEach((x, k) => x.classList.toggle("on", k === i));
  }

  /* ---------- три слоя: «Что видят», «Что делаем», «Как это работает» — переключатель, а не прокрутка страницы ----------
     «Что делаем» и «Как это работает» — одна сетка с общей строкой этапов, слой прячет чужие ряды.
     При переключении открывается тот же этап, что был слева на экране. */
  const work = document.getElementById("work");
  function setView(v) {
    const was = body.dataset.view; if (was === v) return;
    const hs = document.getElementById("hscroll"), hh = [...hero.querySelectorAll(".hh")], mh = [...grid.querySelectorAll(".mh:not(.corner)")];
    const firstVisible = (els, box, pad) => Math.max(0, els.findIndex(el => el.getBoundingClientRect().right > box.getBoundingClientRect().left + pad + 24));
    const col = was === "see" ? firstVisible(hh, hs, 132) : firstVisible(mh, work, 96);
    body.dataset.view = v;
    document.querySelectorAll("button[data-view]").forEach(b => b.classList.toggle("on", b.dataset.view === v));
    if (v === "see") hs.scrollLeft = hh[col] ? hh[col].offsetLeft - 132 : 0;
    else { work.scrollTop = 0; work.scrollLeft = mh[col] ? mh[col].offsetLeft - 96 : 0 }
    drawLinks();
  }
  body.dataset.view = "see";

  /* ---------- телефон: шаг за шагом сверху вниз ---------- */
  document.getElementById("mstack").innerHTML = COLS.map((col, c) => {
    const tasks = D.tasks.filter(t => t.stage === col.id), procs = D.cards.filter(p => p.stage === col.id);
    return `<section class="ms"><div class="mh2"><span class="n">${c === COLS.length - 1 ? "✓" : c + 1}</span><div><b>${esc(col.name)}</b>${col.when ? `<small>${esc(col.when)}</small>` : ""}</div></div>
      <div class="wl">${seenHTML(c)}</div>${tasks.length ? `<span class="lb">Что делаем</span><div class="wl">${tasks.map(taskHTML).join("")}</div>` : ""}
      ${procs.length ? `<span class="lb">Как это работает</span><div class="wl">${procs.map(procHTML).join("")}</div>` : ""}</section>`;
  }).join("");

  /* ---------- боковая панель ---------- */
  const side = document.getElementById("side");
  function openSide(tag, color, title, meta, html, wide) {
    side.dataset.ctx = ""; side.dataset.note = "";
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
    side.dataset.ctx = "seen:" + key;
  }

  /* задача «Что делаем» — постановка для техлида, задача Backlog.md. «Требования»: зачем, ASIS, GAP, TOBE,
     HowToDemo, критерии приемки, дополнительно. «Исполнение»: ссылки на JIRA и Confluence (references) и
     заметка (Implementation Notes); правки — в браузере, в проект — командой `backlog task edit` */
  const dodKey = id => `bp-dod-${D.epic}-${id}`;
  let taskTab = 0;
  const execKey = id => `bp-exec-${D.epic}-${id}`;
  const isJira = u => /jira|\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(u), isConf = u => !isJira(u) && /confluence|wiki|\/pages\//i.test(u);
  function execOf(t) {
    let v = null; try { v = JSON.parse(localStorage.getItem(execKey(t.id)) || "null") } catch (e) { }
    if (v) return v;
    const urls = t.refs.filter(u => /^https?:\/\//.test(u));
    return { jira: urls.filter(isJira).join(" "), conf: urls.filter(isConf).join(" "), note: t.notes || "" };
  }
  const links = s => (s || "").split(/[\s,]+/).filter(u => /^https?:\/\//.test(u)).map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, "").slice(0, 48))}</a>`).join("");
  function execHTML(t) {
    const v = execOf(t);
    return `<div class="exec" data-exec="${esc(t.id)}">
      <label>JIRA<input data-ex="jira" value="${esc(v.jira)}" placeholder="Ссылка на задачу или эпик"></label><div class="exl">${links(v.jira)}</div>
      <label>Confluence<input data-ex="conf" value="${esc(v.conf)}" placeholder="Ссылка на страницу"></label><div class="exl">${links(v.conf)}</div>
      <label>Заметка<textarea data-ex="note" placeholder="Ход работ, решения, договорённости">${esc(v.note)}</textarea></label>
      <button class="tool" data-excopy="${esc(t.id)}">Скопировать команду для бэклога</button></div>`;
  }
  /* команда CLI Backlog.md: ссылки JIRA и Confluence заменяют прежние такие же, остальные references остаются */
  const sh = x => `'${String(x).replace(/'/g, "'\\''")}'`;
  function execCmd(id) {
    const t = TASK[id], v = execOf(t), split = s => (s || "").split(/[\s,]+/).filter(Boolean);
    const keep = t.refs.filter(u => !(/^https?:\/\//.test(u) && (isJira(u) || isConf(u))));
    const refs = [...keep, ...split(v.jira), ...split(v.conf)];
    return `backlog task edit ${id} ${refs.length ? refs.map(r => "--ref " + sh(r)).join(" ") : "--clear-refs"} --notes ${sh(v.note || "")}`;
  }
  document.addEventListener("input", e => {
    const f = e.target.closest && e.target.closest("[data-ex]"); if (!f) return;
    const id = f.closest("[data-exec]").dataset.exec, v = execOf(TASK[id]);
    v[f.dataset.ex] = f.value; try { localStorage.setItem(execKey(id), JSON.stringify(v)) } catch (er) { }
    if (f.dataset.ex !== "note") f.parentElement.nextElementSibling.innerHTML = links(f.value);
  });
  const sec = (name, html) => html ? `<section class="tk"><h4>${name}</h4>${html}</section>` : "";
  const uniqQ = qs => [...new Map(qs.map(q => [q.text, q])).values()];
  const qList = qs => qs.length ? `<ul class="tkq">${uniqQ(qs).map(q => `<li class="${q.kind === "блокер" ? "b" : ""}">${q.kind === "блокер" ? "<b>Блокер.</b> " : ""}${esc(q.text)} <span>— ${esc(q.to)}</span></li>`).join("")}</ul>` : "";
  /* ссылка на другую задачу или карточку, документ, страницу */
  const idChip = id => PROC[id] ? `<button class="ref" data-proc="${id}" title="${esc(PROC[id].text)}">${esc(id)}</button>` : TASK[id] ? `<button class="ref" data-task="${id}" title="${esc(TASK[id].text)}">${esc(id)}</button>` : `<code>${esc(id)}</code>`;
  function refItem(r) {
    if (/^https?:\/\//.test(r)) return `<a href="${esc(r)}" target="_blank" rel="noopener">${esc(r.replace(/^https?:\/\//, "").slice(0, 60))}</a>`;
    const d = D.docs[r.toLowerCase().split(" ")[0]];
    if (d) return d.screen && NOTE_OF[d.screen] ? `<button class="lnk" data-screen-doc="${esc(d.screen)}">${esc(d.title)}</button>` : `<span>${esc(d.title)}</span> <code>${esc(d.file)}</code>`;
    if (PROC[r] || TASK[r]) return `${idChip(r)} ${esc((PROC[r] || TASK[r]).text)}`;
    return `<code>${esc(r)}</code>`;
  }
  const refList = items => items.length ? `<ul class="lnks">${items.map(x => `<li>${x}</li>`).join("")}</ul>` : "";
  function openTask(id, tab) {
    if (tab != null) taskTab = tab;
    const t = TASK[id], br = t.brief || {}, cards = D.cards.filter(c => c.task === id);
    const qs = [...qOf(id), ...cards.flatMap(c => qOf(c.id))];
    let done = {}; try { done = JSON.parse(localStorage.getItem(dodKey(id)) || "{}") } catch (e) { }
    const ac = t.ac.map(([d, x], k) => `<label class="dod"><input type="checkbox" data-dod="${id}:${k}"${(done[k] != null ? done[k] : d) ? " checked" : ""}><span>${mdInline(x)}</span></label>`).join("");
    const extra = [br["Дополнительно"] ? mdHTML(br["Дополнительно"]) : "",
      t.reqs.length ? `<p class="tkreq">Требования БФТ: ${t.reqs.map(esc).join(", ")}</p>` : "",
      refList([...cards.map(c => `${idChip(c.id)} ${esc(c.text)}`), ...t.docs.map(refItem), ...t.refs.filter(r => !/^https?:\/\//.test(r)).map(refItem)]), qList(qs)].join("");
    const html = (t.why ? `<p class="tklead">${mdInline(t.why)}</p>` : "") + sec("ASIS", mdHTML(br.ASIS || "")) + sec("GAP", mdHTML(br.GAP || "")) + sec("TOBE", mdHTML(br.TOBE || "")) +
      sec("HowToDemo", mdHTML(br.HowToDemo || "")) + sec("Чеклист приемки", ac) + sec("Дополнительно", extra);
    const tabs = `<nav class="snseg tktabs">${["Требования", "Исполнение"].map((n, i) => `<button data-tktab="${i}"${i === taskTab ? ' class="on"' : ""}>${n}</button>`).join("")}</nav>`;
    side.innerHTML = `<div class="snbar"><h3>${esc(t.text)}</h3><button class="x" aria-label="Закрыть">×</button></div><div class="snbody"><div class="tkmeta"><span class="pteam" style="--c:${teamC(t)}"><i></i>${esc(t.team === "?" && t.cand ? "Команда? " + t.cand : teamN(t))}</span> · ${esc(COLS[colOf(t.stage)].name)} · ${esc(id)} · ${esc(t.status)}</div>${tabs}${taskTab ? execHTML(t) : html}</div>`;
    body.classList.remove("wide"); body.classList.add("open"); side.scrollTop = 0;
    side.dataset.ctx = "task:" + id; side.dataset.note = "";
  }

  /* карточка «Как это работает» — техническая задача: UserStory, JobStory, процесс в BPMN, параметры, HowToDemo, ссылки */
  const PNAME = { in: "Вход", ctl: "Управление", out: "Выход", mech: "Механизм" };
  function openProc(id) {
    const c = PROC[id], t = TASK[c.task], L = LAYER[c.layer], P = c.params || {};
    const row = k => (P[k] || []).length ? `<div class="pp"><span>${PNAME[k]}</span><ul>${P[k].map(it => `<li>${mdInline(it.t)}${it.r.length ? " " + it.r.map(idChip).join(" ") : ""}</li>`).join("")}</ul></div>` : "";
    const lnk = refList([t ? `Задача ${idChip(t.id)} ${esc(t.text)}` : "", ...c.docs.map(refItem), ...c.refs.map(refItem)].filter(Boolean));
    const proc = (c.lead ? `<p class="tklead">${mdInline(c.lead)}</p>` : "") + ((c.proc || []).length ? `<div class="bpmnw">${BPK.bpmnSVG(c.proc, { uid: "c" })}</div>` : "");
    side.innerHTML = `<div class="snbar"><h3>${esc(c.text)}</h3><button class="x" aria-label="Закрыть">×</button></div><div class="snbody">
      <div class="tkmeta"><span class="lay" style="--c:${L[2]}">${L[0]}</span> · <span class="pteam" style="--c:${teamC(c)}"><i></i>${esc(teamN(c))}</span> · ${esc(COLS[colOf(c.stage)].name)} · ${esc(id)} · ${esc(c.status)}</div>
      ${c.us ? `<blockquote class="us">${mdInline(c.us)}</blockquote>` : ""}
      ${sec("JobStory", (c.js || []).length ? `<ul class="js">${c.js.map(x => `<li>${mdInline(x)}</li>`).join("")}</ul>` : "")}
      ${sec("Процесс", proc)}${sec("Параметры", ["in", "ctl", "out", "mech"].map(row).join(""))}
      ${sec("HowToDemo", mdHTML(c.demo || ""))}${sec("Вопросы", qList([...qOf(id), ...qOf(c.task)]))}${sec("Ссылки", lnk)}</div>`;
    body.classList.add("wide", "open"); side.scrollTop = 0;
    side.dataset.ctx = "proc:" + id; side.dataset.note = "";
  }
  function copyText(txt, btn) {
    const lab = btn.textContent, done = () => { btn.textContent = "Скопировано ✓"; setTimeout(() => btn.textContent = lab, 1600) };
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(done).catch(() => { const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); done() } catch (er) { } ta.remove() });
  }

  /* ---------- инструкции, легенда, блокеры ---------- */
  const DOCS = "https://github.com/po-helper-org/poh-bft-writer/blob/main/docs/guides/blueprint/";
  const ARTICLES = [["service-blueprint.md", "#2563c9", "SB", "Методология Service Blueprint и карта опыта", "Откуда эта карта: Service Blueprint, карта процесса-опыта, линии взаимодействия, видимости и внутреннего взаимодействия."],
    ["how-to-read.md", "#2f6b2a", "?", "Как читать карту", "Что видят, что делаем, как это работает — и куда нажимать."],
    ["product-storytelling.md", "#6b3fd4", "PS", "Product Storytelling: история через экраны", "Как устроен сюжет «было → шаги → стало» и почему история помогает проектировать."],
    ["bpmn.md", "#d06a12", "BP", "BPMN: процесс по дорожкам", "Кто что делает, где развилка и куда ведёт каждая ветка."],
    ["bft.md", "#1c1c1c", "БФТ", "БФТ: бизнес-функциональные требования", "Откуда карта берёт каждый шаг и задачу и как вопросы с карты возвращаются в требования."]];
  function openGuide(kind) {
    if (kind === "help") openSide("Инструкции", "#555", "Как работать с картой", "", ARTICLES.map(([f, c, ic, t, d], i) => `<a class="art" href="${DOCS + f}" target="_blank" rel="noopener"><span class="ic" style="background:${c}">${ic}</span><span><b>${i + 1}. ${esc(t)}</b><span>${esc(d)}</span><em>Читать на GitHub ↗</em></span></a>`).join(""));
    else if (kind === "blk") openSide("Блокеры", "var(--red)", `Блокеров: ${uniqBlk.length}`, "", D.questions.filter(q => q.open && q.kind === "блокер").map(q => `<div class="bcard" data-${TASK[q.where] ? "task" : "proc"}="${q.where}"><b>${esc(q.text)}</b><small>${esc(q.to)} · ${esc(TASK[q.where] ? TASK[q.where].text : PROC[q.where].text)}</small></div>`).join(""));
    else openSide("Легенда", "#555", "Условные обозначения", "", `<div class="lg"><h4>Колонки</h4><div class="row"><i><span class="mh" style="position:static;padding:0!important;background:none"><span class="n">1</span></span></i><span>Шаг пути<small>слева направо — от подготовки до итога</small></span></div>
      <h4>Что видят</h4><div class="row"><i><span class="box" style="background:#fff;border:1px solid var(--line)"></span></i><span>Экран и фраза гостя или ресторана<small>по клику — все шаги этапа, экраны, вопросы</small></span></div>
      <h4>Что делаем — цвет команды</h4>${D.teams.filter(t => used[t.id]).map(t => `<div class="row"><i><span class="sw" style="background:${TEAM[t.id].c}"></span></i><span>${esc(t.name)}</span></div>`).join("")}${used["?"] ? `<div class="row"><i><span class="sw" style="border:1.5px dashed var(--red)"></span></i><span>Команда не определена</span></div>` : ""}
      <div class="row"><i><span class="qn">2</span></i><span>Открытые вопросы</span></div><div class="row"><i><span class="bl" style="margin:0">Блокер</span></i><span>Без решения задача не стартует</span></div>
      <h4>Как это работает</h4><div class="row"><i><span class="box" style="background:#f7ece3"></span></i><span>Employee Actions<small>сотрудник на виду у гостя: официант, оператор</small></span></div><div class="row"><i><span class="box" style="background:#e5f3f4"></span></i><span>Technology<small>интерфейсы, которые видит гость</small></span></div><div class="row"><i><span class="box" style="background:#e7edf8"></span></i><span>Backstage<small>за кадром</small></span></div><div class="row"><i><span class="box" style="background:#efecf6"></span></i><span>Support<small>общие ресурсы и внешние каналы</small></span></div>
      <div class="row"><i><span class="ln2"></span></i><span>Линия видимости</span></div><div class="row"><i><span class="ln3"></span></i><span>Линия внутреннего взаимодействия</span></div>
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
    if (!LB.hidden) { const b = t.closest("[data-lb]"); if (b) return zoom(lbI + +b.dataset.lb); if (!t.closest("img")) LB.hidden = true; return }
    if (t.closest(".side .x") || t.closest(".scrim")) return closeSide();
    const zm = t.closest("[data-zoom]"); if (zm) return zoom(+zm.dataset.zoom);
    const st = t.closest("[data-sntab]"); if (st) return openScreen(snCur, +st.dataset.sntab);
    const nt = t.closest("[data-snnote]"); if (nt) return openNote(+nt.dataset.snnote);
    if (t.closest("[data-snback]")) return openScreen(snCur);
    if (t.closest("#burger")) return menu(!body.classList.contains("mopen"));
    const vw = t.closest("button[data-view]"); if (vw) return setView(vw.dataset.view);
    if (t.closest('[data-menu="close"]') || t.closest(".mscrim")) return menu(false);
    if (t.closest("[data-tf-clear]")) return teamFilter("");
    if (t.closest("#menu [data-guide]") || t.closest("#menu .play")) menu(false);
    const sl = t.closest("[data-sl]"); if (sl) return slide(sl.closest(".pic"), +sl.dataset.sl);
    const dd = t.closest("[data-dot]"); if (dd) return slide(dd.closest(".fr").querySelector(".pic"), 0, +dd.dataset.dot);
    const sd = t.closest("[data-screen-doc]"); if (sd) return openScreen(sd.dataset.screenDoc, 0);
    const tf = t.closest("[data-tf]");
    if (tf) { teamFilter(tf.classList.contains("on") ? "" : tf.dataset.tf); return menu(false) }
    const g = t.closest("[data-guide]"); if (g) return openGuide(g.dataset.guide);
    const pr = t.closest("[data-proc]"); if (pr) return openProc(pr.dataset.proc);
    const tk = t.closest("[data-task]"); if (tk) return openTask(tk.dataset.task, 0);
    /* кадр с требованиями: открыть экран, который сейчас виден в кадре */
    const scr = t.closest("[data-screens]");
    if (scr) { const ids = scr.dataset.screens.split(","), pic = scr.querySelector(".pic"), now = ids[+(pic && pic.dataset.i) || 0]; return openScreen(NOTE_OF[now] ? now : ids.find(id => NOTE_OF[id]), 0) }
    const sn = t.closest("[data-seen]"); if (sn) return openSeen(sn.dataset.seen);
  });
  document.addEventListener("change", e => {
    const c = e.target.closest && e.target.closest("[data-dod]"); if (!c) return;
    const [id, k] = c.dataset.dod.split(":"); let d = {}; try { d = JSON.parse(localStorage.getItem(dodKey(id)) || "{}") } catch (er) { }
    d[k] = c.checked; try { localStorage.setItem(dodKey(id), JSON.stringify(d)) } catch (er) { }
  });
  document.addEventListener("keydown", e => {
    if (body.classList.contains("showing")) { if (e.key === "ArrowRight") stepShow(1); else if (e.key === "ArrowLeft") stepShow(-1); else if (e.key === "Escape") body.classList.remove("showing"); return }
    if (!LB.hidden) { if (e.key === "Escape") LB.hidden = true; else if (gallery.length > 1 && e.key === "ArrowRight") zoom(lbI + 1); else if (gallery.length > 1 && e.key === "ArrowLeft") zoom(lbI - 1); return }
    if (e.key === "Escape") { if (body.classList.contains("mopen")) { menu(false); burger.focus() } else if (side.querySelector("[data-snback]")) openScreen(snCur); else closeSide() }
    if (e.key === "Enter" && e.target.matches && e.target.matches("[data-snnote]")) openNote(+e.target.dataset.snnote);
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-seen]")) { e.preventDefault(); openSeen(e.target.dataset.seen) }
  });
  /* ---------- замечания: правой кнопкой по любой секции → список → промпт для ИИ-агента ----------
     Как в bft-writer: замечания хранятся в браузере; пересобранная карта (новая ревизия) закрывает
     открытые замечания — они ушли в доработку и в следующий промпт не попадают. */
  const CM_KEY = `bp-cm-${D.epic}`, CM_REV = CM_KEY + "-rev", CM_ITER = CM_KEY + "-iter";
  const cmLoad = () => { try { return JSON.parse(localStorage.getItem(CM_KEY) || "[]") } catch (e) { return [] } };
  const cmSave = list => { try { localStorage.setItem(CM_KEY, JSON.stringify(list)) } catch (e) { } };
  const cmOpen = () => cmLoad().filter(c => !c.closedAt);
  (function syncRevision() {
    let seen = null; try { seen = localStorage.getItem(CM_REV) } catch (e) { return }
    if (seen && seen !== D.rev) {
      const now = new Date().toISOString(), iter = +(localStorage.getItem(CM_ITER) || 1), list = cmLoad(); let n = 0;
      list.forEach(c => { if (!c.closedAt) { c.closedAt = now; c.iteration = iter; n++ } });
      if (n) { cmSave(list); try { localStorage.setItem(CM_ITER, String(iter + 1)) } catch (e) { } }
    }
    try { localStorage.setItem(CM_REV, D.rev) } catch (e) { }
  })();
  const F = D.files || {}, mapDoc = F.map || "backlog/docs", storyDoc = F.story || "backlog/docs";
  /* что именно под курсором: ключ для метки, подпись для промпта, файл проекта Backlog.md, который править */
  function cmTarget(el) {
    if (el.closest("#side")) {
      const [kind, id] = (side.dataset.ctx || ":").split(":"), note = side.dataset.note || "";
      if (kind === "task") { const s = el.closest(".tk"); return { key: "task:" + id, label: `Задача ${id} «${TASK[id].text}»${s ? " · раздел " + s.querySelector("h4").textContent : side.querySelector(".exec") ? " · исполнение" : ""}`, file: TASK[id].file } }
      if (kind === "screen") { const li = el.closest("[data-snnote]"), tab = side.querySelector(".snseg .on");
        const what = note || (li ? `${tab ? tab.textContent : ""} · заметка «${li.querySelector("b").textContent}»` : "");
        return { key: "screen:" + id, label: `Экран ${id} «${SCR[id].title}»${what ? " · " + what : ""}`, file: (D.noteFiles || {})[id] || storyDoc } }
      if (kind === "proc") { const s = el.closest(".tk"); return { key: "proc:" + id, label: `Карточка ${id} «${PROC[id].text}»${s ? " · раздел " + s.querySelector("h4").textContent : ""}`, file: PROC[id].file } }
      if (kind === "seen") return { key: "seen:" + id, label: `Шаги истории «${id}»`, file: storyDoc };
      return { key: "map", label: "Карта", file: mapDoc };
    }
    const fr = el.closest(".fr"); if (fr) { const cap = fr.querySelector(".cap").textContent, ids = (fr.dataset.screens || "").split(",").filter(Boolean);
      fr.dataset.cmk = "fr:" + cap; return { key: "fr:" + cap, label: `Что видят · шаг «${cap}»`, file: storyDoc + (ids.length && (D.noteFiles || {})[NOTE_OF[ids[0]]] ? `, ${D.noteFiles[NOTE_OF[ids[0]]]}` : "") } }
    const wk = el.closest("[data-task]"); if (wk) { const id = wk.dataset.task; wk.dataset.cmk = "task:" + id; return { key: "task:" + id, label: `Задача ${id} «${TASK[id].text}»`, file: TASK[id].file } }
    const hw = el.closest("[data-proc]"); if (hw) { const id = hw.dataset.proc; hw.dataset.cmk = "proc:" + id; return { key: "proc:" + id, label: `Карточка ${id} «${PROC[id].text}»`, file: PROC[id].file } }
    const hd = el.closest(".hh,.mh:not(.corner)"); if (hd) { const name = hd.querySelector("b").textContent; hd.dataset.cmk = "stage:" + name; return { key: "stage:" + name, label: `Этап «${name}»`, file: storyDoc } }
    const row = el.closest(".hl,.ml"); if (row) { const name = row.textContent.trim().split("\n")[0].slice(0, 40); return { key: "row:" + name, label: `Ряд «${name}»`, file: row.closest(".hero") ? storyDoc : mapDoc } }
    return { key: "map", label: "Карта", file: mapDoc };
  }
  function cmPaint() {
    const open = cmOpen(), keys = new Set(open.map(c => c.key));
    document.querySelectorAll("[data-cmk]").forEach(x => x.classList.toggle("cm-has", keys.has(x.dataset.cmk)));
    const n = open.length, cmn = document.getElementById("cmn"), chip = document.getElementById("cmchip");
    cmn.hidden = !n; cmn.textContent = n; chip.hidden = !n; chip.textContent = `Замечания · ${n}`;
  }
  /* поле замечания у курсора */
  let cmPop = null;
  function cmClose() { if (cmPop) { cmPop.remove(); cmPop = null } }
  function cmAsk(x, y, tgt, quote) {
    cmClose();
    const had = cmOpen().filter(c => c.key === tgt.key);
    cmPop = document.createElement("div"); cmPop.className = "cmpop";
    cmPop.innerHTML = `<div class="cmwhere">${esc(tgt.label)}</div>${quote ? `<div class="cmq">«${esc(quote)}»</div>` : ""}${had.map(c => `<div class="cmold">${esc(c.text)}</div>`).join("")}
      <textarea placeholder="Замечание для доработки (Ctrl+Enter — сохранить)"></textarea><div class="cmrow"><button class="cmsave">Сохранить</button><button class="cmcancel">Отмена</button></div>`;
    document.body.appendChild(cmPop);
    cmPop.style.left = Math.max(8, Math.min(x, innerWidth - cmPop.offsetWidth - 8)) + "px";
    cmPop.style.top = Math.max(8, Math.min(y, innerHeight - cmPop.offsetHeight - 8)) + "px";
    const ta = cmPop.querySelector("textarea"); ta.focus();
    const save = () => { const text = ta.value.trim(); if (!text) return cmClose(); const list = cmLoad(); list.push({ ts: new Date().toISOString(), ...tgt, quote, text }); cmSave(list); cmClose(); cmPaint(); if (side.dataset.ctx === "cm") cmPanel() };
    cmPop.querySelector(".cmsave").addEventListener("click", save);
    cmPop.querySelector(".cmcancel").addEventListener("click", cmClose);
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save(); if (e.key === "Escape") { e.stopPropagation(); cmClose() } });
  }
  document.addEventListener("contextmenu", e => {
    if (e.shiftKey || e.target.closest(".cmpop,.zoombox,textarea,input")) return;
    if (!e.target.closest(".hero,.wrap,#side,.mstack")) return;
    e.preventDefault();
    const sel = String(window.getSelection() || "").trim().replace(/\s+/g, " ").slice(0, 200);
    cmAsk(e.clientX, e.clientY, cmTarget(e.target), sel);
  });
  document.addEventListener("mousedown", e => { if (cmPop && !e.target.closest(".cmpop")) cmClose() });
  function cmPrompt(list) {
    if (!list.length) return "";
    const files = [...new Set(list.flatMap(c => c.file.split(", ")))], proj = F.project || "<epic>-blueprint";
    return [`Доработай Service Blueprint «${D.title}» (${D.epic}) по замечаниям с карты. Данные — проект Backlog.md ${proj}:`, "",
      ...list.map((c, i) => `${i + 1}. [${c.label}]${c.quote ? ` (по фрагменту «${c.quote}»)` : ""} ${c.text}\n   Файл: ${c.file}`), "",
      "Правь только названное и только через встроенный CLI: `./backlog.py task edit <ID> …`, `./backlog.py doc update <doc-id> --content …`; файлы руками не правь.",
      `Источник фактов — БФТ ${F.source || ""}; чего в нём нет — [УТОЧНИТЬ у {кого}] и строка в «Вопросах» документа «Карта». Схему процесса не рисуй: она собирается из раздела «Процесс».`,
      `Файлы к правке: ${files.join(", ")}.`, "",
      "После правок — обязательно, из папки проекта:",
      "1. ./blueprint.py lint   (0 ошибок)",
      "2. ./blueprint.py build   (пересобрать страницу и архив — без этого замечания придут повторно)"].join("\n");
  }
  function cmPanel() {
    const list = cmOpen(), past = cmLoad().filter(c => c.closedAt);
    side.innerHTML = `<div class="snbar"><h3>Замечания${list.length ? " · " + list.length : ""}</h3><button class="x" aria-label="Закрыть">×</button></div><div class="snbody">
      ${list.length ? `<ul class="cmlist">${list.map(c => `<li><small>${esc(c.label)}</small>${c.quote ? `<i>«${esc(c.quote)}»</i>` : ""}<span>${esc(c.text)}</span><button data-cmdel="${esc(c.ts)}">удалить</button></li>`).join("")}</ul>
      <h4 class="cmh">Промпт для ИИ-агента</h4><textarea class="cmout" readonly>${esc(cmPrompt(list))}</textarea><button class="tool pri" data-cmcopy>Скопировать промпт</button>`
      : '<p class="cmempty">Замечаний нет. Правой кнопкой мыши по кадру, этапу, задаче, карточке или заметке — оставить замечание.</p>'}
      ${past.length ? `<details class="cmpast"><summary>Учтено в прошлых кругах · ${past.length}</summary><ul class="cmlist">${past.map(c => `<li><small>${esc(c.label)} · круг ${c.iteration || 1}</small><span>${esc(c.text)}</span></li>`).join("")}</ul></details>` : ""}</div>`;
    side.dataset.ctx = "cm"; body.classList.remove("wide"); body.classList.add("open"); side.scrollTop = 0;
  }
  document.addEventListener("click", e => {
    const p = e.target.closest("[data-cmpanel]"); if (p) { menu(false); return cmPanel() }
    const tt = e.target.closest("[data-tktab]"); if (tt) return openTask(side.dataset.ctx.split(":")[1], +tt.dataset.tktab);
    const xc = e.target.closest("[data-excopy]"); if (xc) return copyText(execCmd(xc.dataset.excopy), xc);
    const d = e.target.closest("[data-cmdel]"); if (d) { cmSave(cmLoad().filter(c => c.ts !== d.dataset.cmdel)); cmPaint(); return cmPanel() }
    const c = e.target.closest("[data-cmcopy]"); if (c) return copyText(side.querySelector(".cmout").value, c);
  });
  /* метки на элементах с замечаниями: ключи проставляются заранее */
  hero.querySelectorAll(".fr").forEach(f => f.dataset.cmk = "fr:" + f.querySelector(".cap").textContent);
  grid.querySelectorAll("[data-task]").forEach(x => x.dataset.cmk = "task:" + x.dataset.task);
  grid.querySelectorAll("[data-proc]").forEach(x => x.dataset.cmk = "proc:" + x.dataset.proc);
  document.querySelectorAll(".hh,.mh:not(.corner)").forEach(x => x.dataset.cmk = "stage:" + x.querySelector("b").textContent);
  cmPaint();

  window.BPMAP = { setView, cmPanel, cmTarget, cmPrompt, execCmd, openProc, openTask, openSeen, openScreen, openNote, zoom };
})();
