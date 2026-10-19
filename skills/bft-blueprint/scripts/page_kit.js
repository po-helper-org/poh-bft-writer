/* bft-blueprint · общий набор страницы: упрощённый экран, контуры, экранирование.
   Подключается перед story_page.js и map_page.js — экраны на истории и на карте рисуются одинаково;
   здесь же схема BPMN карточки «Как это работает». */
const BPK = (function () {
  "use strict";
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
  function wrapT(t, n) { const w = String(t).split(" "); const o = []; let c = ""; for (const x of w) { if ((c + " " + x).trim().length > n) { if (c) o.push(c); c = x } else c = (c + " " + x).trim() } if (c) o.push(c); return o }
  function mockSVG(t, label) {
    const W = 150, H = 250, ink = "#1f1f1f", g = "#9a958c", OF = "#6b3fd4", P = 11, IW = W - 2 * P;
    const T = (x, yy, s, fs, fw, fill, a) => `<text x="${x}" y="${yy}" font-size="${fs}" font-weight="${fw || 400}" fill="${fill || ink}"${a ? ` text-anchor="${a}"` : ""}>${esc(s)}</text>`;
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
  /* ---------- BPMN карточки «Как это работает»: дорожка — участник, слева направо — шаги ----------
     Процесс — список из bft_backlog.parse_process: {t:"task", lane, text} и {t:"xor", q, br:[{label, lane, text} | {label, end}]}.
     Дорожка — колонка, шаг — строка; ветки развилки — в одной строке; ветки сходятся в следующий шаг. */
  const MARK = "[УТОЧНИТЬ", U = t => String(t || "").includes(MARK);
  const tsp = (ls, x, dy) => ls.map((l, i) => `<tspan x="${x}" dy="${i ? dy : 0}">${esc(l)}</tspan>`).join("");
  function bpmnSVG(proc, o) {
    o = o || {};
    const lanes = [], addLane = l => { if (l && !lanes.includes(l)) lanes.push(l) };
    proc.forEach(x => x.t === "task" ? addLane(x.lane) : x.br.forEach(b => addLane(b.lane)));
    if (!lanes.length) return "";
    const nodes = [], edges = [], add = n => (nodes.push(n), n), short = t => String(t || "").replace(/\[УТОЧНИТЬ у ([^\]]+)\]/g, "? $1").replace(/\[УТОЧНИТЬ:?\s*([^\]]*)\]/g, "? $1");
    let col = 0, lastLane = proc[0].t === "task" ? proc[0].lane : lanes[0];
    let prev = [[add({ kind: "start", lane: lastLane, col: col++ }), ""]];
    proc.forEach(x => {
      if (x.t === "task") {
        const n = add({ kind: "task", lane: x.lane, col: col++, text: x.text });
        prev.forEach(([a, l]) => edges.push([a, n, l])); prev = [[n, ""]]; lastLane = x.lane; return;
      }
      const g = add({ kind: "gw", lane: lastLane, col: col++, text: x.q }), bc = col++;
      prev.forEach(([a, l]) => edges.push([a, g, l])); prev = [];
      x.br.forEach(b => {
        const n = b.end ? add({ kind: "end", lane: lastLane, col: bc }) : add({ kind: "task", lane: b.lane, col: bc, text: b.text });
        edges.push([g, n, b.label]); if (!b.end) prev.push([n, ""]);
      });
      if (prev.length === 1) lastLane = prev[0][0].lane;
    });
    if (prev.length) { const e = add({ kind: "end", lane: prev.length === 1 ? prev[0][0].lane : lastLane, col: col++ }); prev.forEach(([a, l]) => edges.push([a, e, l])) }
    /* раскладка: дорожки — колонки, шаги идут сверху вниз; в одной клетке узлы встают рядом */
    const W = 800, LW = Math.round(W / lanes.length), HEAD = 40, RH = 86, BW = Math.min(LW - 18, 158), BH = 48, cell = {};
    nodes.forEach(n => { const k = n.lane + "|" + n.col; n.slot = (cell[k] = (cell[k] || 0) + 1) - 1 });
    const H = HEAD + col * RH + 10;
    nodes.forEach(n => {
      const k = cell[n.lane + "|" + n.col], li = lanes.indexOf(n.lane), w = LW / k;
      n.x = li * LW + w * n.slot + w / 2; n.y = HEAD + n.col * RH + RH / 2; n.bw = Math.min(BW, w - 12);
    });
    nodes.forEach(n => { if (n.kind === "task") n.h = Math.max(BH, wrapT(short(n.text), Math.max(11, Math.floor(n.bw / 6.6))).slice(0, 4).length * 13 + 16) });
    const half = n => n.kind === "task" ? n.h / 2 : n.kind === "gw" ? 18 : 13;
    const mk = "bp" + (o.uid || ""), ink = "#1c1c1c", red = t => U(t) ? "#c0392b" : ink;
    let s = `<svg class="bpmn" viewBox="0 0 ${W} ${H}" role="img" aria-label="Процесс BPMN"><defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="${ink}"/></marker></defs>`;
    lanes.forEach((l, i) => {
      const x = i * LW, ls = wrapT(l, Math.max(10, Math.floor(LW / 8))).slice(0, 2);
      s += `<rect x="${x}" y="0" width="${LW}" height="${H}" fill="${i % 2 ? "#faf9f6" : "#fff"}"/>${i ? `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#d8d4cb"/>` : ""}`;
      s += `<text x="${x + LW / 2}" y="${ls.length > 1 ? 16 : 24}" font-size="12" font-weight="700" fill="#3a3a3a" text-anchor="middle">${tsp(ls, x + LW / 2, 14)}</text>`;
    });
    s += `<line x1="0" y1="${HEAD - 4}" x2="${W}" y2="${HEAD - 4}" stroke="#c9c4ba"/><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#c9c4ba"/>`;
    edges.forEach(([a, b, lab]) => {
      const ax = a.x, ay = a.y + half(a), bx = b.x, by = b.y - half(b), my = Math.round(ay + Math.min(16, (by - ay) / 2));
      s += Math.abs(ax - bx) < 1 ? `<path d="M${ax},${ay} V${by}" fill="none" stroke="${ink}" stroke-width="1.4" marker-end="url(#${mk})"/>`
        : `<path d="M${ax},${ay} V${my} H${bx} V${by}" fill="none" stroke="${ink}" stroke-width="1.4" marker-end="url(#${mk})"/>`;
      if (lab) s += `<text x="${bx + 6}" y="${my + 14}" font-size="11" font-weight="700" fill="#2563c9" paint-order="stroke" stroke="#fff" stroke-width="3">${esc(lab)}</text>`;
    });
    nodes.forEach(n => {
      if (n.kind === "start") s += `<circle cx="${n.x}" cy="${n.y}" r="13" fill="#fff" stroke="#2f6b2a" stroke-width="2"/>`;
      else if (n.kind === "end") s += `<circle cx="${n.x}" cy="${n.y}" r="13" fill="#fff" stroke="${ink}" stroke-width="4"/>`;
      else if (n.kind === "gw") {
        const right = n.x + 24 + 150 < W, ls = wrapT(short(n.text), 24).slice(0, 3), tx = right ? n.x + 26 : n.x - 26;
        s += `<path d="M${n.x},${n.y - 18} L${n.x + 18},${n.y} L${n.x},${n.y + 18} L${n.x - 18},${n.y}z" fill="#fff8e6" stroke="#b7791f" stroke-width="1.6"/><path d="M${n.x - 6},${n.y - 6} L${n.x + 6},${n.y + 6} M${n.x + 6},${n.y - 6} L${n.x - 6},${n.y + 6}" stroke="#b7791f" stroke-width="2"/>`;
        s += `<text x="${tx}" y="${n.y - (ls.length - 1) * 6.5 + 4}" font-size="11.5" font-weight="600" text-anchor="${right ? "start" : "end"}" fill="${red(n.text)}" paint-order="stroke" stroke="#fff" stroke-width="3">${tsp(ls, tx, 13)}</text>`;
      } else {
        const ls = wrapT(short(n.text), Math.max(11, Math.floor(n.bw / 6.6))).slice(0, 4), bh = Math.max(BH, ls.length * 13 + 16);
        s += `<rect x="${n.x - n.bw / 2}" y="${n.y - bh / 2}" width="${n.bw}" height="${bh}" rx="9" fill="#fff" stroke="${U(n.text) ? "#c0392b" : o.color || ink}" stroke-width="1.6"/>`;
        s += `<text x="${n.x}" y="${n.y - (ls.length - 1) * 6.5 + 4}" font-size="11.5" text-anchor="middle" fill="${red(n.text)}">${tsp(ls, n.x, 13)}</text>`;
      }
    });
    return s + "</svg>";
  }
  return { esc, wrapT, ICON, contourIcon, chip, mockSVG, bpmnSVG };
})();
