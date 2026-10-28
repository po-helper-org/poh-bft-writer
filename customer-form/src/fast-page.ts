/**
 * Страница быстрой версии БФТ глазами заказчика (ADR-0007 rev15–16).
 *
 * Сам документ рендерит bft-html-export.py навыка — та же страница уходит PO в
 * заявку. Узел при выдаче заказчику накладывает поверх неё слой:
 *  - сводка сверху (rev16): что и где получите, как проверите, что
 *    зафиксировано, к кому обращаться, открытые вопросы — на минуту чтения;
 *    канонический документ bft-fast — ниже, целиком;
 *  - «Всё ок — отгружай в Confluence/Jira» → «Да, согласен»: согласование
 *    фиксирует узел (/api/customer-form.bftFastApprove), в чат уходит строка
 *    о согласовании;
 *  - «Добавить требования»: курсор в поле ввода чата и запись голосом —
 *    заказчик надиктовывает, что и где пропущено;
 *  - «Скопировать промт» → «Отправить замечания в чат»: замечания сразу
 *    отправляются сообщением в чат (клиент customer-form: setDraft + submit);
 *  - промт для PO и открытое поле для /bft-deep заказчику не показываются.
 * Хранилище замечаний — то же, что у страницы (bft-comments-<slug>): отметка
 * sentAt не даёт отправить одно замечание дважды.
 *
 * Пока документ собирается — waitingPage(): ход сборки по этапам.
 */
import type { FastInput, FastProgress, FastRequirement } from './bft-fast.js'

export interface CustomerLayer {
  sessionId: string
  slug: string
  approveUrl: string
  /** Согласование этой же версии документа, если было. */
  approvedAt?: string
  /** Сводка сверху документа (rev16). */
  summary?: CustomerSummary
}

export interface CustomerSummary {
  taskId: number
  input: FastInput & { howToDemo?: string[]; requirements: FastRequirement[] }
  where?: string
  done: string[]
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const known = (s: string | undefined) => !!s && !/^\[(УТОЧНИТЬ|ASIS не озвучен|роль не подтверждена|не указано)/.test(s.trim())

const KIND: Record<string, string> = { БТ: 'Зачем', ПТ: 'Пользователю', ИТ: 'На экране', ФТ: 'Система', НФТ: 'Качество' }

const STYLE = `<style id="customer-layer-style">
#promptOut{ display:none !important; }
.shipbtn.approved{ border-color:#2f6b2a; color:#2f6b2a; cursor:default; }
/* Узкая правая панель портала: плавающие кнопки сверху и рейка слева не наезжают на текст. */
@media (max-width:1100px){ .layout{ padding-top:5.5rem; padding-left:3rem; padding-right:1.25rem; } }
#panel h4 + #itemsList + h4{ display:none; }
.panel{ width:min(360px, calc(100vw - 4rem)); box-sizing:border-box; }
.shiphint{ max-width:min(340px, calc(100vw - 4rem)); }
/* Сводка для заказчика */
.cs{ border:1.5px solid var(--fg); padding:1.1rem 1.2rem 1.2rem; margin:0 0 2rem; }
.cs-kicker{ font:.7rem/1.3 "Courier New",monospace; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 .4rem; }
.cs-lead{ font-size:1.12rem; line-height:1.45; margin:0 0 1rem; }
.cs h3{ font:.72rem/1.3 "Courier New",monospace; text-transform:uppercase; letter-spacing:.06em; margin:1.1rem 0 .45rem; border-bottom:1px solid var(--line-soft); padding-bottom:.25rem; }
.cs ol, .cs ul{ margin:0; padding-left:1.25rem; }
.cs li{ margin:.28rem 0; }
.cs .check{ list-style:none; padding-left:0; }
.cs .check li::before{ content:"☐"; margin-right:.5rem; }
.cs .tag{ display:inline-block; font:.62rem/1.6 "Courier New",monospace; text-transform:uppercase; border:1px solid var(--line-soft); padding:0 .35rem; margin-right:.4rem; color:var(--muted); vertical-align:1px; }
.cs .who{ font-weight:600; }
.cs .q li{ color:#7a4b00; }
.cs-actions{ display:flex; flex-wrap:wrap; gap:.6rem; margin-top:1.3rem; }
.cs-actions button{ font:inherit; font-size:.95rem; padding:.55rem 1rem; cursor:pointer; border:1.5px solid var(--fg); }
.cs-yes{ background:var(--fg); color:var(--bg); }
.cs-yes[disabled]{ background:#2f6b2a; border-color:#2f6b2a; cursor:default; }
.cs-add{ background:var(--bg); color:var(--fg); }
.cs-note{ font-size:.8rem; color:var(--muted); margin:.6rem 0 0; }
.cs-divider{ font:.7rem/1.3 "Courier New",monospace; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0 0 1rem; }
</style>`

function summaryHtml(summary: CustomerSummary): string {
  const { input } = summary
  const steps = input.howToDemo ?? []
  const people = (input.personas ?? []).filter((p) => p.name?.trim())
  const questions = (input.openQuestions ?? []).filter((q) => q.trim())
  const section = (title: string, body: string) => (body ? `<h3>${esc(title)}</h3>${body}` : '')
  return `<section class="cs" id="customer-summary" aria-label="Коротко для заказчика">
<p class="cs-kicker">На проверку · заявка #${summary.taskId}</p>
<p class="cs-lead">${esc(known(input.smart?.s) ? input.smart.s : input.title)}</p>
${section(summary.where ? `Где и как вы проверите — ${summary.where}` : 'Как вы проверите', steps.length ? `<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : '')}
${section('Работа принята, если', summary.done.length ? `<ul class="check">${summary.done.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : '')}
${section('Что зафиксировано', input.requirements.length ? `<ul>${input.requirements.map((r) => `<li><span class="tag">${esc(KIND[r.id.split('-')[0]] ?? r.id)}</span>${esc(r.tobe)}</li>`).join('')}</ul>` : '')}
${section('Не входит и договорённости', (input.boundaries ?? []).length ? `<ul>${input.boundaries.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '')}
${section('К кому обращаться', people.length ? `<ul>${people.map((p) => `<li><span class="who">${esc(p.name)}</span>${known(p.role) ? ` — ${esc(p.role)}` : ''}${known(p.influence) ? `: ${esc(p.influence)}` : ''}</li>`).join('')}</ul>` : '')}
${section('Открытые вопросы', questions.length ? `<ol class="q">${questions.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>` : '')}
<div class="cs-actions">
  <button type="button" class="cs-yes" id="csYes">Да, согласен</button>
  <button type="button" class="cs-add" id="csAdd">Добавить требования</button>
</div>
<p class="cs-note">Что-то пропущено? «Добавить требования» — и надиктуйте голосом, что и где добавить. Можно и выделить фрагмент ниже и оставить замечание.</p>
</section>
<p class="cs-divider">Документ bft-fast целиком</p>`
}

function script(layer: CustomerLayer): string {
  // json.dumps-подобная подстановка: значения не ломают литерал скрипта.
  const cfg = JSON.stringify({ sessionId: layer.sessionId, approveUrl: layer.approveUrl, approvedAt: layer.approvedAt, store: `bft-comments-${layer.slug}` }).replace(/</g, '\\u003c')
  return `<script id="customer-layer">
(function(){
  var CFG = ${cfg};
  function $(id){ return document.getElementById(id); }
  function load(){ try{ return JSON.parse(localStorage.getItem(CFG.store) || "[]"); }catch(e){ return []; } }
  function save(list){ try{ localStorage.setItem(CFG.store, JSON.stringify(list)); }catch(e){} }
  function unsent(){ return load().filter(function(c){ return !c.closedAt && !c.sentAt; }); }
  function when(iso){ try{ return new Date(iso).toLocaleString("ru-RU", { day:"numeric", month:"long", hour:"2-digit", minute:"2-digit" }); }catch(e){ return iso; } }
  // Подсказка висит поверх заголовка — убираем через несколько секунд.
  function hint(text, ok){
    var h = $("shipHint"); if(!h) return;
    h.textContent = text; h.className = "shiphint " + (ok ? "ok" : "warn");
    clearTimeout(hint.timer); hint.timer = setTimeout(function(){ h.textContent = ""; }, ok ? 5000 : 9000);
  }
  // Кнопки страницы — заново, без её обработчиков (копирование команд для PO).
  function fresh(id){ var old = $(id); if(!old) return null; var b = old.cloneNode(true); old.parentNode.replaceChild(b, old); return b; }

  // Открытое поле — промт для /bft-deep, это работа PO.
  document.querySelectorAll("details.fold > summary h2").forEach(function(h){
    if(h.textContent.indexOf("Полный БФТ") < 0) return;
    // И пункт оглавления: оно уже собрано страницей из заголовков.
    if(h.id) document.querySelectorAll('a[href="#' + h.id + '"]').forEach(function(a){ (a.closest("li") || a).remove(); });
    h.closest("details.fold").remove();
  });
  var title = document.querySelector("#panel h4"); if(title) title.textContent = "Замечания к документу";

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
  function say(text, done){ post("customer-form/say", text, done); }

  var send = fresh("copyBtn");
  if(send){
    send.textContent = "Отправить замечания в чат";
    send.addEventListener("click", function(){
      var list = unsent();
      if(!list.length){ hint("Новых замечаний нет: выделите текст или нажмите на точку рядом с [УТОЧНИТЬ].", false); return; }
      var lines = ["Замечания к документу БФТ:"];
      list.forEach(function(c, i){
        lines.push((i + 1) + ". [" + c.section + "]" + (c.quote ? " (по фрагменту: «" + c.quote + "»)" : "") + " " + c.text);
      });
      var text = lines.join("\\n");
      say(text, function(ok){
        if(!ok){
          try{ navigator.clipboard.writeText(text); }catch(e){}
          hint("Чат не открыт рядом — замечания скопированы, вставьте их в чат портала.", false);
          return;
        }
        var stamp = new Date().toISOString();
        save(load().map(function(c){
          return list.some(function(x){ return x.ts === c.ts && x.text === c.text; }) ? Object.assign({}, c, { sentAt: stamp }) : c;
        }));
        hint("Замечания отправлены в чат — ассистент пересоберёт документ.", true);
      });
    });
  }

  var approve = fresh("shipBtn");
  var yes = $("csYes");
  function approvedView(at){
    [approve, yes].forEach(function(b){
      if(!b) return;
      b.textContent = "Согласовано · " + when(at);
      b.classList.add("approved");
      b.disabled = true;
    });
  }
  function doApprove(){
    var left = unsent().length;
    if(left){ hint("Есть неотправленные замечания (" + left + "): отправьте их в чат или удалите, чтобы согласовать.", false); return; }
    approve.disabled = true; if(yes) yes.disabled = true;
    fetch(CFG.approveUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || r.status); return v; }); })
      .then(function(v){
        approvedView(v.approvedAt);
        hint("Документ согласован — PO возьмёт его в проработку.", true);
        say("✅ Да, согласен с документом БФТ.", function(){});
      })
      .catch(function(e){ approve.disabled = false; if(yes) yes.disabled = false; hint("Не удалось согласовать: " + e.message, false); });
  }
  if(approve){
    approve.textContent = "Да, согласен";
    approve.addEventListener("click", doApprove);
  }
  if(yes) yes.addEventListener("click", doApprove);
  if(CFG.approvedAt) approvedView(CFG.approvedAt);

  // «Добавить требования»: начало фразы в поле ввода и запись голосом.
  var add = $("csAdd");
  if(add) add.addEventListener("click", function(){
    post("customer-form/compose", "Добавь требования: ", function(ok){
      var note = document.querySelector(".cs-note");
      if(note) note.textContent = ok ? "Говорите — что и где добавить. Остановите запись и отправьте сообщение в чат слева."
                                     : "Напишите или надиктуйте в чат портала, что и где добавить.";
    });
  });
})();
</script>`
}

/** Страница экспорта + слой заказчика: сводка в начало документа, скрипт перед </body>. */
export function customerFastPage(html: string, layer: CustomerLayer): string {
  let page = html
  if (layer.summary) {
    const main = /<main[^>]*>/.exec(page)
    if (main) page = page.slice(0, main.index + main[0].length) + summaryHtml(layer.summary) + page.slice(main.index + main[0].length)
  }
  const at = page.lastIndexOf('</body>')
  const layerHtml = STYLE + script(layer)
  return at < 0 ? page + layerHtml : page.slice(0, at) + layerHtml + page.slice(at)
}

const STAGES: { key: FastProgress['stage']; title: string; note: string }[] = [
  { key: 'approved', title: 'Сценарий приёмки согласован', note: 'Ваше «Согласую» — основа документа' },
  { key: 'submitted', title: 'Заявка передана в беклог', note: 'Постановка и полный контекст — в трекере' },
  { key: 'building', title: 'Раскладываю требования', note: 'Что и где получите, как проверите, к кому обращаться' },
  { key: 'ready', title: 'Проверяю по шаблону bft-fast', note: 'Линтер шаблона и страница на проверку' },
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
