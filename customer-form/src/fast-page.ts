/**
 * Страницы заказчика для bft-fast (ADR-0007 rev15–20).
 *
 *  - customerFastPage — документ bft-fast как есть: bft-html-export.py навыка,
 *    та же страница уходит PO в заявку (rev20 — возврат к базовому шаблону).
 *    Слой заказчика (rev21):
 *     - «Да, согласен» и «Добавить требования» под заголовком,
 *       «Скопировать промт» → «Отправить замечания в чат»;
 *     - How to demo — путь приёмки (Mermaid) и таблица «Где · Делаю · Вижу»;
 *     - вместо «Общей информации» — «Чьи зоны затрагивает и к кому
 *       обращаться»: кого назвал заказчик и кого знает Кортекс; таблица
 *       персон в «Критичных требованиях» её дублирует и скрыта (rev22);
 *     - «Источники» и открытое поле /bft-deep (работа PO) скрыты.
 *  - waitingPage — пока документ собирается: ход сборки по этапам.
 */
import type { FastProgress } from './bft-fast.js'
import type { CortexBrief } from './cortex.js'
import type { AcceptanceDemo } from './demo.js'
import { userFlowMermaid } from './demo-page.js'

export interface CustomerLayer {
  sessionId: string
  slug: string
  approveUrl: string
  /** Согласование этой же версии документа, если было. */
  approvedAt?: string
  /** Согласованный сценарий приёмки — How to demo схемой и таблицей. */
  demo?: AcceptanceDemo
  /** Кого назвал заказчик и что знает Кортекс — раздел зон и контактов. */
  people?: { name: string; role?: string; about?: string }[]
  brief?: CortexBrief
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

const STYLE = `<style id="customer-layer-style">
#promptOut{ display:none !important; }
.shipbtn.approved{ border-color:#2f6b2a; color:#2f6b2a; cursor:default; }
/* Узкая правая панель портала: плавающие кнопки сверху и рейка слева не наезжают на текст. */
@media (max-width:1100px){ .layout{ padding-top:5.5rem; padding-left:3rem; padding-right:1.25rem; } }
#panel h4 + #itemsList + h4{ display:none; }
.panel{ width:min(360px, calc(100vw - 4rem)); box-sizing:border-box; }
.shiphint{ max-width:min(340px, calc(100vw - 4rem)); }
/* Кнопки заказчика под заголовком */
.cs-actions{ display:flex; flex-wrap:wrap; gap:.6rem; align-items:center; margin:0 0 1.6rem; }
.cs-actions button{ font:inherit; font-size:.95rem; padding:.5rem 1rem; cursor:pointer; border:1.5px solid var(--fg); }
.cs-yes{ background:var(--fg); color:var(--bg); }
.cs-yes[disabled]{ background:#2f6b2a; border-color:#2f6b2a; cursor:default; }
.cs-add{ background:var(--bg); color:var(--fg); }
/* Согласование — кнопкой под заголовком, плавающая кнопка экспорта не дублирует её. */
#shipBtn{ display:none !important; }
/* How to demo */
.hd-flow{ margin:.4rem 0 1rem; }
.hd-flow svg{ display:block; margin:0 auto; }
.hd-table td.n{ width:1.6rem; text-align:center; font-family:"Courier New",monospace; }
.hd-table td.where{ font-weight:600; }
.zone-from{ font-size:.8rem; color:var(--muted); white-space:nowrap; }
</style>`

// Эмодзи в подписях Mermaid под шрифтом документа меряются неверно — подпись обрезается.
function howToDemoHtml(demo: AcceptanceDemo): string {
  const rows = demo.steps.map((s, i) => `<tr><td class="n">${i + 1}</td><td class="where">${esc(s.screen)}</td><td>${esc(s.action)}</td><td>${esc(s.expect)}</td></tr>`).join('')
  return `<div class="hd" id="customer-howtodemo">
<div class="hd-flow"><pre class="mermaid">${esc(userFlowMermaid(demo).replace('🧑 ', '').replace('✔ ', ''))}</pre></div>
<div class="table-wrap"><table class="hd-table"><thead><tr><th>№</th><th>Где</th><th>Делаю</th><th>Вижу</th></tr></thead><tbody>${rows}</tbody></table></div>
</div>`
}

/** Первое предложение описания узла: служебные хвосты («Профиль памяти: …») не нужны заказчику. */
const firstSentence = (text: string) => (/^.+?[.!?](?=\s|$)/.exec(text.trim())?.[0] ?? text.trim())

/** Чьи зоны затрагивает запрос и к кому по каким вопросам: со слов заказчика и из Кортекса. */
function zonesHtml(people: NonNullable<CustomerLayer['people']>, brief: CortexBrief | undefined): string {
  const zonesOf = (name: string) => (brief?.domains ?? []).filter((d) => d.owner === name).flatMap((d) => d.zones)
  const rows = [
    ...people.filter((p) => p.name?.trim()).map((p) => [p.name, p.role ?? '', p.about ?? '', 'назвали вы']),
    ...(brief?.people ?? []).map((p) => {
      const zones = [...new Set([...p.zones, ...zonesOf(p.name)])]
      return [p.name, [p.role, zones.length ? `зоны: ${zones.join(', ')}` : ''].filter(Boolean).join('; '), p.contact_for.join(', ') || firstSentence(p.summary), `память организации${brief!.vault.demo ? ' · демо' : ''}`]
    }),
  ]
  const body = rows.length
    ? `<div class="table-wrap"><table><thead><tr><th>Кто</th><th>Роль и зона</th><th>По каким вопросам</th><th>Откуда</th></tr></thead><tbody>${rows.map(([who, zone, about, from]) => `<tr><td>${esc(who)}</td><td>${esc(zone)}</td><td>${esc(about)}</td><td class="zone-from">${esc(from)}</td></tr>`).join('')}</tbody></table></div>`
    : '<p>Владельцев зон по этому запросу пока не знаем — уточнит команда.</p>'
  return `<h3 id="sec-zones">Чьи зоны затрагивает и к кому обращаться</h3>\n${body}\n`
}

const ACTIONS = `<div class="cs-actions" id="customer-actions">
  <button type="button" class="cs-yes" id="csYes">Да, согласен</button>
  <button type="button" class="cs-add" id="csAdd">Добавить требования</button>
</div>`

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
    if(approve) approve.disabled = true; if(yes) yes.disabled = true;
    fetch(CFG.approveUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || r.status); return v; }); })
      .then(function(v){
        approvedView(v.approvedAt);
        hint("Документ согласован — PO возьмёт его в проработку.", true);
        say("✅ Да, согласен с документом БФТ.", function(){});
      })
      .catch(function(e){ if(approve) approve.disabled = false; if(yes) yes.disabled = false; hint("Не удалось согласовать: " + e.message, false); });
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
      hint(ok ? "Говорите — что и где добавить, затем отправьте сообщение в чат." : "Напишите или надиктуйте в чат портала, что и где добавить.", ok);
    });
  });
})();
</script>`
}

/** Страница экспорта + слой заказчика: кнопки под заголовком, стиль и скрипт перед </body>. */
export function customerFastPage(html: string, layer: CustomerLayer): string {
  let page = html
  const h1 = /<h1[^>]*>[\s\S]*?<\/h1>/.exec(page)
  if (h1) page = page.slice(0, h1.index + h1[0].length) + ACTIONS + page.slice(h1.index + h1[0].length)
  // How to demo: список шагов (первый <ol> после заголовка) → схема и таблица.
  const howTo = /<h3[^>]*>How to demo<\/h3>\s*/.exec(page)
  if (howTo && layer.demo?.steps.length) {
    const from = howTo.index + howTo[0].length
    const end = page.startsWith('<ol>', from) ? page.indexOf('</ol>', from) : -1
    if (end > 0) page = page.slice(0, from) + howToDemoHtml(layer.demo) + page.slice(end + '</ol>'.length)
  }
  // «Общая информация» (поля для PO) → зоны и контакты; до следующего раздела.
  const info = /<h3[^>]*>Общая информация<\/h3>/.exec(page)
  if (info) {
    const next = page.indexOf('<h2', info.index)
    page = page.slice(0, info.index) + zonesHtml(layer.people ?? [], layer.brief) + (next < 0 ? '' : page.slice(next))
  }
  // Персоны и пояснение к ним — их дублирует раздел зон и контактов.
  page = page.replace(/<p>Персоны \(домен знаний\):<\/p>\s*<div class="table-wrap">[\s\S]*?<\/div>\s*/, '')
  page = page.replace(/<p>Роль\/влияние — [^<]*<\/p>\s*/, '')
  // «Источники» убираем, цитату — из сноски прямо в ячейку требования.
  const sources = /<h2[^>]*>Источники<\/h2>\s*<ol class="src-notes">[\s\S]*?<\/ol>/.exec(page)
  if (sources) page = page.slice(0, sources.index) + page.slice(sources.index + sources[0].length)
  page = page.replace(/<a class="src-ref"[^>]*?title="([^"]*)"[^>]*>[^<]*<\/a>/g, '$1')
  const at = page.lastIndexOf('</body>')
  const layerHtml = STYLE + script(layer)
  return at < 0 ? page + layerHtml : page.slice(0, at) + layerHtml + page.slice(at)
}


/** Советы на экране ожидания: [рубрика, текст] — коротко, на 5–7 секунд чтения. */
const TIPS: [string, string][] = [
  ['Требования', 'Опишите, как вы будете проверять результат, — и половина требований запишется сама.'],
  ['Требования', 'Хорошее требование проверяется ответом «да» или «нет». «Удобно» и «быстро» — нет, «за 2 клика» и «до 3 секунд» — да.'],
  ['Требования', 'Не входит в задачу — тоже требование. Скажите это вслух сейчас, чтобы не спорить на приёмке.'],
  ['Требования', 'Один пример из жизни («клиент Иванов вчера…») объясняет задачу лучше страницы абстракций.'],
  ['Требования', 'Назовите, кто будет пользоваться результатом. Требования «для всех» обычно не устраивают никого.'],
  ['Приёмка', 'Договоритесь о приёмке до начала работ: сценарий проверки, который вы согласовали, — ваш договор с командой.'],
  ['Приёмка', 'Проверяйте на тестовом стенде с настоящими сценариями, а не на демо «по слайдам».'],
  ['Команда', 'Одна задача — один владелец. Если ответственных двое, решение не принимает никто.'],
  ['Команда', 'Приходите к команде с проблемой, а не с готовым решением: исполнители часто знают путь короче.'],
  ['Команда', 'Короткий созвон на 15 минут экономит неделю переписки. Итоги — одним сообщением в задачу.'],
  ['Команда', 'Спросите команду «что может помешать?» до старта — риски дешевле всего на бумаге.'],
  ['Команда', 'Срок называет тот, кто делает. Срок, спущенный сверху, — это пожелание, а не план.'],
  ['Приоритеты', 'Если всё срочно — ничего не срочно. Выберите одну главную вещь на эту итерацию.'],
  ['Приоритеты', 'Маленький результат через две недели ценнее большого через квартал: он даёт обратную связь.'],
  ['Коммуникация', 'Фиксируйте договорённости письменно — в задаче, а не в личной переписке: их увидят все, кто подключится позже.'],
]

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
.tip{ position:relative; min-height:150px; border:1.5px solid var(--fg); padding:16px 18px 30px; margin-bottom:1.6rem; overflow:hidden; }
.tip-kind{ font:.68rem/1.3 "Courier New",monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:0 0 .5rem; }
.tip-text{ font-size:1.08rem; line-height:1.45; margin:0; }
.tip-body{ transition:opacity .45s ease, transform .45s ease; }
.tip-body.out{ opacity:0; transform:translateY(8px); }
.tip-nav{ position:absolute; right:12px; bottom:8px; display:flex; gap:4px; }
.tip-nav button{ font:.8rem "Courier New",monospace; border:0; background:none; color:var(--muted); cursor:pointer; padding:2px 6px; }
.tip-nav button:hover{ color:var(--fg); }
.tip-count{ position:absolute; left:18px; bottom:10px; font:.68rem "Courier New",monospace; color:var(--muted); }
.tip-timer{ position:absolute; left:0; bottom:0; height:2px; background:var(--fg); width:0; }
.tip-timer.run{ animation:tiptimer 7s linear forwards; }
@keyframes tiptimer{ from{ width:0 } to{ width:100% } }
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
@media (prefers-reduced-motion:reduce){ .tip-body{ transition:none; } .tip-timer.run, li.now .dot{ animation:none; } }
</style></head><body>
<div class="wrap" data-waiting="${esc(sessionId)}">
  <div class="kicker">Документ на проверку</div>
  <h1>Уже готовлю БФТ-документ</h1>
  <p class="lead">Буквально 3 минуты. Документ откроется здесь сам — ничего обновлять не нужно.</p>
  <div class="tip" id="tip" aria-live="polite">
    <div class="tip-body" id="tipBody"><p class="tip-kind" id="tipKind"></p><p class="tip-text" id="tipText"></p></div>
    <span class="tip-count" id="tipCount"></span>
    <div class="tip-nav"><button type="button" id="tipPrev" aria-label="Предыдущий совет">←</button><button type="button" id="tipNext" aria-label="Следующий совет">→</button></div>
    <i class="tip-timer" id="tipTimer"></i>
  </div>
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
  // Пока ждём — короткие советы: требования и работа с командой. Начинаем со случайного.
  var TIPS = ${JSON.stringify(TIPS).replace(/</g, '\\u003c')};
  var at = Math.floor(Math.random() * TIPS.length), timer;
  function show(step){
    var body = document.getElementById("tipBody");
    body.classList.add("out");
    setTimeout(function(){
      at = (at + step + TIPS.length) % TIPS.length;
      document.getElementById("tipKind").textContent = TIPS[at][0];
      document.getElementById("tipText").textContent = TIPS[at][1];
      document.getElementById("tipCount").textContent = (at + 1) + " / " + TIPS.length;
      body.classList.remove("out");
      var bar = document.getElementById("tipTimer");
      bar.classList.remove("run"); void bar.offsetWidth; bar.classList.add("run");
    }, step === 0 ? 0 : 450);
    clearTimeout(timer); timer = setTimeout(function(){ show(1); }, 7000);
  }
  document.getElementById("tipNext").addEventListener("click", function(){ show(1); });
  document.getElementById("tipPrev").addEventListener("click", function(){ show(-1); });
  show(0);
  paint(CFG.stage); tick();
  setInterval(tick, 1000);
  setInterval(poll, 2000);
})();
</script></body></html>`
}
