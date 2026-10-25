/**
 * Сценарий приёмки страницей (ADR-0007 rev10): то, что заказчик видит в
 * правой панели при согласовании HowToDemo.
 *
 *  - сверху — UserFlow всего сценария (Mermaid): путь заказчика по экранам и
 *    что он проверяет на каждом;
 *  - ниже — раскадровка по шагам, по умолчанию свёрнута: картинка экрана
 *    (mock.ts — рисунок из poh-blueprint-writer), «Делаю», «Вижу»;
 *  - замечания: выделил текст → правая кнопка мыши → замечание. Оно сразу
 *    уходит в строку ввода dsh (postMessage родителю — клиент customer-form)
 *    и копится в корзине страницы; если строка ввода недоступна, промт из
 *    корзины копируется кнопкой (как в bft-html-export poh-bft-writer).
 */
import type { AcceptanceDemo } from './demo.js'
import { defaultMock, deviceOf, mockSVG, parseMock } from './mock.js'

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.min.js'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Подпись узла Mermaid: без кавычек и разметки, перенос по ~28 символов. */
function label(text: string, width = 28): string {
  const words = text.replace(/["`<>{}[\]|#]/g, ' ').replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = ''
    }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.slice(0, 4).join('<br/>')
}

/** UserFlow приёмки: старт → (экран + действие → проверка) × N → приёмка. */
export function userFlowMermaid(demo: AcceptanceDemo): string {
  const lines = ['flowchart TD', `  start(["🧑 Заказчик<br/>${label(demo.where)}"])`]
  demo.steps.forEach((step, i) => {
    lines.push(`  s${i}["<b>${i + 1} · ${label(step.screen, 24)}</b><br/>▶ ${label(step.action)}"]`)
    lines.push(`  c${i}{{"✓ ${label(step.expect)}"}}`)
  })
  lines.push(`  done(["✔ Работа принята<br/>${label(demo.done)}"])`)
  const chain = ['start', ...demo.steps.flatMap((_, i) => [`s${i}`, `c${i}`]), 'done']
  lines.push(`  ${chain.join(' --> ')}`)
  lines.push('  classDef act fill:#ffffff,stroke:#2b2b2b,color:#1f1f1f')
  lines.push('  classDef chk fill:#eef7ee,stroke:#2f6b2a,color:#1f3d1c')
  lines.push('  classDef term fill:#f2f0ec,stroke:#9a958c,color:#1f1f1f')
  lines.push(`  class ${demo.steps.map((_, i) => `s${i}`).join(',')} act`)
  lines.push(`  class ${demo.steps.map((_, i) => `c${i}`).join(',')} chk`)
  lines.push('  class start,done term')
  return lines.join('\n')
}

function stepsWord(n: number): string {
  const tens = n % 100, ones = n % 10
  if (tens >= 11 && tens <= 14) return `${n} шагов`
  return `${n} ${ones === 1 ? 'шаг' : ones >= 2 && ones <= 4 ? 'шага' : 'шагов'}`
}

export interface DemoPageOptions {
  sessionId: string
  rev: number
  taskId?: number
  approved?: string
}

export function demoPageHtml(demo: AcceptanceDemo, options: DemoPageOptions): string {
  const flow = userFlowMermaid(demo)
  const understood = [['ASIS — как сейчас', demo.asis], ['GAP — что не устраивает', demo.gap], ['TOBE — как должно стать', demo.tobe]]
    .filter(([, v]) => v?.trim()) as [string, string][]
  const unclear = (demo.unclear ?? []).filter((u) => u.trim())
  const steps = demo.steps.map((step, i) => {
    const device = deviceOf(step.device, step.screen)
    const svg = mockSVG(device, step.mock?.trim() ? parseMock(step.mock) : defaultMock(step.screen, step.expect), step.screen)
    const section = `Шаг ${i + 1} · ${step.screen}`
    return `<li class="step" data-section="${esc(section)}">
  <div class="pic">${svg}</div>
  <div class="body">
    <div class="num">${i + 1}</div>
    <h3>${esc(step.screen)}</h3>
    <p class="do"><span class="k">▶ Делаю</span>${esc(step.action)}</p>
    <p class="see"><span class="k">✓ Вижу</span>${esc(step.expect)}</p>
  </div>
</li>`
  }).join('\n')
  const data = { key: `cf-remarks:${options.sessionId}:${options.rev}`, title: demo.title }
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Сценарий приёмки — ${esc(demo.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header data-section="Заголовок">
    <div class="eyebrow">Сценарий приёмки${options.taskId ? ` · заявка #${options.taskId}` : ''}${options.approved ? ` · <span class="ok">согласован ${esc(options.approved)}</span>` : ''}</div>
    <h1>${esc(demo.title)}</h1>
    <p class="where">${esc(stepsWord(demo.steps.length))} · проверяю: ${esc(demo.where)}</p>
    <p class="tip">Выделите текст и нажмите правую кнопку мыши — замечание сразу попадёт в строку ввода. Когда замечания собраны, нажмите «Нужны правки» под карточкой и отправьте сообщение.</p>
  </header>

  <section data-section="Путь приёмки (UserFlow)">
    <h2>Путь приёмки</h2>
    <div class="mm" id="flow"><pre class="mermaid">${esc(flow)}</pre></div>
  </section>
${understood.length ? `
  <section data-section="Как я понял задачу">
    <h2>Как я понял задачу</h2>
    ${understood.map(([head, value]) => `<p><b>${esc(head)}.</b> ${esc(value)}</p>`).join('\n    ')}
  </section>` : ''}

  <details class="story" data-section="Раскадровка по шагам">
    <summary><h2>Раскадровка по шагам</h2><span class="hint">${esc(stepsWord(demo.steps.length))} — что и где я проверяю. Нажмите, чтобы раскрыть</span></summary>
    <ol class="steps">
${steps}
    </ol>
  </details>

  <section data-section="Работа принята, если">
    <h2>Работа принята, если</h2>
    <p>${esc(demo.done)}</p>
  </section>
${unclear.length ? `
  <section class="unclear" data-section="Не нашёл в материалах">
    <h2>Не нашёл в материалах или есть противоречие</h2>
    <ul>${unclear.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>
  </section>` : ''}
</main>

<div class="pop" id="pop" hidden>
  <div class="quote" id="popQuote"></div>
  <textarea id="popText" rows="3" placeholder="Что поправить? (Ctrl+Enter — сохранить)"></textarea>
  <div class="row"><button id="popSave" class="primary">Добавить замечание</button><button id="popCancel">Отмена</button></div>
</div>
<button class="selbtn" id="selBtn" hidden>💬 Замечание</button>
<div class="toast" id="toast" hidden></div>

<aside class="basket" id="basket">
  <button class="toggle" id="basketToggle">Замечания (<span id="count">0</span>)</button>
  <div class="panel" id="panel" hidden>
    <div id="items"><p class="empty">Замечаний пока нет. Выделите текст и нажмите правую кнопку мыши.</p></div>
    <label>Промт для ассистента</label>
    <textarea id="prompt" readonly rows="6"></textarea>
    <div class="row"><button id="sendAll" class="primary">Всё в строку ввода</button><button id="copy">Скопировать промт</button></div>
  </div>
</aside>

<script>window.CF_DEMO = ${JSON.stringify(data).replace(/</g, '\\u003c')};</script>
<script src="${MERMAID_CDN}"></script>
<script>${SCRIPT}</script>
</body>
</html>`
}

const STYLE = `
:root { --bg:#ffffff; --fg:#1f1f1f; --muted:#6f6a62; --line:#e4e0d8; --card:#faf9f6; --accent:#2f6b2a; --warn:#b7791f; --pop:#ffffff; --sel:#fff3c4; }
@media (prefers-color-scheme: dark) { :root { --bg:#16161a; --fg:#ececec; --muted:#a29d94; --line:#2e2e34; --card:#1d1d22; --accent:#7fc779; --warn:#e0a84a; --pop:#24242a; --sel:#5a4a12; } }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 20px 18px 120px; }
::selection { background: var(--sel); }
.eyebrow { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
.eyebrow .ok { color:var(--accent); text-transform:none; }
h1 { font-size:22px; line-height:1.25; margin:4px 0 6px; }
h2 { font-size:16px; margin:22px 0 10px; }
h3 { font-size:15px; margin:0 0 6px; }
.where { margin:0; color:var(--muted); }
.tip { margin:10px 0 0; font-size:12.5px; color:var(--muted); border-left:3px solid var(--line); padding-left:8px; }
.mm { background:#fff; border:1px solid var(--line); border-radius:12px; padding:12px; overflow-x:auto; }
.mm pre.mermaid { margin:0; white-space:pre-wrap; color:#1f1f1f; font-size:12px; }
.mm.raw::before { content:"Схема — текстом: mermaid не загрузился (нет сети?)"; display:block; color:#b7791f; font-size:12px; margin-bottom:6px; }
details.story { border:1px solid var(--line); border-radius:12px; padding:2px 14px 6px; margin-top:22px; background:var(--card); }
details.story > summary { cursor:pointer; list-style:none; padding:10px 0; }
details.story > summary::-webkit-details-marker { display:none; }
details.story > summary h2 { display:inline; margin:0; }
details.story > summary h2::before { content:"▸ "; color:var(--muted); }
details.story[open] > summary h2::before { content:"▾ "; }
details.story > summary .hint { display:block; color:var(--muted); font-size:12.5px; margin-top:2px; }
ol.steps { list-style:none; padding:0; margin:6px 0 8px; display:grid; gap:12px; }
.step { display:grid; grid-template-columns: 120px 1fr; gap:14px; align-items:start; padding:12px; border:1px solid var(--line); border-radius:12px; background:var(--bg); }
.step .pic svg { width:120px; height:auto; display:block; }
.step .body { position:relative; }
.step .num { position:absolute; right:0; top:0; width:24px; height:24px; border-radius:50%; background:var(--accent); color:#fff; font-weight:700; font-size:12px; display:grid; place-items:center; }
.step p { margin:4px 0; }
.step .k { display:inline-block; min-width:74px; font-weight:600; }
.step .see .k { color:var(--accent); }
.unclear h2 { color:var(--warn); }
.pop { position:absolute; z-index:20; width:min(340px, calc(100vw - 24px)); background:var(--pop); border:1px solid var(--line); border-radius:12px; padding:10px; box-shadow:0 10px 30px rgba(0,0,0,.25); }
.pop .quote { font-size:12.5px; color:var(--muted); margin-bottom:6px; max-height:5em; overflow:hidden; }
textarea { width:100%; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:8px; padding:8px; font:inherit; resize:vertical; }
.row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
button { font:inherit; border:1px solid var(--line); background:var(--card); color:var(--fg); border-radius:8px; padding:6px 12px; cursor:pointer; }
button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
.selbtn { position:absolute; z-index:19; padding:4px 10px; font-size:12.5px; box-shadow:0 4px 14px rgba(0,0,0,.2); }
.toast { position:fixed; left:50%; transform:translateX(-50%); bottom:84px; background:var(--fg); color:var(--bg); padding:8px 14px; border-radius:10px; font-size:13px; z-index:30; }
.basket { position:fixed; right:12px; bottom:12px; z-index:25; width:min(380px, calc(100vw - 24px)); }
.basket .toggle { float:right; background:var(--accent); border-color:var(--accent); color:#fff; box-shadow:0 4px 14px rgba(0,0,0,.2); }
.basket .panel { clear:both; margin-bottom:8px; background:var(--pop); border:1px solid var(--line); border-radius:12px; padding:10px; box-shadow:0 10px 30px rgba(0,0,0,.25); max-height:70vh; overflow:auto; }
.basket label { display:block; font-size:12px; color:var(--muted); margin:10px 0 4px; }
.item { border-bottom:1px solid var(--line); padding:6px 0; font-size:13px; }
.item .sec { color:var(--muted); font-size:12px; }
.item .del { float:right; font-size:12px; padding:0 6px; }
.empty { color:var(--muted); font-size:13px; margin:0; }
@media (max-width: 520px) { .step { grid-template-columns: 1fr; } .step .pic svg { width:110px; } }
`

/* Скрипт страницы: Mermaid, выделение → замечание, корзина, связь с dsh. */
const SCRIPT = `
(function () {
  "use strict";
  var CFG = window.CF_DEMO;
  var dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  if (window.mermaid) {
    try {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral",
        fontFamily: "Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif", themeVariables: { fontSize: "13px" },
        flowchart: { useMaxWidth: true, htmlLabels: true, padding: 8, nodeSpacing: 26, rankSpacing: 30, wrappingWidth: 220 } });
      mermaid.run({ querySelector: ".mermaid" }).catch(function () { document.getElementById("flow").classList.add("raw"); });
    } catch (e) { document.getElementById("flow").classList.add("raw"); }
  } else document.getElementById("flow").classList.add("raw");

  var items = [];
  try { items = JSON.parse(localStorage.getItem(CFG.key) || "[]"); } catch (e) { items = []; }
  function save() { try { localStorage.setItem(CFG.key, JSON.stringify(items)); } catch (e) {} }
  var $ = function (id) { return document.getElementById(id); };

  function line(item, i) {
    return (i + 1) + ". [" + item.section + "]" + (item.quote ? " (по фрагменту «" + item.quote + "»)" : "") + " " + item.text;
  }
  function header() { return "Поправь сценарий приёмки «" + CFG.title + "» по моим замечаниям:"; }
  function prompt() {
    return [header()].concat(items.map(line), ["", "Покажи исправленный сценарий на согласование."]).join("\\n");
  }
  function render() {
    $("count").textContent = items.length;
    var box = $("items");
    box.innerHTML = "";
    if (!items.length) { box.innerHTML = '<p class="empty">Замечаний пока нет. Выделите текст и нажмите правую кнопку мыши.</p>'; }
    items.forEach(function (item, i) {
      var div = document.createElement("div"); div.className = "item";
      var del = document.createElement("button"); del.className = "del"; del.textContent = "удалить";
      del.onclick = function () { items.splice(i, 1); save(); render(); };
      var sec = document.createElement("div"); sec.className = "sec"; sec.textContent = (i + 1) + ". " + item.section + (item.quote ? " · «" + item.quote + "»" : "");
      var txt = document.createElement("div"); txt.textContent = item.text;
      div.appendChild(del); div.appendChild(sec); div.appendChild(txt); box.appendChild(div);
    });
    $("prompt").value = items.length ? prompt() : "";
  }
  function toast(text) {
    var t = $("toast"); t.textContent = text; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* Связь с dsh: клиент customer-form вставляет текст в строку ввода и отвечает ack. */
  var acked = {};
  window.addEventListener("message", function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== "customer-form/remark-ack") return;
    acked[e.data.id] = e.data.ok;
  });
  function toComposer(text, done) {
    var id = Math.random().toString(36).slice(2);
    if (window.parent === window) { done(false); return; }
    window.parent.postMessage({ type: "customer-form/remark", id: id, text: text }, location.origin);
    setTimeout(function () { done(acked[id] === true); }, 400);
  }

  function sectionOf(node) {
    var el = node && (node.nodeType === 1 ? node : node.parentElement);
    var host = el && el.closest("[data-section]");
    return host ? host.getAttribute("data-section") : "Сценарий";
  }
  var pending = null;
  function openPop(x, y, quote, section) {
    pending = { quote: quote, section: section };
    $("popQuote").textContent = section + (quote ? " · «" + quote + "»" : "");
    var pop = $("pop"); pop.hidden = false;
    var left = Math.min(x, document.documentElement.clientWidth - pop.offsetWidth - 12);
    pop.style.left = Math.max(12, left) + "px"; pop.style.top = (y + window.scrollY + 8) + "px";
    $("popText").value = ""; $("popText").focus();
    $("selBtn").hidden = true;
  }
  function closePop() { $("pop").hidden = true; pending = null; }
  function addRemark() {
    var text = $("popText").value.trim();
    if (!text || !pending) { closePop(); return; }
    var item = { section: pending.section, quote: pending.quote, text: text, ts: new Date().toISOString() };
    items.push(item); save(); render(); closePop();
    var n = items.length;
    var out = (n === 1 ? header() + "\\n" : "\\n") + line(item, n - 1);
    toComposer(out, function (ok) { toast(ok ? "Замечание — в строке ввода. Нажмите «Нужны правки» под карточкой и отправьте" : "Замечание в корзине — скопируйте промт кнопкой внизу"); });
  }
  function selectionQuote() {
    var sel = window.getSelection();
    var text = sel && sel.toString().replace(/\\s+/g, " ").trim();
    if (!text || text.length < 2) return null;
    if (!sel.anchorNode || !document.querySelector("main").contains(sel.anchorNode)) return null;
    return { text: text.length > 200 ? text.slice(0, 200) + "…" : text, sel: sel };
  }
  document.addEventListener("contextmenu", function (e) {
    if (e.shiftKey) return; // Shift — обычное меню браузера
    var q = selectionQuote();
    if (!q) return;
    e.preventDefault();
    openPop(e.clientX, e.clientY, q.text, sectionOf(q.sel.anchorNode));
  });
  /* Для трекпада и планшета — кнопка рядом с выделением. */
  document.addEventListener("mouseup", function (e) {
    if (e.target.closest(".pop, .basket, .selbtn")) return;
    setTimeout(function () {
      var q = selectionQuote(), btn = $("selBtn");
      if (!q) { btn.hidden = true; return; }
      var rect = q.sel.getRangeAt(0).getBoundingClientRect();
      btn.hidden = false;
      btn.style.left = Math.min(rect.right, document.documentElement.clientWidth - 130) + "px";
      btn.style.top = (rect.bottom + window.scrollY + 6) + "px";
      btn.onclick = function () { openPop(rect.left, rect.bottom, q.text, sectionOf(q.sel.anchorNode)); };
    }, 0);
  });
  document.addEventListener("mousedown", function (e) {
    if (!$("pop").hidden && !e.target.closest(".pop")) closePop();
  });
  $("popSave").onclick = addRemark;
  $("popCancel").onclick = closePop;
  $("popText").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addRemark(); }
    if (e.key === "Escape") closePop();
  });
  $("basketToggle").onclick = function () { var p = $("panel"); p.hidden = !p.hidden; };
  $("copy").onclick = function () {
    var text = $("prompt").value; if (!text) return;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast("Промт скопирован"); }, function () {
      $("prompt").select(); document.execCommand("copy"); toast("Промт скопирован");
    });
  };
  $("sendAll").onclick = function () {
    if (!items.length) return;
    toComposer(prompt(), function (ok) { toast(ok ? "Все замечания — в строке ввода" : "Строка ввода недоступна — скопируйте промт"); });
  };
  render();
})();
`
