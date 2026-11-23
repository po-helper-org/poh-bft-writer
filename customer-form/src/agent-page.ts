/**
 * Колонка «🤖 ИИ-агент» на странице полного БФТ (ADR-0021) — как у отчёта /sprints:
 * замечания из «Комментариев» страницы или своим текстом → агент правит документ,
 * ход виден живьём, по каждому замечанию — итог (внесено / уже так / вопрос /
 * не внесено), страница обновляется сама; последнюю правку можно откатить.
 * Чат портала не нужен: работает и на отдельной ссылке документа.
 */

export interface AgentLayer {
  sessionId: string
  /** Ключ замечаний страницы ревью (bft-html-export.js): bft-comments-<slug>. */
  store: string
  reviseUrl: string
  statusUrl: string
  undoUrl: string
  /** deep.json finishedAt на момент отдачи страницы: изменился — документ обновили. */
  deepAt: string | null
}

const STYLE = `<style id="bft-agent-style">
#bftAgentBtn{position:fixed;right:18px;bottom:18px;z-index:60;display:flex;align-items:center;gap:8px;padding:11px 16px;border-radius:999px;border:0;
  background:#111;color:#fff;font:600 14px/1 system-ui,-apple-system,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer}
#bftAgentBtn .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;display:none}
#bftAgentBtn.busy .dot{display:block;animation:bftPulse 1s infinite}
@keyframes bftPulse{50%{opacity:.3}}
#bftAgent{position:fixed;top:0;right:0;bottom:0;z-index:61;width:min(440px,100vw);background:#fff;color:#111;border-left:1px solid #e4e1da;
  box-shadow:-10px 0 30px rgba(0,0,0,.12);display:flex;flex-direction:column;font:14px/1.45 system-ui,-apple-system,sans-serif;transform:translateX(105%);transition:transform .2s}
#bftAgent.open{transform:none}
#bftAgent header{display:flex;align-items:flex-start;gap:10px;padding:16px 16px 10px;border-bottom:1px solid #eee}
#bftAgent header b{font-size:16px}
#bftAgent header small{display:block;color:#777;font-size:12px;margin-top:2px}
#bftAgent header button{margin-left:auto;border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#555}
#bftAgent .ag-body{flex:1;overflow:auto;padding:12px 16px 16px}
#bftAgent .ag-box{border:1px solid #e7e5e0;border-radius:12px;padding:12px;margin-bottom:12px;background:#fafaf8}
#bftAgent .ag-box h5{margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#777}
#bftAgent textarea,#bftAgent input{width:100%;box-sizing:border-box;border:1px solid #d9d6cf;border-radius:10px;padding:9px 10px;font:inherit;background:#fff;color:inherit}
#bftAgent textarea{min-height:84px;resize:vertical}
#bftAgent .ag-row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
#bftAgent .ag-send{border:0;border-radius:10px;padding:9px 14px;background:#111;color:#fff;font-weight:600;cursor:pointer}
#bftAgent .ag-send:disabled{opacity:.4;cursor:default}
#bftAgent .ag-ghost{border:1px solid #d9d6cf;border-radius:10px;padding:7px 12px;background:#fff;cursor:pointer;font:inherit;font-size:13px}
#bftAgent .ag-note{color:#777;font-size:12px}
#bftAgent .ag-err{color:#b91c1c;font-size:13px;white-space:pre-wrap}
#bftAgent .ag-rev{border:1px solid #e7e5e0;border-radius:12px;padding:10px 12px;margin-bottom:10px}
#bftAgent .ag-rev .ag-top{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#777}
#bftAgent .ag-chip{border-radius:999px;padding:1px 8px;font-size:12px;font-weight:600;white-space:nowrap}
#bftAgent .ag-chip.run{background:#fef3c7;color:#92400e}#bftAgent .ag-chip.ok{background:#dcfce7;color:#166534}
#bftAgent .ag-chip.err{background:#fee2e2;color:#991b1b}#bftAgent .ag-chip.undo{background:#e5e7eb;color:#374151}
#bftAgent ol{margin:8px 0 0;padding-left:20px}
#bftAgent li{margin:4px 0}
#bftAgent li .ag-res{display:block;font-size:12px;color:#555}
#bftAgent li .ag-res.applied{color:#166534}#bftAgent li .ag-res.question{color:#92400e}#bftAgent li .ag-res.skipped{color:#991b1b}
#bftAgent .ag-live{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:13px}
#bftAgent .ag-spin{width:14px;height:14px;border:2px solid #ddd;border-top-color:#111;border-radius:50%;animation:bftSpin .8s linear infinite}
@keyframes bftSpin{to{transform:rotate(360deg)}}
#bftAgentFresh{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:62;background:#111;color:#fff;border-radius:999px;padding:10px 16px;font:600 14px system-ui,sans-serif;display:none;gap:10px;align-items:center}
#bftAgentFresh button{border:0;border-radius:999px;padding:5px 12px;font:inherit;cursor:pointer}
@media (prefers-color-scheme:dark){
  #bftAgent{background:#151515;color:#eee;border-color:#333}#bftAgent header{border-color:#2a2a2a}
  #bftAgent .ag-box{background:#1c1c1c;border-color:#333}#bftAgent .ag-rev{border-color:#333}
  #bftAgent textarea,#bftAgent input,#bftAgent .ag-ghost{background:#111;border-color:#3a3a3a;color:#eee}
  #bftAgent .ag-send{background:#eee;color:#111}#bftAgentBtn{background:#eee;color:#111}
  #bftAgent li .ag-res{color:#bbb}
}
@media print{#bftAgentBtn,#bftAgent,#bftAgentFresh{display:none!important}}
</style>`

const MARKUP = `<button type="button" id="bftAgentBtn" aria-controls="bftAgent" aria-expanded="false"><span class="dot"></span>🤖 ИИ-агент</button>
<aside id="bftAgent" aria-label="ИИ-агент правок документа" aria-hidden="true">
  <header><div><b>🤖 ИИ-агент</b><small>Правит этот документ по вашим замечаниям и проверяет шаблон</small></div><button type="button" id="agClose" aria-label="Закрыть">×</button></header>
  <div class="ag-body">
    <div class="ag-box" id="agWho" hidden><h5>Как вас подписать</h5><input id="agAuthor" maxlength="120" placeholder="Имя и фамилия — видно в журнале правок"></div>
    <div class="ag-box"><h5>Замечания со страницы</h5>
      <div id="agPending" class="ag-note">Выделите текст в документе или нажмите на точку у [УТОЧНИТЬ] — замечание появится здесь.</div>
      <div class="ag-row"><button type="button" class="ag-send" id="agSendComments" disabled>Отправить замечания</button></div>
    </div>
    <div class="ag-box"><h5>Своё указание</h5>
      <textarea id="agText" placeholder="Что поправить: «в Рисках добавь фичефриз перед новым годом», «ФТ-2 — данные по контракту у команды GDS»…"></textarea>
      <div class="ag-row"><button type="button" class="ag-send" id="agSendText">Отправить агенту</button><span class="ag-note">Ctrl+Enter</span></div>
    </div>
    <div id="agMsg" class="ag-err" hidden></div>
    <div id="agList"></div>
  </div>
</aside>
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
  $("agWho").hidden = !!author.value;
  author.addEventListener("change", function(){ put(WHO_KEY, author.value.trim()); });

  function message(text){ var m = $("agMsg"); m.textContent = text || ""; m.hidden = !text; }
  function renderPending(){
    var list = pending(), box = $("agPending"), send = $("agSendComments");
    send.disabled = !list.length || running;
    send.textContent = list.length ? "Отправить замечания (" + list.length + ")" : "Отправить замечания";
    box.innerHTML = list.length
      ? "<ol>" + list.map(function(c){ return "<li><b>[" + esc(c.section) + "]</b>" + (c.quote ? " «" + esc(c.quote.slice(0, 80)) + (c.quote.length > 80 ? "…" : "") + "»" : "") + " — " + esc(c.text) + "</li>"; }).join("") + "</ol>"
      : "Выделите текст в документе или нажмите на точку у [УТОЧНИТЬ] — замечание появится здесь.";
  }
  window.addEventListener("storage", function(e){ if(e.key === CFG.store) renderPending(); });
  setInterval(function(){ if(drawer.classList.contains("open")) renderPending(); }, 2000);

  function send(remarks, onSent){
    var who = author.value.trim();
    if(!who){ $("agWho").hidden = false; author.focus(); message("Подпишитесь — имя попадёт в журнал правок."); return; }
    put(WHO_KEY, who);
    message("");
    fetch(CFG.reviseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId, remarks: remarks, author: who }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || ("HTTP " + r.status)); return v; }); })
      .then(function(v){ watching = v.id; onSent && onSent(); setOpen(true); poll(true); })
      .catch(function(e){ message("Не отправилось: " + e.message); });
  }
  function sendComments(){
    var list = pending();
    if(!list.length) return;
    send(list.map(function(c){ return { section: c.section, quote: c.quote || "", text: c.text }; }), function(){
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
  $("agText").addEventListener("keydown", function(e){ if(e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendText(); });

  // «Комментарии» страницы ревью: вместо «Скопировать промт» — сразу агенту.
  function hijackCopy(){
    var old = $("copyBtn"); if(!old) return;
    var b = old.cloneNode(true); old.parentNode.replaceChild(b, old);
    b.textContent = "Отправить ИИ-агенту";
    b.addEventListener("click", function(){ if(pending().length) sendComments(); else { setOpen(true); message("Новых замечаний нет — выделите текст или нажмите на точку у [УТОЧНИТЬ]."); } });
    var out = $("promptOut"); if(out){ out.style.display = "none"; var h = out.previousElementSibling; if(h && h.tagName === "H4") h.textContent = "Замечания уйдут ИИ-агенту — он поправит документ"; }
  }

  var STATUS = { applied: ["✓ внесено", "applied"], already: ["= уже так", "already"], question: ["? открытый вопрос", "question"], skipped: ["✗ не внесено", "skipped"] };
  function chip(r){
    if(r.kind === "undo") return '<span class="ag-chip undo">откат</span>';
    if(r.stage === "writing") return '<span class="ag-chip run">пишет правки</span>';
    if(r.stage === "checking") return '<span class="ag-chip run">проверяет</span>';
    if(r.stage === "failed") return '<span class="ag-chip err">не вышло</span>';
    return '<span class="ag-chip ok">' + (r.edits ? "правок: " + r.edits : "без правок") + '</span>';
  }
  function live(r){
    if(r.stage === "writing") return '<div class="ag-live"><span class="ag-spin"></span>Пишет правки' + (r.progress && r.progress.chars ? " · " + r.progress.chars + " знаков" : "") + (r.progress && r.progress.round > 1 ? " · круг " + r.progress.round + " (добирает)" : "") + "</div>";
    if(r.stage === "checking") return '<div class="ag-live"><span class="ag-spin"></span>Проверяет шаблон: bft-lint и проверки портала' + (r.progress && r.progress.note ? " · " + esc(r.progress.note) : "") + "</div>";
    return "";
  }
  var lastUndoable = null;
  function renderList(data){
    lastUndoable = null;
    for(var i = 0; i < data.items.length; i++){ var it = data.items[i]; if(it.kind === "revise" && it.stage === "ready" && it.edits){ if(it.undoable) lastUndoable = it.id; break; } }
    $("agList").innerHTML = data.items.length ? data.items.map(function(r){
      if(r.kind === "undo") return '<div class="ag-rev"><div class="ag-top"><span>' + esc(when(r.at)) + (r.author ? " · " + esc(r.author) : "") + "</span>" + chip(r) + "</div><div>Возвращена версия до правки агента.</div></div>";
      var items = (r.remarks || []).map(function(m, i){
        var res = (r.results || []).filter(function(x){ return x.n === i + 1; })[0], st = res && STATUS[res.status];
        return "<li><b>[" + esc(m.section) + "]</b> " + esc(m.text) + (st ? '<span class="ag-res ' + st[1] + '">' + st[0] + (res.note ? " — " + esc(res.note) : "") + "</span>" : "") + "</li>";
      }).join("");
      return '<div class="ag-rev"><div class="ag-top"><span>' + esc(when(r.at)) + (r.author ? " · " + esc(r.author) : "") + "</span>" + chip(r) + "</div>"
        + live(r) + (r.error ? '<div class="ag-err">' + esc(r.error) + "</div>" : "") + "<ol>" + items + "</ol>"
        + (r.id === lastUndoable ? '<div class="ag-row"><button type="button" class="ag-ghost" data-undo="' + esc(r.id) + '">Вернуть версию до этой правки</button></div>' : "") + "</div>";
    }).join("") : '<p class="ag-note">Правок пока не было. Отправьте замечания — агент внесёт их в документ за минуту-две и покажет, что сделал.</p>';
  }
  $("agList").addEventListener("click", function(e){
    var b = e.target.closest("[data-undo]"); if(!b) return;
    if(!confirm("Вернуть документ к версии до этой правки агента?")) return;
    b.disabled = true;
    fetch(CFG.undoUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId, id: b.getAttribute("data-undo"), author: author.value.trim() }) })
      .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || r.status); }); })
      .then(reload).catch(function(err){ b.disabled = false; message("Откат не вышел: " + err.message); });
  });

  function reload(){ try{ sessionStorage.setItem(OPEN_KEY, "1"); sessionStorage.setItem("bft-agent-scroll", String(window.scrollY)); }catch(e){} location.reload(); }
  $("agReload").addEventListener("click", reload);

  var running = false, watching = null, timer = null, seenAt = CFG.deepAt;
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
          var mine = watching && data.items.filter(function(r){ return r.id === watching; })[0];
          if(mine && mine.stage === "ready" && mine.edits){ watching = null; reload(); return; }
          if(mine && mine.stage !== "writing" && mine.stage !== "checking") watching = null;
          // Документ поправил кто-то ещё (или агент по чужим замечаниям) — предложить обновить.
          if(data.deepAt && seenAt && data.deepAt !== seenAt && !watching) $("bftAgentFresh").style.display = "flex";
        })
        .catch(function(){})
        .then(function(){ timer = setTimeout(go, running || watching ? 2500 : 20000); });
    };
    if(now) go(); else timer = setTimeout(go, 20000);
  }

  function start(){
    reopenUnsent();
    hijackCopy();
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
