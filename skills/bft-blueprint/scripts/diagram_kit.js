/* bft-blueprint · схемы как код. Разбор и проверка блоков ```seq``` и ```idef0``` — близнец
   diagram_dsl.py: те же правила, коды и сообщения (совпадение проверяет test-bft-blueprint.sh).
   Рисунки — статичные функции: sequence с линией видимости, IDEF0 — контекст и декомпозиция.
   Подключается после page_kit.js. Грамматика — resources/diagram_dsl.md. */
const BPD = (function () {
  "use strict";
  const KINDS = { "человек": "p", "интерфейс": "i", "система": "s", "внешний": "x" };
  const MAX_STEPS = 12, MAX_PARTS = 6, MAX_MSG = 70, MAX_DESC = 240, MAX_LABEL = 60, MIN_FN = 2, MAX_FN = 6;
  const FENCE_RE = /^```\s*(seq|idef0)\b\s*(.*?)\s*$/, FENCE_END = /^```\s*$/;
  const SEQ_ID = /^П\d+$/, IDEF_ID = /^\d{1,2}\.\d{1,2}$/;
  const PID = "[A-Za-z][A-Za-z0-9]{0,7}";
  const MSG_RE = new RegExp(`^(${PID})\\s*(-->|->)\\s*(${PID})\\s*:\\s*(.*)$`);
  const NOMSG_RE = new RegExp(`^(${PID})\\s*(-->|->)\\s*(${PID})\\s*$`);
  const DECL_RE = new RegExp(`^(человек|интерфейс|система|внешний)\\s+(${PID})\\s*:\\s*(.*)$`);
  const IF_RE = /^если(?=[\s:]|$)[\s:]*(.*)$/, ELSE_RE = /^иначе(?=[\s:]|$)[\s:]*(.*)$/, END_RE = /^конец$/;
  const DESC_RE = /^описание\s*:\s*(.*)$/;
  const KEY_RE = /^(функция|входы?|управление|регуляторы|выходы?|механизмы?)\s*:\s*(.*)$/;
  const FN_RE = /^A(\d+)\s*[:.]?\s*(.*)$/;
  const KEY_OF = { "функция": "fn", "вход": "in", "входы": "in", "управление": "ctl", "регуляторы": "ctl", "выход": "out", "выходы": "out", "механизм": "mech", "механизмы": "mech" };
  const KEY_NAME = { fn: "функция", in: "вход", ctl: "управление", out: "выход", mech: "механизм" };
  const len = s => [...s].length;
  const issue = (out, line, level, code, msg) => out.push({ line, level, code, msg });
  const sortIssues = iss => iss.slice().sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  function splitValues(raw) {
    const vals = []; let cur = "", depth = 0;
    for (const ch of raw) {
      if (ch === "[") depth++; else if (ch === "]") depth = Math.max(0, depth - 1);
      if (ch === ";" && depth === 0) { vals.push(cur); cur = "" } else cur += ch;
    }
    vals.push(cur);
    return vals.map(v => v.trim()).filter(v => v && !["—", "-", "–"].includes(v));
  }
  const normLabel = s => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "").trim();

  function extract(text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(FENCE_RE);
      if (!m) continue;
      const kind = m[1], bid = m[2].trim(), body = []; let j = i + 1;
      while (j < lines.length && !FENCE_END.test(lines[j].trim())) { body.push(lines[j]); j++ }
      const res = { kind, id: bid, body, offset: i + 1, issues: [] };
      if (j >= lines.length) issue(res.issues, body.length, "ERROR", "DG000", "блок не закрыт строкой ```");
      if (!(kind === "seq" ? SEQ_ID : IDEF_ID).test(bid))
        issue(res.issues, 0, "ERROR", "DG000", `заголовок блока: \`\`\`seq П3\`\`\` — ID процесса, \`\`\`idef0 1.2\`\`\` — ID задачи, а не «${bid}»`);
      return res;
    }
    return { kind: "", id: "", body: [], offset: 0, issues: [{ line: 0, level: "ERROR", code: "DG000", msg: "нет блока ```seq П3 … ``` или ```idef0 1.2 … ```" }] };
  }

  /* ---------- seq ---------- */
  function parseSeq(body, parts) {
    const iss = [], local = {}, declLine = {}, steps = [];
    let desc = "", descLine = 0, br = "", brLine = 0, groupN = 0, last = 0;
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    body.forEach((raw, idx) => {
      const n = idx + 1, ln = raw.trim();
      if (!ln || ln.startsWith("//")) return;
      last = n;
      let m = ln.match(DESC_RE);
      if (m) {
        if (!m[1].trim()) issue(iss, n, "ERROR", "DG002", "пустое описание");
        else if (descLine) issue(iss, n, "ERROR", "DG002", `описание уже есть (строка ${descLine}) — одно на процесс`);
        else {
          desc = m[1].trim(); descLine = n;
          if (len(desc) > MAX_DESC) issue(iss, n, "WARN", "DG026", `описание ${len(desc)} знаков (больше ${MAX_DESC}) — суть в двух фразах`);
        }
        return;
      }
      m = ln.match(DECL_RE);
      if (m) {
        const kind = KINDS[m[1]], pid = m[2], name = m[3].trim();
        if (!name) issue(iss, n, "ERROR", "DG004", `участник ${pid}: нет имени`);
        else if (has(local, pid)) issue(iss, n, "ERROR", "DG004", `участник ${pid} уже объявлен (строка ${declLine[pid]})`);
        else if (has(parts, pid) && parts[pid][1] !== kind) issue(iss, n, "ERROR", "DG004", `участник ${pid} в карте — другого вида; новый — другой ID`);
        else { local[pid] = [name, kind]; declLine[pid] = n }
        return;
      }
      m = ln.match(IF_RE);
      if (m) {
        if (br) issue(iss, n, "ERROR", "DG003", `ветка внутри ветки (открыта в строке ${brLine}) — закройте «конец» или разделите процесс`);
        else if (!m[1].trim()) issue(iss, n, "ERROR", "DG003", "«если» без условия");
        else { br = "если: " + m[1].trim(); brLine = n; groupN = 0 }
        return;
      }
      m = ln.match(ELSE_RE);
      if (m) {
        if (!br) issue(iss, n, "ERROR", "DG003", "«иначе» без «если»");
        else {
          if (groupN === 0) issue(iss, n, "ERROR", "DG006", `ветка «${br}» без шагов`);
          br = "иначе: " + (m[1].trim() || "в остальных случаях"); brLine = n; groupN = 0;
        }
        return;
      }
      if (END_RE.test(ln)) {
        if (!br) issue(iss, n, "ERROR", "DG003", "«конец» без «если»");
        else { if (groupN === 0) issue(iss, n, "ERROR", "DG006", `ветка «${br}» без шагов`); br = ""; groupN = 0 }
        return;
      }
      m = ln.match(MSG_RE);
      if (m) {
        const src = m[1], arrow = m[2], dst = m[3], text = m[4].trim();
        const bad = [...new Set([src, dst])].filter(x => !has(parts, x) && !has(local, x));
        bad.forEach(x => issue(iss, n, "ERROR", "DG007", `участника ${x} нет — ID из «Участников» или объявление «система ${x}: Имя»`));
        if (!text) issue(iss, n, "ERROR", "DG005", "пустое сообщение после «:»");
        if (bad.length || !text) return;
        if (len(text) > MAX_MSG) issue(iss, n, "WARN", "DG022", `сообщение ${len(text)} знаков (больше ${MAX_MSG})`);
        const kind = arrow === "-->" ? "ответ" : "вызов";
        if (kind === "ответ" && src !== dst && !steps.some(s => s.src === dst && s.dst === src && s.kind === "вызов"))
          issue(iss, n, "WARN", "DG024", `ответ ${src} --> ${dst} без вызова ${dst} -> ${src} — вызов «->», ответ «-->»`);
        steps.push({ branch: br, src, dst, text, kind, line: n }); groupN++;
        return;
      }
      if (NOMSG_RE.test(ln)) { issue(iss, n, "ERROR", "DG005", "нет сообщения — «A -> B: что передаётся»"); return }
      issue(iss, n, "ERROR", "DG001", "строка не разобрана: «A -> B: сообщение», «B --> A: ответ», «если …», «иначе …», «конец», «описание: …» или «система ID: Имя»");
    });
    if (br) issue(iss, last || 1, "ERROR", "DG003", `ветка из строки ${brLine} не закрыта — «конец»`);
    if (!steps.length) issue(iss, last || 1, "ERROR", "DG008", "нет ни одного шага «A -> B: сообщение»");
    const used = [...new Set(steps.flatMap(s => [s.src, s.dst]))];
    Object.keys(declLine).forEach(pid => { if (!used.includes(pid)) issue(iss, declLine[pid], "WARN", "DG023", `участник ${pid} объявлен, но не участвует в шагах`) });
    if (steps.length > MAX_STEPS) issue(iss, steps[MAX_STEPS].line, "WARN", "DG020", `${steps.length} шагов (больше ${MAX_STEPS}) — схема перестаёт читаться, раздели процесс`);
    if (used.length > MAX_PARTS) issue(iss, 1, "WARN", "DG021", `${used.length} участников (больше ${MAX_PARTS}) — раздели процесс`);
    if (steps.length && !desc) issue(iss, 1, "WARN", "DG025", "нет «описание: …» — суть процесса одной-двумя фразами");
    return { kind: "seq", desc, parts: local, steps, issues: sortIssues(iss) };
  }

  /* ---------- idef0 ---------- */
  const box = line => ({ in: [], ctl: [], out: [], mech: [], line, keys: {} });
  function parseIdef(body) {
    const iss = [], top = box(1), kids = [];
    let fn = "", fnLine = 0, cur = top;
    body.forEach((raw, idx) => {
      const n = idx + 1, ln = raw.trim();
      if (!ln || ln.startsWith("//")) return;
      let m = ln.match(KEY_RE);
      if (m) {
        const key = KEY_OF[m[1]];
        if (key === "fn") {
          if (cur !== top || fnLine) issue(iss, n, "ERROR", "DG031", "«функция:» — одна, до функций A1…An");
          else { fn = m[2].trim(); fnLine = n }
          return;
        }
        if (cur.keys[key]) { issue(iss, n, "ERROR", "DG031", `«${KEY_NAME[key]}» уже есть (строка ${cur.keys[key]}) — значения через «;» в одной строке`); return }
        cur.keys[key] = n; cur[key] = splitValues(m[2]);
        cur[key].forEach(v => { if (len(v) > MAX_LABEL) issue(iss, n, "WARN", "DG042", `подпись ${len(v)} знаков (больше ${MAX_LABEL}): «${[...v].slice(0, 30).join("")}…»`) });
        return;
      }
      m = ln.match(FN_RE);
      if (m) {
        const k = parseInt(m[1], 10), name = m[2].trim();
        if (k !== kids.length + 1) issue(iss, n, "ERROR", "DG033", `функция A${k}: номера по порядку — ожидается A${kids.length + 1}`);
        if (!name) issue(iss, n, "ERROR", "DG033", `функция A${k} без названия`);
        cur = box(n); cur.n = k; cur.i = kids.length; cur.name = name; kids.push(cur);
        return;
      }
      issue(iss, n, "ERROR", "DG030", "строка не разобрана: «вход: …», «управление: …», «выход: …», «механизм: …», «функция: …» или «A1 Название функции»");
    });
    ["in", "ctl", "out", "mech"].forEach(key => { if (!top[key].length) issue(iss, top.keys[key] || 1, "ERROR", "DG032", `пустое поле «${KEY_NAME[key]}» блока`) });
    if (kids.length && !(MIN_FN <= kids.length && kids.length <= MAX_FN)) issue(iss, kids[0].line, "ERROR", "DG033", `функций ${kids.length} — декомпозиция от ${MIN_FN} до ${MAX_FN}`);
    if (kids.length) {
      const boundary = new Set([...top.in, ...top.ctl].map(normLabel)), made = {}, mechs = new Set(top.mech.map(normLabel));
      kids.forEach(b => b.out.forEach(v => { const l = normLabel(v); if (!(l in made)) made[l] = b.i }));
      kids.forEach(b => {
        ["ctl", "out"].forEach(key => { if (!b[key].length) issue(iss, b.line, "ERROR", "DG034", `у A${b.n} нет «${KEY_NAME[key]}» — в IDEF0 у каждой функции есть управление и выход`) });
        ["in", "ctl"].forEach(key => b[key].forEach(v => {
          const l = normLabel(v);
          if (!boundary.has(l) && (!(l in made) || made[l] === b.i))
            issue(iss, b.keys[key], "ERROR", "DG035", `«${v}» у A${b.n} ниоткуда не приходит — это вход или управление блока либо выход другой функции`);
        }));
        b.mech.forEach(v => { if (!mechs.has(normLabel(v))) issue(iss, b.keys.mech, "WARN", "DG041", `механизм «${v}» у A${b.n} — не из механизмов блока`) });
      });
      const topOut = new Set(top.out.map(normLabel));
      top.out.forEach(v => { if (!(normLabel(v) in made)) issue(iss, top.keys.out || 1, "ERROR", "DG036", `выход блока «${v}» не выдаёт ни одна функция`) });
      const consumed = new Set(kids.flatMap(b => [...b.in, ...b.ctl]).map(normLabel));
      kids.forEach(b => b.out.forEach(v => { const l = normLabel(v); if (!topOut.has(l) && !consumed.has(l)) issue(iss, b.keys.out, "WARN", "DG040", `выход «${v}» у A${b.n} никуда не идёт`) }));
    }
    const clean = b => ({ in: b.in, ctl: b.ctl, out: b.out, mech: b.mech });
    return { kind: "idef0", fn, ...clean(top), children: kids.map(b => ({ n: b.n, name: b.name, ...clean(b), line: b.line })), issues: sortIssues(iss) };
  }

  function checkText(text, parts) {
    const ex = extract(text);
    if (!ex.kind) return { kind: "", id: "", issues: ex.issues };
    const res = ex.kind === "seq" ? parseSeq(ex.body, parts || {}) : parseIdef(ex.body);
    res.id = ex.id; res.issues = sortIssues([...ex.issues, ...res.issues]);
    return res;
  }

  /* ---------- шпаргалка грамматики — для промпта ИИ (полная — resources/diagram_dsl.md) ---------- */
  const GRAMMAR = {
    seq: `Блок \`\`\`seq <ID процесса> … \`\`\`, по строке на шаг:
описание: суть процесса одной-двумя фразами (до ${MAX_DESC} знаков)
A -> B: что передаётся        — вызов (сплошная стрелка)
B --> A: что вернулось        — ответ на вызов A -> B (пунктир)
A -> A: проверка внутри A     — шаг внутри участника
если <условие> … иначе <условие> … конец — развилка из БФТ, без вложенных веток
система ID: Имя (или человек / интерфейс / внешний) — новый участник; ID — латиница до 8 знаков
// комментарий
До ${MAX_STEPS} шагов и ${MAX_PARTS} участников, сообщение до ${MAX_MSG} знаков. Неизвестное — [УТОЧНИТЬ у <кого>].`,
    idef0: `Блок \`\`\`idef0 <ID задачи> … \`\`\`:
функция: название (по умолчанию — текст задачи)
вход: что преобразуется; через «;»
управление: правила и ограничения с ID требований
выход: результат
механизм: кто и чем исполняет
A1 Название функции        — декомпозиция: от ${MIN_FN} до ${MAX_FN} функций, номера по порядку
  вход: …                  — вход или управление блока либо выход другой функции, подписи совпадают дословно
  управление: …            — обязательно у каждой функции
  выход: …                 — обязательно; каждый выход блока выдаёт какая-то функция
  механизм: …              — из механизмов блока
Подпись до ${MAX_LABEL} знаков. Неизвестное — [УТОЧНИТЬ у <кого>].`
  };

  /* ---------- источник блока по модели (для редактора и «Скопировать блок») ---------- */
  const KIND_WORD = { p: "человек", i: "интерфейс", s: "система", x: "внешний" };
  function seqSource(id, m) {
    const out = ["```seq " + id];
    if (m.desc) out.push("описание: " + m.desc);
    Object.keys(m.parts || {}).forEach(k => out.push(`${KIND_WORD[m.parts[k][1]]} ${k}: ${m.parts[k][0]}`));
    let cur = "";
    m.steps.forEach(s => {
      if (s.branch !== cur) {
        if (cur && !s.branch) out.push("конец");
        if (s.branch) out.push(s.branch.replace(/^(если|иначе):\s*/, "$1 "));
        cur = s.branch;
      }
      out.push(`${cur ? "  " : ""}${s.src} ${s.kind === "ответ" ? "-->" : "->"} ${s.dst}: ${s.text}`);
    });
    if (cur) out.push("конец");
    return out.concat("```").join("\n");
  }
  function idefSource(id, m) {
    const kv = (k, v, pad) => v.length ? [`${pad}${k}: ${v.join("; ")}`] : [];
    const out = ["```idef0 " + id];
    if (m.fn) out.push("функция: " + m.fn);
    out.push(...kv("вход", m.in, ""), ...kv("управление", m.ctl, ""), ...kv("выход", m.out, ""), ...kv("механизм", m.mech, ""));
    (m.children || []).forEach(c => { out.push("", `A${c.n} ${c.name}`, ...kv("вход", c.in, "  "), ...kv("управление", c.ctl, "  "), ...kv("выход", c.out, "  "), ...kv("механизм", c.mech, "  ")) });
    return out.concat("```").join("\n");
  }

  /* ---------- рисунки ---------- */
  const MARK = "[УТОЧНИТЬ", U = t => String(t || "").includes(MARK);
  const esc = s => BPK.esc(s), wrapT = (t, n) => BPK.wrapT(t, n);
  const tsp = (ls, x, dy) => ls.map((l, i) => `<tspan x="${x}" dy="${i ? dy : 0}">${esc(l)}</tspan>`).join("");
  const halo = 'paint-order="stroke" stroke="#faf9f6" stroke-width="4" stroke-linejoin="round"';
  const partOf = (k, parts, m) => (m.parts && m.parts[k]) || parts[k] || [k, "s"];
  const hiddenKind = (k, parts, m) => "sx".includes(partOf(k, parts, m)[1]);
  function hiddenSteps(m, parts) { return m.steps.map((s, i) => [i + 1, s]).filter(([, s]) => hiddenKind(s.src, parts, m) || hiddenKind(s.dst, parts, m)) }

  /* sequence: люди и интерфейсы слева, системы — справа от линии видимости */
  function seqSVG(m, parts, uid) {
    const order = { p: 0, i: 1, s: 2, x: 3 }, info = k => partOf(k, parts, m), hk = k => "sx".includes(info(k)[1]);
    const mk = "sq" + (uid || "");
    const P = [...new Set(m.steps.flatMap(s => [s.src, s.dst]))].sort((a, b) => order[info(a)[1]] - order[info(b)[1]]);
    const CW = 150, X0 = 20, cx = k => X0 + CW * P.indexOf(k) + CW / 2;
    const W = Math.max(X0 * 2 + CW * P.length, ...m.steps.filter(s => s.src === s.dst).map(s => cx(s.src) + 40 + len(s.text) * 6.3 + X0));
    const rows = []; let cur = "";
    m.steps.forEach(s => { const br = s.branch || ""; if (br !== cur) { if (cur.startsWith("если") && !br.startsWith("иначе")) rows.push({ end: 1 }); if (cur.startsWith("иначе")) rows.push({ end: 1 }); if (br) rows.push({ br }); cur = br } rows.push({ s }) });
    if (cur) rows.push({ end: 1 });
    const H = 70 + rows.reduce((a, r) => a + (r.s ? (r.s.src === r.s.dst ? 40 : 34) : r.br ? 24 : 8), 0) + 16;
    const vis = P.findIndex(hk);
    let s = `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;max-width:100%" role="img" aria-label="Как устроен процесс"><defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#3a3a3a"/></marker></defs>`;
    if (vis > 0) { const xv = X0 + CW * vis; s += `<rect x="${xv}" y="0" width="${W - xv}" height="${H}" fill="#f1f3f7"/><line x1="${xv}" y1="0" x2="${xv}" y2="${H}" stroke="#7d7a73" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${xv + 6}" y="${H - 6}" font-size="10.5" fill="#7d7a73">за линией видимости — скрыто от гостя</text>` }
    P.forEach(k => {
      const x = cx(k), [n, t] = info(k);
      s += `<line x1="${x}" y1="44" x2="${x}" y2="${H - 20}" stroke="#c9c4ba" stroke-dasharray="3 4"/>`;
      s += t === "p" ? `<circle cx="${x}" cy="14" r="7" fill="none" stroke="#1c1c1c" stroke-width="1.5"/><path d="M${x - 11},34 q11,-14 22,0" fill="none" stroke="#1c1c1c" stroke-width="1.5"/><text x="${x}" y="46" font-size="12" font-weight="700" text-anchor="middle">${esc(n)}</text>`
        : `<rect x="${x - 64}" y="8" width="128" height="30" rx="7" fill="${t === "i" ? "#e5f3f4" : t === "x" ? "#f3f1ec" : "#e7edf8"}" stroke="${t === "i" ? "#0f8b8d" : t === "x" ? "#9a958c" : "#2563c9"}" stroke-width="1.2"/><text x="${x}" y="27" font-size="11.5" font-weight="700" text-anchor="middle">${esc(len(n) > 20 ? [...n].slice(0, 19).join("") + "…" : n)}</text>`;
    });
    let y = 70, num = 0, top = 0; const xs = P.map(cx), L = Math.min(...xs) - 50, Rr = Math.max(...xs) + 50;
    rows.forEach(r => {
      if (r.br) { if (r.br.startsWith("если")) top = y; else s += `<line x1="${L}" y1="${y + 2}" x2="${Rr}" y2="${y + 2}" stroke="#9a958c" stroke-dasharray="5 4"/>`; s += `<text x="${L + 6}" y="${y + 16}" font-size="10.5" font-weight="800" fill="#6b6b6b">${esc(r.br.replace(/^если:\s*/, "ЕСЛИ ").replace(/^иначе:\s*/, "ИНАЧЕ "))}</text>`; y += 24; return }
      if (r.end) { s += `<rect x="${L}" y="${top}" width="${Rr - L}" height="${y - top + 4}" rx="6" fill="none" stroke="#9a958c"/>`; y += 8; return }
      const st = r.s; num++; const xa = cx(st.src), xb = cx(st.dst), hid = hk(st.src) || hk(st.dst), col = hid ? "#2563c9" : "#1c1c1c", red = U(st.text);
      const badge = x => `<circle cx="${x}" cy="${y}" r="8" fill="${hid ? "#2563c9" : "#2f6b2a"}"/><text x="${x}" y="${y + 3.5}" font-size="9.5" font-weight="800" fill="#fff" text-anchor="middle">${num}</text>`;
      if (st.src === st.dst) { s += `<path d="M${xa},${y} h28 v16 h-26" fill="none" stroke="${col}" stroke-width="1.4" marker-end="url(#${mk})"/><text x="${xa + 34}" y="${y + 12}" font-size="11.5" fill="${red ? "#c0392b" : col}">${esc(st.text)}</text>` + badge(xa - 12); y += 40; return }
      const dir = xb > xa ? 1 : -1;
      s += `<line x1="${xa}" y1="${y}" x2="${xb - dir * 2}" y2="${y}" stroke="${col}" stroke-width="1.4" ${st.kind === "ответ" ? 'stroke-dasharray="5 4"' : ""} marker-end="url(#${mk})"/><text x="${(xa + xb) / 2}" y="${y - 6}" font-size="11.5" text-anchor="middle" fill="${red ? "#c0392b" : col}">${esc(st.text)}</text>` + badge(xa + dir * 14);
      y += 34;
    });
    return s + "</svg>";
  }

  /* IDEF0 A0: вход слева, выход справа, управление сверху, механизмы снизу */
  function idefSVG(m, o) {
    const bh = Math.max(130, 58 * Math.max(m.in.length, m.out.length)), W = 560, H = 340 + bh, bx = 195, by = 170, bw = 170, col = o.color, mk = "ia" + (o.uid || "");
    const red = x => U(x) ? "#c0392b" : "#1c1c1c";
    let s = `<svg class="idef" viewBox="0 0 ${W} ${H}" role="img" aria-label="IDEF0"><defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1c1c1c"/></marker></defs><rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#faf9f6"/>`;
    const cap = (x, y, txt, a) => `<text x="${x}" y="${y}" font-size="11" font-weight="700" fill="#6b6b6b" letter-spacing=".6" text-anchor="${a}">${txt}</text>`;
    s += cap(8, by - 14, "ВХОД", "start") + cap(W - 8, by - 14, "ВЫХОД", "end") + cap(W / 2, 14, "УПРАВЛЕНИЕ — правила и ограничения", "middle") + cap(W / 2, H - 6, "МЕХАНИЗМЫ — кто и чем исполняет", "middle");
    s += `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="3" fill="#fff" stroke="${col}" stroke-width="2.2" ${o.dashed ? 'stroke-dasharray="6 3"' : ""}/><rect x="${bx}" y="${by}" width="${bw}" height="6" fill="${col}"/>`;
    const fl = wrapT(m.fn || o.title, 18).slice(0, 5); s += `<text x="${bx + bw / 2}" y="${by + bh / 2 - (fl.length - 1) * 8 + 4}" font-size="13.5" font-weight="700" text-anchor="middle">${tsp(fl, bx + bw / 2, 16)}</text><text x="${bx + bw - 6}" y="${by + bh - 6}" font-size="11" fill="#6b6b6b" text-anchor="end">A0</text>`;
    m.in.forEach((v, i) => { const y = by + bh * (i + 1) / (m.in.length + 1), ls = wrapT(v, 22).slice(0, 3); s += `<path d="M8,${y} H${bx}" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#${mk})"/><text x="8" y="${y - 6 - (ls.length - 1) * 15}" font-size="13" fill="${red(v)}">${tsp(ls, 8, 15)}</text>` });
    m.out.forEach((v, i) => { const y = by + bh * (i + 1) / (m.out.length + 1), ls = wrapT(v, 22).slice(0, 3); s += `<path d="M${bx + bw},${y} H${W - 8}" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#${mk})"/><text x="${bx + bw + 8}" y="${y - 6 - (ls.length - 1) * 15}" font-size="13" fill="${red(v)}">${tsp(ls, bx + bw + 8, 15)}</text>` });
    const sideTxt = (arr, topSide) => { const k = arr.length, sl = W / k; arr.forEach((v, i) => { const ax = bx + bw * (i + 1) / (k + 1), tx = sl * i + sl / 2, ls = wrapT(v, Math.max(14, Math.floor(sl / 7.6))).slice(0, 4);
      s += topSide ? `<path d="M${tx},102 L${tx},116 L${ax},136 L${ax},${by}" fill="none" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#${mk})"/><text x="${tx}" y="34" font-size="13" text-anchor="middle" fill="${red(v)}">${tsp(ls, tx, 15)}</text>`
        : `<path d="M${tx},${H - 76} L${tx},${H - 90} L${ax},${by + bh + 26} L${ax},${by + bh}" fill="none" stroke="#1c1c1c" stroke-width="1.6" marker-end="url(#${mk})"/><text x="${tx}" y="${H - 58}" font-size="13" text-anchor="middle" fill="${red(v)}">${tsp(ls, tx, 15)}</text>` }) };
    sideTxt(m.ctl, true); sideTxt(m.mech, false);
    return s + "</svg>";
  }

  /* IDEF0 декомпозиция: функции лесенкой; стрелки между ними — по совпадению подписей выхода и входа */
  function idefDecompSVG(m, o) {
    const K = m.children, n = K.length, bw = 132, gx = 112, gy = 40, mk = "ib" + (o.uid || "");
    const bh = Math.max(70, 42 * Math.max(...K.map(b => Math.max(b.in.length, b.out.length))) + 6);
    const ML = 136, MR = 136, ctlMax = Math.max(...K.map(b => b.ctl.length), 1), mechMax = Math.max(...K.map(b => b.mech.length), 1);
    const MT = 30 + ctlMax * 32, MB = 30 + mechMax * 32;
    const W = ML + n * bw + (n - 1) * gx + MR, H = MT + n * bh + (n - 1) * gy + MB;
    const bx = i => ML + i * (bw + gx), by = i => MT + i * (bh + gy);
    const boundary = new Set([...m.in, ...m.ctl].map(normLabel)), topOut = new Set(m.out.map(normLabel)), made = {};
    K.forEach((b, i) => b.out.forEach(v => { const l = normLabel(v); if (!(l in made)) made[l] = i }));
    const red = x => U(x) ? "#c0392b" : "#1c1c1c";
    const port = (a, b, k, cnt) => a + (b - a) * (k + 1) / (cnt + 1);
    let lines = "", labels = "";
    const arrow = (d, dash) => lines += `<path d="${d}" fill="none" stroke="#1c1c1c" stroke-width="1.5" ${dash ? 'stroke-dasharray="5 3"' : ""} marker-end="url(#${mk})"/>`;
    /* подпись над точкой (y — нижняя строка) или под ней (down: y — верхняя строка); возвращает число строк */
    const label = (x, y, v, a, wmax, down) => { const ls = wrapT(v, wmax).slice(0, 2); labels += `<text x="${x}" y="${down ? y : y - (ls.length - 1) * 13}" font-size="11.5" text-anchor="${a}" fill="${red(v)}" ${halo}>${tsp(ls, x, 13)}</text>`; return ls.length };
    const outY = (i, v) => { const b = K[i], k = b.out.findIndex(x => normLabel(x) === normLabel(v)); return port(by(i), by(i) + bh, k, b.out.length) };
    const chan = {}; const nextChan = j => (chan[j] = (chan[j] || 0) + 1) - 1;
    let fb = 0;
    K.forEach((b, j) => {
      b.in.forEach((v, k) => {
        const y = port(by(j), by(j) + bh, k, b.in.length), l = normLabel(v), src = boundary.has(l) ? -1 : made[l];
        if (src === -1 || src === undefined) { arrow(`M8,${y} H${bx(j)}`); label(10, y - 5, v, "start", 18); return }
        const sy = outY(src, v), sx = bx(src) + bw;
        if (src < j) { const cx = bx(j) - 18 - 9 * nextChan(j); arrow(`M${sx},${sy} H${cx} V${y} H${bx(j)}`); label(sx + 5, sy - 5, v, "start", 14) }
        else { const ox = sx + 16 + 9 * fb, oy = by(j) - 14 - 7 * fb++; arrow(`M${sx},${sy} H${ox} V${oy} H${bx(j) - 22} V${y} H${bx(j)}`, true); label(sx + 5, sy - 5, v, "start", 14) }
      });
      b.ctl.forEach((v, k) => {
        const x = port(bx(j), bx(j) + bw, k, b.ctl.length), l = normLabel(v), src = boundary.has(l) ? -1 : made[l];
        if (src === -1 || src === undefined) { const ty = 16 + k * 32, nl = label(x, ty, v, "middle", 20, true); arrow(`M${x},${ty + nl * 13 - 6} V${by(j)}`); return }
        const sy = outY(src, v), sx = bx(src) + bw;
        if (src < j) { arrow(`M${sx},${sy} H${x} V${by(j)}`); label(sx + 5, sy - 5, v, "start", 14) }
        else { const ox = sx + 16 + 9 * fb, oy = by(j) - 14 - 7 * fb++; arrow(`M${sx},${sy} H${ox} V${oy} H${x} V${by(j)}`, true); label(sx + 5, sy - 5, v, "start", 14) }
      });
      b.mech.forEach((v, k) => { const x = port(bx(j), bx(j) + bw, k, b.mech.length), ty = H - 12 - k * 32, nl = label(x, ty, v, "middle", 20); arrow(`M${x},${ty - 13 * nl} V${by(j) + bh}`) });
      b.out.forEach(v => { if (topOut.has(normLabel(v))) { const y = outY(j, v); arrow(`M${bx(j) + bw},${y} H${W - 8}`); label(W - 10, y - 5, v, "end", 20) } });
    });
    let boxes = "";
    K.forEach((b, i) => {
      const x = bx(i), y = by(i), fl = wrapT(b.name, 16).slice(0, 3);
      boxes += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="3" fill="#fff" stroke="${o.color}" stroke-width="2"/><rect x="${x}" y="${y}" width="${bw}" height="5" fill="${o.color}"/>`;
      boxes += `<text x="${x + bw / 2}" y="${y + bh / 2 - (fl.length - 1) * 7.5 + 3}" font-size="12.5" font-weight="700" text-anchor="middle" fill="${red(b.name)}">${tsp(fl, x + bw / 2, 15)}</text><text x="${x + bw - 5}" y="${y + bh - 5}" font-size="10.5" fill="#6b6b6b" text-anchor="end">A${b.n}</text>`;
    });
    return `<svg class="idef dec" viewBox="0 0 ${W} ${H}" style="width:${W}px" role="img" aria-label="IDEF0 — декомпозиция"><defs><marker id="${mk}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0L10,5L0,10z" fill="#1c1c1c"/></marker></defs><rect x="0" y="0" width="${W}" height="${H}" rx="10" fill="#faf9f6"/>${lines}${boxes}${labels}</svg>`;
  }

  return { GRAMMAR, extract, parseSeq, parseIdef, checkText, splitValues, normLabel, seqSource, idefSource, seqSVG, idefSVG, idefDecompSVG, hiddenSteps, MAX_STEPS };
})();
