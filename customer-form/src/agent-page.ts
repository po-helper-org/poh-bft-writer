/**
 * Колонка «🤖 ИИ-агент» на странице полного БФТ (ADR-0021, ADR-0024) — как у
 * отчёта /sprints: замечания из «Комментариев» страницы или своим текстом →
 * очередь «одно замечание — одна правка», ход виден живьём, по каждому — итог
 * (внесено / уже так / вопрос / не внесено). Готовая правка меняет на странице
 * только свои разделы — без перезагрузки и прыжка прокрутки, с подсветкой.
 * Светящаяся точка у «Комментариев» — полное ревью согласованности.
 * Чат портала не нужен: работает и на отдельной ссылке документа.
 */

export interface AgentLayer {
  sessionId: string
  /** Ключ замечаний страницы ревью (bft-html-export.js): bft-comments-<slug>. */
  store: string
  reviseUrl: string
  statusUrl: string
  undoUrl: string
  /** HTML изменённых разделов (точечная перерисовка). */
  sectionUrl: string
  /** Поставить полное ревью согласованности. */
  reviewUrl: string
  /** deep.json finishedAt на момент отдачи страницы: изменился — документ обновили. */
  deepAt: string | null
}

const STYLE = `<style id="bft-agent-style">
#bftAgentBtn,#bftAgent,#bftAgentFresh,#agReviewTip{--ag-fg:#111;--ag-mute:#8a8a8a;--ag-line:#ececec;--ag-bg:#fff;--ag-soft:#f6f6f4;--ag-ok:#15803d;--ag-q:#a16207;--ag-err:#b91c1c;
  font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ag-fg)}
@media (prefers-color-scheme:dark){#bftAgentBtn,#bftAgent,#bftAgentFresh,#agReviewTip{--ag-fg:#ececec;--ag-mute:#8d8d8d;--ag-line:#2a2a2a;--ag-bg:#161616;--ag-soft:#1f1f1f;--ag-ok:#4ade80;--ag-q:#facc15;--ag-err:#f87171}}
#bftAgentBtn{position:fixed;right:16px;bottom:16px;z-index:60;display:flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:17px;
  border:1px solid var(--ag-line);background:var(--ag-bg);box-shadow:0 2px 10px rgba(0,0,0,.08);cursor:pointer;font-weight:500}
#bftAgentBtn svg{width:15px;height:15px}
#bftAgentBtn .dot{width:6px;height:6px;border-radius:50%;background:var(--ag-ok);display:none}
#bftAgentBtn.busy .dot{display:block;animation:bftPulse 1s infinite}
@keyframes bftPulse{50%{opacity:.25}}
#bftAgent{position:fixed;top:0;right:0;bottom:0;z-index:61;width:min(360px,100vw);background:var(--ag-bg);border-left:1px solid var(--ag-line);
  display:flex;flex-direction:column;transform:translateX(102%);transition:transform .18s ease}
#bftAgent.open{transform:none;box-shadow:-8px 0 24px rgba(0,0,0,.06)}
#bftAgent header{display:flex;align-items:center;justify-content:space-between;height:44px;padding:0 8px 0 14px;border-bottom:1px solid var(--ag-line);font-weight:600}
#bftAgent header button{width:28px;height:28px;border:0;border-radius:6px;background:none;color:var(--ag-mute);font-size:18px;line-height:1;cursor:pointer}
#bftAgent header button:hover{background:var(--ag-soft)}
#bftAgent .ag-body{flex:1;overflow:auto;padding:4px 14px}
#bftAgent .ag-empty{color:var(--ag-mute);padding:14px 0}
#bftAgent .ag-rev{padding:10px 0;border-bottom:1px solid var(--ag-line)}
#bftAgent .ag-rev:last-child{border-bottom:0}
#bftAgent .ag-top{display:flex;justify-content:space-between;gap:8px;color:var(--ag-mute);font-size:12px}
#bftAgent .ag-state{font-weight:500}
#bftAgent .ag-state.run{color:var(--ag-q)}#bftAgent .ag-state.ok{color:var(--ag-ok)}#bftAgent .ag-state.err{color:var(--ag-err)}
#bftAgent .ag-item{display:flex;gap:6px;margin-top:6px}
#bftAgent .ag-ico{flex:none;width:14px;text-align:center;color:var(--ag-mute)}
#bftAgent .ag-ico.applied{color:var(--ag-ok)}#bftAgent .ag-ico.question{color:var(--ag-q)}#bftAgent .ag-ico.skipped{color:var(--ag-err)}
#bftAgent .ag-txt{min-width:0}
#bftAgent .ag-txt small{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--ag-mute);font-size:12px}
#bftAgent .ag-txt small:hover{-webkit-line-clamp:unset}
#bftAgent .ag-sec{color:var(--ag-mute)}
#bftAgent .ag-live{display:flex;align-items:center;gap:6px;margin-top:6px;color:var(--ag-mute)}
#bftAgent .ag-spin{width:11px;height:11px;border:1.5px solid var(--ag-line);border-top-color:var(--ag-fg);border-radius:50%;animation:bftSpin .8s linear infinite}
@keyframes bftSpin{to{transform:rotate(360deg)}}
#bftAgent .ag-link{border:0;background:none;padding:0;margin-top:6px;color:var(--ag-mute);font:inherit;font-size:12px;text-decoration:underline;cursor:pointer}
#bftAgent .ag-err{color:var(--ag-err);font-size:12px;white-space:pre-wrap;margin-top:6px}
#bftAgent footer{border-top:1px solid var(--ag-line);padding:10px 14px 12px}
#bftAgent .ag-pend{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;padding:6px 6px 6px 10px;border-radius:8px;background:var(--ag-soft)}
#bftAgent .ag-pend[hidden]{display:none}
#bftAgent .ag-pend details{min-width:0}
#bftAgent .ag-pend summary{cursor:pointer;list-style:none}
#bftAgent .ag-pend summary::-webkit-details-marker{display:none}
#bftAgent .ag-pend ol{margin:6px 0 0;padding-left:16px;color:var(--ag-mute);font-size:12px}
#bftAgent .ag-btn{flex:none;height:26px;padding:0 10px;border:0;border-radius:6px;background:var(--ag-fg);color:var(--ag-bg);font:inherit;font-weight:500;cursor:pointer}
#bftAgent .ag-btn:disabled{opacity:.35;cursor:default}
#bftAgent input{width:100%;box-sizing:border-box;height:30px;margin-bottom:8px;padding:0 10px;border:1px solid var(--ag-line);border-radius:8px;background:var(--ag-bg);color:inherit;font:inherit}
#bftAgent .ag-compose{display:flex;align-items:flex-end;gap:6px;padding:6px 6px 6px 10px;border:1px solid var(--ag-line);border-radius:10px}
#bftAgent .ag-compose:focus-within{border-color:var(--ag-mute)}
#bftAgent textarea{flex:1;min-height:20px;max-height:140px;border:0;outline:0;resize:none;padding:3px 0;background:none;color:inherit;font:inherit}
#bftAgent .ag-send{flex:none;width:28px;height:28px;border:0;border-radius:50%;background:var(--ag-fg);color:var(--ag-bg);cursor:pointer;display:grid;place-items:center}
#bftAgent .ag-send svg{width:14px;height:14px}
#bftAgent .ag-msg{color:var(--ag-err);font-size:12px;margin-top:6px}
#bftAgentFresh{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:62;display:none;align-items:center;gap:10px;height:34px;padding:0 6px 0 14px;
  border-radius:17px;background:var(--ag-fg);color:var(--ag-bg);box-shadow:0 2px 10px rgba(0,0,0,.15)}
#bftAgent .ag-kind{font-weight:600;color:var(--ag-fg)}
#bftAgent .ag-model{color:var(--ag-mute);font-size:11px;margin-top:4px}
#bftAgent .ag-state.wait{color:var(--ag-mute)}
.ag-flash{animation:bftFlash 2.2s ease-out}
@keyframes bftFlash{0%,35%{background:rgba(250,204,21,.28)}100%{background:transparent}}
#agReviewDot{position:relative;display:inline-block;width:9px;height:9px;margin:0 2px 0 8px;padding:0;border:0;border-radius:50%;background:#f59e0b;vertical-align:middle;cursor:pointer;
  box-shadow:0 0 0 0 rgba(245,158,11,.6);animation:bftGlow 1.8s infinite}
#agReviewDot[hidden]{display:none}
@keyframes bftGlow{0%{box-shadow:0 0 0 0 rgba(245,158,11,.55)}70%{box-shadow:0 0 0 9px rgba(245,158,11,0)}100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}}
#agReviewTip{position:fixed;z-index:63;width:260px;padding:12px;border:1px solid var(--ag-line);border-radius:10px;background:var(--ag-bg);box-shadow:0 6px 24px rgba(0,0,0,.12)}
#agReviewTip[hidden]{display:none}
#agReviewTip p{margin:0 0 10px}
#agReviewTip .ag-row{display:flex;justify-content:flex-end;gap:6px}
#agReviewTip .ag-ghost{height:26px;padding:0 10px;border:1px solid var(--ag-line);border-radius:6px;background:none;color:inherit;font:inherit;cursor:pointer}
#agReviewTip .ag-btn{flex:none;height:26px;padding:0 10px;border:0;border-radius:6px;background:var(--ag-fg);color:var(--ag-bg);font:inherit;font-weight:500;cursor:pointer}
#bftAgentFresh button{height:24px;padding:0 10px;border:0;border-radius:12px;background:var(--ag-bg);color:var(--ag-fg);font:inherit;cursor:pointer}
@media print{#bftAgentBtn,#bftAgent,#bftAgentFresh,#agReviewDot,#agReviewTip{display:none!important}}
</style>`

const MARKUP = `<button type="button" id="bftAgentBtn" aria-controls="bftAgent" aria-expanded="false"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z"/></svg>ИИ-агент<span class="dot"></span></button>
<aside id="bftAgent" aria-label="ИИ-агент правок документа" aria-hidden="true">
  <header><span>ИИ-агент</span><button type="button" id="agClose" aria-label="Закрыть">×</button></header>
  <div class="ag-body"><div id="agList"></div></div>
  <footer>
    <div class="ag-pend" id="agPendBox" hidden><details><summary id="agPending"></summary><ol id="agPendList"></ol></details><button type="button" class="ag-btn" id="agSendComments">Отправить</button></div>
    <input id="agAuthor" maxlength="120" placeholder="Ваше имя — для журнала правок" hidden>
    <div class="ag-compose"><textarea id="agText" rows="1" placeholder="Что поправить в документе…"></textarea><button type="button" class="ag-send" id="agSendText" aria-label="Отправить"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5"/></svg></button></div>
    <div class="ag-msg" id="agMsg" hidden></div>
  </footer>
</aside>
<div id="agReviewTip" role="dialog" aria-label="Полное ревью" hidden><p>Проведите полное ревью требований для согласованности</p><div class="ag-row"><button type="button" class="ag-ghost" id="agReviewNo">Позже</button><button type="button" class="ag-btn" id="agReviewGo">Отправить</button></div></div>
<div id="bftAgentFresh" role="status"><span>Документ обновлён</span><button type="button" id="agReload">Показать</button></div>`

function script(cfg: AgentLayer): string {
  const json = JSON.stringify(cfg).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029')
  return `<script id="bft-agent">
(function(){
  var CFG = ${json};
  var SENT_KEY = CFG.store + "-agent-sent", WHO_KEY = "bft-agent-author", OPEN_KEY = "bft-agent-open";
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  function get(k, d){ try{ var v = localStorage.getItem(k); return v == null ? d : v; }catch(e){ return d; } }
  function put(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function comments(){ try{ return JSON.parse(get(CFG.store, "[]")) || []; }catch(e){ return []; } }
  function sentSet(){ try{ return JSON.parse(get(SENT_KEY, "[]")) || []; }catch(e){ return []; } }
  function pending(){ var sent = sentSet(); return comments().filter(function(c){ return !c.closedAt && sent.indexOf(c.ts) < 0; }); }
  function when(iso){ try{ return new Date(iso).toLocaleString("ru-RU", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }); }catch(e){ return ""; } }

  // Страница при обновлении документа закрывает все открытые замечания (bft-html-export.js) —
  // те, что агенту не уходили, возвращаем: их ещё не вносили.
  function reopenUnsent(){
    var sent = sentSet(), now = Date.now(), changed = false;
    var list = comments().map(function(c){
      if(c.closedAt && sent.indexOf(c.ts) < 0 && now - Date.parse(c.closedAt) < 120000){
        changed = true; var x = Object.assign({}, c); delete x.closedAt; delete x.iteration; return x;
      }
      return c;
    });
    if(changed){ put(CFG.store, JSON.stringify(list)); if(!sessionStorage.getItem("bft-agent-reopened")){ sessionStorage.setItem("bft-agent-reopened", "1"); location.reload(); } }
    else sessionStorage.removeItem("bft-agent-reopened");
  }

  var drawer = $("bftAgent"), btn = $("bftAgentBtn");
  function setOpen(open){
    drawer.classList.toggle("open", open); drawer.setAttribute("aria-hidden", open ? "false" : "true"); btn.setAttribute("aria-expanded", open ? "true" : "false");
    try{ open ? sessionStorage.setItem(OPEN_KEY, "1") : sessionStorage.removeItem(OPEN_KEY); }catch(e){}
    if(open){ renderPending(); poll(true); }
  }
  btn.addEventListener("click", function(){ setOpen(!drawer.classList.contains("open")); });
  $("agClose").addEventListener("click", function(){ setOpen(false); });
  document.addEventListener("keydown", function(e){ if(e.key === "Escape" && drawer.classList.contains("open")) setOpen(false); });

  var author = $("agAuthor");
  author.value = get(WHO_KEY, "");
  author.hidden = !!author.value;
  author.addEventListener("change", function(){ put(WHO_KEY, author.value.trim()); });

  function message(text){ var m = $("agMsg"); m.textContent = text || ""; m.hidden = !text; }
  function renderPending(){
    var list = pending(), send = $("agSendComments");
    $("agPendBox").hidden = !list.length;
    send.disabled = false;
    var n = list.length, word = n % 10 === 1 && n % 100 !== 11 ? "замечание" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "замечания" : "замечаний");
    $("agPending").textContent = n + " " + word + " со страницы";
    $("agPendList").innerHTML = list.map(function(c){ return "<li>" + esc(c.section) + " — " + esc(c.text) + "</li>"; }).join("");
  }

  window.addEventListener("storage", function(e){ if(e.key === CFG.store) renderPending(); });
  setInterval(function(){ if(drawer.classList.contains("open")) renderPending(); }, 2000);

  function send(remarks, onSent){
    var who = author.value.trim();
    if(!who){ author.hidden = false; author.focus(); message("Укажите имя — оно попадёт в журнал правок."); return; }
    put(WHO_KEY, who);
    message("");
    fetch(CFG.reviseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId, remarks: remarks, author: who }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || ("HTTP " + r.status)); return v; }); })
      .then(function(){ onSent && onSent(); setOpen(true); poll(true); })
      .catch(function(e){ message("Не отправилось: " + e.message); });
  }
  function sendComments(){
    var list = pending();
    if(!list.length) return;
    send(list.map(function(c){ return { section: c.section, quote: c.quote || "", text: c.text, ref: String(c.ts) }; }), function(){
      var sent = sentSet().concat(list.map(function(c){ return c.ts; }));
      put(SENT_KEY, JSON.stringify(sent.slice(-500)));
      renderPending();
    });
  }
  $("agSendComments").addEventListener("click", sendComments);
  function sendText(){
    var t = $("agText").value.trim();
    if(!t) return;
    send([{ section: "Документ", text: t }], function(){ $("agText").value = ""; });
  }
  $("agSendText").addEventListener("click", sendText);
  $("agText").addEventListener("keydown", function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); sendText(); } });
  $("agText").addEventListener("input", function(){ this.style.height = "auto"; this.style.height = Math.min(this.scrollHeight, 140) + "px"; });

  // «Комментарии» страницы ревью: вместо «Скопировать промт» — сразу агенту.
  function hijackCopy(){
    var old = $("copyBtn"); if(!old) return;
    var b = old.cloneNode(true); old.parentNode.replaceChild(b, old);
    b.textContent = "Отправить ИИ-агенту";
    b.addEventListener("click", function(){ if(pending().length) sendComments(); else { setOpen(true); message("Новых замечаний нет — выделите текст или нажмите на точку у [УТОЧНИТЬ]."); } });
    var out = $("promptOut"); if(out){ out.style.display = "none"; var h = out.previousElementSibling; if(h && h.tagName === "H4") h.textContent = "Замечания уйдут ИИ-агенту — каждое отдельной правкой"; }
  }

  // Светящаяся точка у «Комментариев»: после локальных правок — полное ревью согласованности.
  var dot = document.createElement("button");
  dot.type = "button"; dot.id = "agReviewDot"; dot.hidden = true;
  dot.setAttribute("aria-label", "Полное ревью требований");
  var tip = $("agReviewTip");
  function placeDot(){
    var host = $("panelToggle");
    if(host && host.parentNode) host.parentNode.insertBefore(dot, host.nextSibling); else btn.appendChild(dot);
  }
  dot.addEventListener("click", function(e){
    e.stopPropagation();
    var r = dot.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left - 12, window.innerWidth - 276)) + "px";
    tip.style.top = (r.bottom + 8) + "px";
    tip.hidden = !tip.hidden;
  });
  $("agReviewNo").addEventListener("click", function(){ tip.hidden = true; });
  document.addEventListener("click", function(e){ if(!tip.hidden && !tip.contains(e.target) && e.target !== dot) tip.hidden = true; });
  $("agReviewGo").addEventListener("click", function(){
    var who = author.value.trim() || get(WHO_KEY, "");
    tip.hidden = true;
    fetch(CFG.reviewUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId, author: who }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || ("HTTP " + r.status)); return v; }); })
      .then(function(){ dot.hidden = true; setOpen(true); poll(true); })
      .catch(function(e){ setOpen(true); message("Ревью не запустилось: " + e.message); });
  });

  var ICON = { applied: "✓", already: "=", question: "?", skipped: "✗" };
  var LABEL = { applied: "внесено", already: "уже так", question: "открытый вопрос", skipped: "не внесено" };
  function active(r){ return r.stage === "queued" || r.stage === "writing" || r.stage === "checking"; }
  function state(r){
    if(r.kind === "undo") return '<span class="ag-state">откат</span>';
    if(r.stage === "queued") return '<span class="ag-state wait">в очереди</span>';
    if(r.stage === "writing" || r.stage === "checking") return '<span class="ag-state run">в работе</span>';
    if(r.stage === "failed") return '<span class="ag-state err">не вышло</span>';
    return '<span class="ag-state ok">' + (r.edits ? "правок: " + r.edits : "без правок") + "</span>";
  }
  function live(r){
    if(r.stage === "writing") return '<div class="ag-live"><span class="ag-spin"></span>' + (r.kind === "review" ? "проверяет согласованность" : "правит") + (r.scope && r.kind !== "review" ? " · " + esc(r.scope) : "") + (r.progress && r.progress.chars ? " · " + r.progress.chars + " зн." : "") + (r.progress && r.progress.round > 1 ? " · круг " + r.progress.round : "") + "</div>";
    if(r.stage === "checking") return '<div class="ag-live"><span class="ag-spin"></span>проверяет шаблон</div>';
    return "";
  }
  function resultItem(res, text, section){
    var ico = res ? ICON[res.status] : "·", cls = res ? res.status : "";
    var note = res ? LABEL[res.status] + (res.note ? " — " + res.note : "") : "";
    return '<div class="ag-item"><span class="ag-ico ' + cls + '">' + ico + '</span><span class="ag-txt">' + (section && section !== "Документ" ? '<span class="ag-sec">' + esc(section) + " · </span>" : "") + esc(text) + (note ? "<small>" + esc(note) + "</small>" : "") + "</span></div>";
  }
  function renderList(data){
    $("agList").innerHTML = data.items.length ? data.items.map(function(r){
      var top = '<div class="ag-top"><span>' + esc(when(r.at)) + (r.author ? " · " + esc(r.author) : "") + "</span>" + state(r) + "</div>";
      if(r.kind === "undo") return '<div class="ag-rev">' + top + '<div class="ag-item"><span class="ag-ico">↺</span><span class="ag-txt">Правка отменена</span></div></div>';
      var items;
      if(r.kind === "review"){
        items = '<div class="ag-item"><span class="ag-ico">◎</span><span class="ag-txt"><span class="ag-kind">Полное ревью согласованности</span></span></div>'
          + (r.results || []).map(function(res){ return resultItem(res, res.note || LABEL[res.status], ""); }).join("");
      } else {
        items = (r.remarks || []).map(function(m, i){ return resultItem((r.results || []).filter(function(x){ return x.n === i + 1; })[0], m.text, m.section); }).join("");
      }
      return '<div class="ag-rev">' + top + items + live(r) + (r.error ? '<div class="ag-err">' + esc(r.error) + "</div>" : "")
        + (r.model && !active(r) ? '<div class="ag-model">' + esc(r.model) + "</div>" : "")
        + (r.undoable ? '<button type="button" class="ag-link" data-undo="' + esc(r.id) + '">Откатить</button>' : "") + "</div>";
    }).join("") : '<p class="ag-empty">Выделите текст в документе или нажмите точку у [УТОЧНИТЬ] — замечание появится внизу. Или напишите, что поправить: каждое замечание — отдельная правка своего раздела, документ меняется на месте.</p>';
  }
  $("agList").addEventListener("click", function(e){
    var b = e.target.closest("[data-undo]"); if(!b) return;
    if(!confirm("Отменить эту правку агента?")) return;
    b.disabled = true;
    fetch(CFG.undoUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId, id: b.getAttribute("data-undo"), author: author.value.trim() }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || r.status); }); })
      .then(function(){ poll(true); }).catch(function(err){ b.disabled = false; message("Откат не вышел: " + err.message); });
  });

  function reload(){ try{ sessionStorage.setItem(OPEN_KEY, "1"); sessionStorage.setItem("bft-agent-scroll", String(window.scrollY)); }catch(e){} location.reload(); }
  $("agReload").addEventListener("click", reload);

  // — точечная перерисовка: разделы страницы от <h2 id> (или свёрнутого <details class="fold">) до следующего —
  function isStart(n){ return n.nodeType === 1 && ((n.tagName === "H2" && n.id) || (n.tagName === "DETAILS" && n.classList.contains("fold")) || n.tagName === "FOOTER"); }
  function replaceBlock(id, html){
    var h = document.getElementById(id), main = document.querySelector("main");
    if(!h || !main || !main.contains(h)) return false;
    var top = h; while(top.parentElement && top.parentElement !== main) top = top.parentElement;
    var old = [top], n = top.nextSibling;
    while(n && !isStart(n)){ old.push(n); n = n.nextSibling; }
    var t = document.createElement("template"); t.innerHTML = html;
    var fresh = Array.prototype.slice.call(t.content.childNodes);
    fresh.forEach(function(x){ main.insertBefore(x, top); });
    old.forEach(function(x){ x.remove(); });
    fresh.forEach(function(x){ if(x.nodeType === 1){ x.classList.add("ag-flash"); setTimeout(function(){ x.classList.remove("ag-flash"); }, 2400); } });
    if(window.mermaid){ var m = []; fresh.forEach(function(x){ if(x.nodeType === 1) m = m.concat(Array.prototype.slice.call(x.matches(".mermaid") ? [x] : x.querySelectorAll(".mermaid"))); }); if(m.length) try{ mermaid.run({ nodes: m }); }catch(e){} }
    return true;
  }
  function patch(ids){
    if(!ids.length) return Promise.resolve(true);
    var y = window.scrollY;
    return fetch(CFG.sectionUrl + "?session=" + encodeURIComponent(CFG.sessionId) + "&ids=" + encodeURIComponent(ids.join(",")), { cache: "no-store" })
      .then(function(r){ return r.json(); })
      .then(function(v){
        if(!v || !v.sections) return false;
        var ok = v.sections.length === ids.length;
        v.sections.forEach(function(b){ ok = replaceBlock(b.id, b.html) && ok; });
        if(window.bftReview) window.bftReview.refresh(v.docRev);
        if(v.deepAt) seenAt = v.deepAt;
        window.scrollTo(0, y);
        return ok;
      })
      .catch(function(){ return false; });
  }
  // Отправленные замечания: внесено — закрыть на странице; не вышло — вернуть в «к отправке».
  function settleComments(done){
    if(!done.length) return;
    var refs = {}, retry = {};
    done.forEach(function(r){ (r.remarks || []).forEach(function(m){ if(m.ref){ if(r.stage === "ready") refs[m.ref] = 1; else retry[m.ref] = 1; } }); });
    var now = new Date().toISOString(), changed = false;
    var list = comments().map(function(c){ if(refs[String(c.ts)] && !c.closedAt){ changed = true; var x = Object.assign({}, c); x.closedAt = now; x.iteration = 0; return x; } return c; });
    if(changed) put(CFG.store, JSON.stringify(list));
    if(Object.keys(retry).length) put(SENT_KEY, JSON.stringify(sentSet().filter(function(ts){ return !retry[String(ts)]; })));
    if(changed && window.bftReview) window.bftReview.render();
    renderPending();
  }

  var running = false, timer = null, seenAt = CFG.deepAt, known = null;
  function poll(now){
    clearTimeout(timer);
    var go = function(){
      fetch(CFG.statusUrl + "?session=" + encodeURIComponent(CFG.sessionId), { cache: "no-store" })
        .then(function(r){ return r.json(); })
        .then(function(data){
          if(!data || !data.items) return;
          running = !!data.running;
          btn.classList.toggle("busy", running);
          renderList(data); renderPending();
          var busyReview = data.items.some(function(r){ return r.kind === "review" && active(r); });
          dot.hidden = !data.reviewDue || busyReview;
          var first = known === null, prev = known || {};
          known = {};
          data.items.forEach(function(r){ known[r.id] = r.stage; });
          if(first) return;
          // Закончилось с прошлого опроса: правка, ревью, откат (новые — тоже: могли пройти между опросами).
          var done = data.items.filter(function(r){ return (!prev[r.id] || active({ stage: prev[r.id] })) && !active(r); });
          settleComments(done.filter(function(r){ return r.kind === "revise"; }));
          var changed = done.filter(function(r){ return r.stage === "ready" && (r.kind === "undo" || r.edits); }).reverse();
          if(!changed.length){
            if(data.deepAt && seenAt && data.deepAt !== seenAt && !running) $("bftAgentFresh").style.display = "flex";
            return;
          }
          if(changed.some(function(r){ return !r.sections; })){ reload(); return; }
          var ids = [];
          changed.forEach(function(r){ r.sections.forEach(function(id){ if(ids.indexOf(id) < 0) ids.push(id); }); });
          return patch(ids).then(function(ok){ if(!ok) reload(); });
        })
        .catch(function(){})
        .then(function(){ timer = setTimeout(go, running ? 1500 : 20000); });
    };
    if(now) go(); else timer = setTimeout(go, 20000);
  }

  function start(){
    reopenUnsent();
    hijackCopy();
    placeDot();
    renderPending();
    try{
      var y = sessionStorage.getItem("bft-agent-scroll");
      if(y){ sessionStorage.removeItem("bft-agent-scroll"); window.scrollTo(0, parseInt(y, 10) || 0); }
      if(sessionStorage.getItem(OPEN_KEY)) setOpen(true);
    }catch(e){}
    poll(true);
  }
  // После скрипта страницы ревью: он закрывает замечания и рисует «Комментарии».
  if(document.readyState === "complete") setTimeout(start, 0); else window.addEventListener("load", function(){ setTimeout(start, 0); });
})();
</script>`
}

/** Колонка агента — перед </body> страницы полного БФТ. */
export function agentLayer(cfg: AgentLayer): string {
  return STYLE + MARKUP + script(cfg)
}

export function withAgent(page: string, cfg: AgentLayer): string {
  const at = page.lastIndexOf('</body>')
  return at < 0 ? page + agentLayer(cfg) : page.slice(0, at) + agentLayer(cfg) + page.slice(at)
}
