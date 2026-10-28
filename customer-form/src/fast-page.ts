/**
 * Страницы заказчика для bft-fast (ADR-0007 rev15–18).
 *
 *  - primaryPage — «Первичные требования» (rev18): документ со слов
 *    заказчика на минуту чтения. Что хочет и зачем, как примет работу
 *    (согласованный сценарий), требования с цитатами, что не входит; от
 *    Кортекса — контуры проверки и зоны влияния (с якорями, помечено
 *    «из памяти организации»); открытые вопросы.
 *    «Да, согласен» фиксирует согласование (/api/customer-form.bftFastApprove),
 *    «Добавить требования» и «Поправить» (по выделенному тексту) ставят фразу
 *    в поле ввода чата и включают микрофон — заказчик надиктовывает.
 *    Канонический bft-fast для PO (bft-html-export.py навыка) — по ссылке
 *    «Полная версия для команды» и в заявке.
 *  - waitingPage — пока документ собирается: ход сборки по этапам.
 */
import type { FastProgress } from './bft-fast.js'
import type { PrimaryDoc } from './primary.js'

export interface PrimaryPageOptions {
  sessionId: string
  taskId: number
  approveUrl: string
  fullUrl: string
  approvedAt?: string
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const unquote = (q: string) => q.replace(/^[^:«]{0,60}:\s*/, '').replace(/^«|»$/g, '')
const TAG: Record<string, string> = { зачем: 'Зачем', пользователю: 'Пользователю', 'на экране': 'На экране', система: 'Система', качество: 'Качество' }

function list(items: string[], cls = ''): string {
  return items.length ? `<ul${cls ? ` class="${cls}"` : ''}>${items.join('')}</ul>` : ''
}

function section(n: number, title: string, body: string, note = ''): string {
  if (!body) return ''
  return `<section class="blk" data-section="${esc(title)}"><h2><span class="n">${n}</span>${esc(title)}${note ? `<small>${esc(note)}</small>` : ''}</h2>${body}</section>`
}

export function primaryPage(doc: PrimaryDoc, o: PrimaryPageOptions): string {
  const { args, brief } = doc
  const cortexNote = brief ? `из памяти организации${brief.vault.demo ? ' · демо' : ''}` : ''
  const anchor = (id: string) => `<code class="anc">${esc(id)}</code>`
  let n = 0
  const blocks = [
    section(++n, 'Что хотите и зачем', `<p class="lead">${esc(args.want?.what)}</p>${args.want?.why ? `<p>${esc(args.want.why)}</p>` : ''}${args.want?.quote && unquote(args.want.quote).trim() !== args.want.what?.trim() ? `<p class="q">«${esc(unquote(args.want.quote))}»</p>` : ''}`),
    section(++n, doc.where ? `Как примете работу — ${doc.where}` : 'Как примете работу',
      (doc.howToDemo.length ? `<ol>${doc.howToDemo.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '')
      + (doc.checklist.length ? `<p class="sub">Работа принята, если</p>${list(doc.checklist.map((c) => `<li>${esc(c)}</li>`), 'check')}` : '')),
    section(++n, 'Требования с ваших слов', list((args.requirements ?? []).map((r) => `<li><span class="tag">${esc(TAG[r.kind] ?? r.kind)}</span>${esc(r.text)}<span class="q">«${esc(unquote(r.quote))}»</span></li>`))),
    section(++n, 'Не входит и договорённости', list((args.outOfScope ?? []).map((b) => `<li>${esc(b)}</li>`))),
    brief ? section(++n, 'Где проверять', brief.landscape.length
      ? list(brief.landscape.map((s) => `<li><b>${esc(s.title.replace(/\s*\(демо\)$/, ''))}</b>${s.where_to_check.length ? ` — ${esc(s.where_to_check.join('; '))}` : ''}${s.owner ? `<span class="who">владелец: ${esc(s.owner)}</span>` : ''} ${anchor(s.node_id)}</li>`))
      : '<p class="empty">Память организации не знает систем по этому запросу — контур проверки уточнит команда.</p>', cortexNote) : '',
    brief ? section(++n, 'Чьи зоны затрагивает и к кому обращаться', (brief.people.length || (args.people ?? []).length)
      ? list([
        ...(args.people ?? []).map((p) => `<li><b>${esc(p.name)}</b>${p.role ? ` — ${esc(p.role)}` : ''}${p.about ? `: ${esc(p.about)}` : ''} <span class="who">назвали вы</span></li>`),
        ...brief.people.map((p) => `<li><b>${esc(p.name)}</b> — ${esc(p.role)}${p.contact_for.length ? `: ${esc(p.contact_for.join(', '))}` : ''}${p.zones.length ? `<span class="who">зоны: ${esc(p.zones.join(', '))}</span>` : ''} ${anchor(p.node_id)}</li>`),
      ])
      : '<p class="empty">Память организации не знает владельцев по этому запросу.</p>', cortexNote)
      : section(++n, 'К кому обращаться', list((args.people ?? []).map((p) => `<li><b>${esc(p.name)}</b>${p.role ? ` — ${esc(p.role)}` : ''}${p.about ? `: ${esc(p.about)}` : ''}</li>`))),
    section(++n, 'Открытые вопросы', (args.openQuestions ?? []).length ? `<ol class="oq">${args.openQuestions!.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>` : ''),
  ].join('\n')
  const cfg = JSON.stringify({ sessionId: o.sessionId, approveUrl: o.approveUrl, approvedAt: o.approvedAt ?? null }).replace(/</g, '\\u003c')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Первичные требования · заявка #${o.taskId}</title>
<style>
:root{ --fg:#111; --muted:#6f6f6f; --line:#e6e3dc; --ok:#2f6b2a; --bg:#fff; --soft:#f6f4ef; }
*{ box-sizing:border-box; }
body{ margin:0; background:var(--bg); color:var(--fg); font:15.5px/1.55 Georgia,"Times New Roman",serif; }
.wrap{ max-width:720px; margin:0 auto; padding:1.6rem 1.3rem 4rem; }
.kicker{ font:.7rem/1.3 "Courier New",monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
h1{ font-size:1.45rem; line-height:1.25; margin:.35rem 0 .2rem; }
.meta{ color:var(--muted); font-size:.85rem; margin:0 0 1.2rem; }
.actions{ display:flex; flex-wrap:wrap; gap:.55rem; margin:0 0 1.6rem; position:sticky; top:0; background:var(--bg); padding:.6rem 0; z-index:5; border-bottom:1px solid var(--line); }
.actions button{ font:inherit; font-size:.95rem; padding:.5rem .95rem; cursor:pointer; border:1.5px solid var(--fg); background:var(--bg); color:var(--fg); }
.actions .yes{ background:var(--fg); color:var(--bg); }
.actions .yes[disabled]{ background:var(--ok); border-color:var(--ok); cursor:default; }
.hint{ font-size:.82rem; color:var(--muted); flex-basis:100%; margin:0; }
.hint:empty{ display:none; }
.blk{ margin:0 0 1.5rem; }
.blk h2{ font-size:1.02rem; margin:0 0 .5rem; display:flex; align-items:baseline; gap:.5rem; flex-wrap:wrap; }
.blk h2 .n{ font:.7rem "Courier New",monospace; border:1px solid var(--fg); border-radius:50%; width:1.3rem; height:1.3rem; display:inline-flex; align-items:center; justify-content:center; flex:none; }
.blk h2 small{ font:.68rem "Courier New",monospace; text-transform:uppercase; letter-spacing:.05em; color:#7a5b00; background:#fbf3dc; padding:.05rem .4rem; }
.lead{ font-size:1.1rem; margin:.2rem 0 .4rem; }
ul, ol{ margin:0; padding-left:1.25rem; }
li{ margin:.32rem 0; }
.check{ list-style:none; padding-left:0; }
.check li::before{ content:"☐"; margin-right:.5rem; }
.sub{ font:.72rem "Courier New",monospace; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:.8rem 0 .3rem; }
.tag{ display:inline-block; font:.62rem/1.6 "Courier New",monospace; text-transform:uppercase; border:1px solid var(--line); padding:0 .35rem; margin-right:.45rem; color:var(--muted); vertical-align:1px; }
.q{ display:block; color:var(--muted); font-size:.85rem; font-style:italic; }
p.q{ margin:.2rem 0 0; }
.who{ display:block; color:var(--muted); font-size:.82rem; }
.anc{ font-size:.68rem; color:#8a8a8a; }
.empty{ color:var(--muted); font-style:italic; margin:0; }
.oq li{ color:#7a4b00; }
.full{ margin-top:2rem; font-size:.85rem; }
.full a{ color:inherit; }
#fix{ position:absolute; z-index:20; display:none; font:600 .85rem Georgia,serif; padding:.3rem .65rem; border:1.5px solid var(--fg); background:var(--fg); color:var(--bg); cursor:pointer; }
</style></head><body>
<div class="wrap" data-primary="${esc(o.sessionId)}">
  <div class="kicker">Первичные требования · заявка #${o.taskId}</div>
  <h1>${esc(args.title)}</h1>
  <p class="meta">Записано с ваших слов. Проверьте за минуту: всё ли, что вы будете проверять, здесь есть.</p>
  <div class="actions">
    <button type="button" class="yes" id="yes">Да, согласен</button>
    <button type="button" id="add">Добавить требования</button>
    <p class="hint" id="hint"></p>
  </div>
  <main>
${blocks}
  </main>
  <p class="full">Полная версия для команды — <a href="${esc(o.fullUrl)}" target="_blank" rel="noreferrer">документ bft-fast</a>.</p>
</div>
<button type="button" id="fix">Поправить</button>
<script>
(function(){
  var CFG = ${cfg};
  function $(id){ return document.getElementById(id); }
  function when(iso){ try{ return new Date(iso).toLocaleString("ru-RU", { day:"numeric", month:"long", hour:"2-digit", minute:"2-digit" }); }catch(e){ return iso; } }
  function hint(text){ $("hint").textContent = text; }
  // Связь с чатом: клиент customer-form выполняет действие в поле ввода и отвечает ack.
  var acked = {};
  window.addEventListener("message", function(e){
    if(e.origin !== location.origin || !e.data || e.data.type !== "customer-form/say-ack") return;
    acked[e.data.id] = e.data.ok;
  });
  function post(type, text, done){
    if(window.parent === window){ done(false); return; }
    var id = Math.random().toString(36).slice(2);
    window.parent.postMessage({ type: type, id: id, text: text }, location.origin);
    setTimeout(function(){ done(acked[id] === true); }, 500);
  }
  function compose(text){
    post("customer-form/compose", text, function(ok){
      hint(ok ? "Говорите — что и где поправить или добавить. Остановите запись и отправьте сообщение в чат." : "Напишите или надиктуйте в чат портала: " + text);
    });
  }

  var yes = $("yes");
  function approved(at){ yes.textContent = "Согласовано · " + when(at); yes.disabled = true; }
  if(CFG.approvedAt) approved(CFG.approvedAt);
  yes.addEventListener("click", function(){
    yes.disabled = true;
    fetch(CFG.approveUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || r.status); return v; }); })
      .then(function(v){
        approved(v.approvedAt);
        hint("Документ согласован — PO возьмёт его в проработку.");
        post("customer-form/say", "✅ Да, согласен с документом БФТ.", function(){});
      })
      .catch(function(e){ yes.disabled = false; hint("Не удалось согласовать: " + e.message); });
  });
  $("add").addEventListener("click", function(){ compose("Добавь требования: "); });

  // Выделил фрагмент → «Поправить»: цитата в поле ввода, дальше голосом.
  var fix = $("fix"), picked = "";
  document.addEventListener("mouseup", function(){
    setTimeout(function(){
      var sel = window.getSelection(), text = sel ? sel.toString().replace(/\\s+/g, " ").trim() : "";
      if(!text || !document.querySelector("main").contains(sel.anchorNode)){ fix.style.display = "none"; return; }
      picked = text.slice(0, 160);
      var r = sel.getRangeAt(0).getBoundingClientRect();
      fix.style.left = Math.max(8, Math.min(r.left + window.scrollX, document.documentElement.clientWidth - 120)) + "px";
      fix.style.top = (r.bottom + window.scrollY + 6) + "px";
      fix.style.display = "block";
    }, 0);
  });
  fix.addEventListener("mousedown", function(e){ e.preventDefault(); });
  fix.addEventListener("click", function(){
    fix.style.display = "none";
    var section = "";
    try{ var host = window.getSelection().anchorNode.parentElement.closest("[data-section]"); section = host ? host.getAttribute("data-section") : ""; }catch(e){}
    compose("Поправь в документе" + (section ? " (" + section + ")" : "") + " «" + picked + "»: ");
  });
})();
</script></body></html>`
}

const STAGES: { key: FastProgress['stage']; title: string; note: string }[] = [
  { key: 'approved', title: 'Сценарий приёмки согласован', note: 'Ваше «Согласую» — основа документа' },
  { key: 'submitted', title: 'Заявка передана в беклог', note: 'Постановка и полный контекст — в трекере' },
  { key: 'building', title: 'Раскладываю требования', note: 'Что и где получите, как проверите, к кому обращаться' },
  { key: 'ready', title: 'Сверяю с памятью организации', note: 'Кортекс: где проверять и чьи зоны затрагивает; шаблон bft-fast' },
]

/**
 * Пока модель раскладывает требования: этапы, таймер «из ~3 минут» и полоса,
 * которая плавно ползёт к концу. Страница опрашивает статус и сама
 * превращается в документ, когда он готов.
 */
export function waitingPage(sessionId: string, progress: FastProgress, statusUrl: string): string {
  const cfg = JSON.stringify({ sessionId, statusUrl, startedAt: progress.startedAt, stage: progress.stage }).replace(/</g, '\\u003c')
  const stages = STAGES.map((s, i) => `<li data-stage="${s.key}" data-i="${i}"><span class="dot"></span><div><b>${esc(s.title)}</b><small>${esc(s.note)}</small></div></li>`).join('')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Готовлю БФТ-документ</title>
<style>
:root{ --fg:#111; --muted:#777; --line:#e4e1da; --ok:#2f6b2a; --bg:#fff; }
*{ box-sizing:border-box; }
body{ margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 Georgia,"Times New Roman",serif; }
.wrap{ max-width:520px; margin:0 auto; padding:2.2rem 1.4rem; }
.kicker{ font:.7rem/1.3 "Courier New",monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
h1{ font-size:1.5rem; line-height:1.25; margin:.4rem 0 .3rem; }
.lead{ color:#444; margin:0 0 1.6rem; }
.doc{ position:relative; height:132px; border:1.5px solid var(--fg); padding:16px 18px; overflow:hidden; margin-bottom:1.6rem; }
.doc i{ display:block; height:8px; background:#ece9e3; margin:0 0 10px; transform-origin:left; animation:write 2.8s ease-in-out infinite; }
.doc i:nth-child(1){ width:62%; height:12px; background:#d9d5cc; animation-delay:0s; }
.doc i:nth-child(2){ width:88%; animation-delay:.25s; }
.doc i:nth-child(3){ width:76%; animation-delay:.5s; }
.doc i:nth-child(4){ width:92%; animation-delay:.75s; }
.doc i:nth-child(5){ width:54%; animation-delay:1s; }
.doc .pen{ position:absolute; right:16px; bottom:14px; font:.7rem "Courier New",monospace; color:var(--muted); }
@keyframes write{ 0%{ transform:scaleX(.05); opacity:.4 } 45%,70%{ transform:scaleX(1); opacity:1 } 100%{ transform:scaleX(1); opacity:.35 } }
.bar{ height:4px; background:var(--line); margin:0 0 .4rem; overflow:hidden; }
.bar b{ display:block; height:100%; width:0; background:var(--fg); transition:width 1s linear; }
.time{ font:.75rem "Courier New",monospace; color:var(--muted); display:flex; justify-content:space-between; margin-bottom:1.5rem; }
ol{ list-style:none; margin:0; padding:0; }
li{ display:flex; gap:.8rem; align-items:flex-start; padding:.55rem 0; border-top:1px solid var(--line); color:#aaa; }
li b{ display:block; font-weight:600; }
li small{ display:block; font-size:.8rem; }
.dot{ flex:none; width:16px; height:16px; margin-top:3px; border-radius:50%; border:1.5px solid currentColor; position:relative; }
li.done{ color:var(--fg); }
li.done .dot{ background:var(--ok); border-color:var(--ok); }
li.done .dot::after{ content:""; position:absolute; left:4px; top:1px; width:4px; height:8px; border:solid #fff; border-width:0 2px 2px 0; transform:rotate(45deg); }
li.now{ color:var(--fg); }
li.now .dot{ border-color:var(--fg); animation:pulse 1.2s ease-in-out infinite; }
li.now small{ color:#555; }
@keyframes pulse{ 0%,100%{ box-shadow:0 0 0 0 rgba(17,17,17,.35) } 50%{ box-shadow:0 0 0 6px rgba(17,17,17,0) } }
.foot{ margin-top:1.4rem; font-size:.85rem; color:#555; }
@media (prefers-reduced-motion:reduce){ .doc i, li.now .dot{ animation:none; } }
</style></head><body>
<div class="wrap" data-waiting="${esc(sessionId)}">
  <div class="kicker">Документ на проверку</div>
  <h1>Уже готовлю БФТ-документ</h1>
  <p class="lead">Буквально 3 минуты. Документ откроется здесь сам — ничего обновлять не нужно.</p>
  <div class="doc" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><span class="pen">bft-fast</span></div>
  <div class="bar"><b id="bar"></b></div>
  <div class="time"><span id="elapsed">0:00</span><span>обычно до 3 минут</span></div>
  <ol id="stages">${stages}</ol>
  <p class="foot" id="foot">Пока ждёте: вспомните, кого ещё стоит указать контактом и что вы обязательно проверите при приёмке, — добавите одним сообщением после.</p>
</div>
<script>
(function(){
  var CFG = ${cfg};
  var ORDER = ["approved", "submitted", "building", "ready"];
  function paint(stage){
    var at = ORDER.indexOf(stage);
    document.querySelectorAll("#stages li").forEach(function(li){
      var i = Number(li.getAttribute("data-i"));
      li.className = i <= at ? "done" : (i === at + 1 ? "now" : "");
    });
  }
  var started = Date.parse(CFG.startedAt) || Date.now();
  function tick(){
    var s = Math.max(0, Math.round((Date.now() - started) / 1000));
    document.getElementById("elapsed").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    // К концу трёх минут полоса подходит к 95% и дальше почти не движется.
    document.getElementById("bar").style.width = (95 * (1 - Math.exp(-s / 70))).toFixed(1) + "%";
    // Дольше обычного — скорее всего ассистент ждёт ответа в чате.
    if(s > 240) document.getElementById("foot").textContent = "Дольше обычного. Загляните в чат слева: возможно, ассистент задал вопрос — ответьте, и сборка продолжится.";
  }
  function poll(){
    fetch(CFG.statusUrl + "?session=" + encodeURIComponent(CFG.sessionId), { cache: "no-store" })
      .then(function(r){ return r.json(); })
      .then(function(v){ paint(v.stage); if(v.stage === "ready" || v.stage === "none") location.reload(); })
      .catch(function(){});
  }
  paint(CFG.stage); tick();
  setInterval(tick, 1000);
  setInterval(poll, 2000);
})();
</script></body></html>`
}
