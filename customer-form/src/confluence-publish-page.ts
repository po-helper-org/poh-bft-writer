/**
 * «Отправить в Confluence» на странице полного БФТ (ADR-0028): вкладка в рейке боковых
 * панелей (ADR-0026) и своя выдвижная панель справа — выбор родительской страницы
 * (ТОП-5, поиск по названию, вставка ссылки) и ход отправки по шагам из workflow
 * ConfluencePublish. Ход читается с сервера при каждом открытии страницы — перезагрузка
 * его не теряет. Без сборки: строка HTML + небольшой скрипт, данные — через textContent.
 */

const STYLE = `<style id="cs-cf-style">
.cs-rail-tab.cf{ background:#0b57d0; }
.cs-cf-btn{ font:600 .85rem/1.2 system-ui,sans-serif; border:1px solid var(--fg); background:var(--bg); color:var(--fg); border-radius:6px; padding:.35rem .7rem; cursor:pointer; margin:0 0 1rem; }
.cs-cf{ position:fixed; right:0; top:0; bottom:0; width:min(440px, 100vw); z-index:64; display:none; flex-direction:column;
  background:var(--bg); color:var(--fg); border-left:1px solid var(--fg); box-shadow:-3px 0 0 var(--line-soft, #ddd); font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
.cs-cf.open{ display:flex; }
.cs-cf-head{ display:flex; align-items:center; justify-content:space-between; gap:.5rem; padding:.9rem 1rem .6rem; border-bottom:1px solid var(--line-soft, #ddd); }
.cs-cf-head h4{ margin:0; font-size:.95rem; }
.cs-cf-x{ background:none; border:1px solid var(--line-soft, #ddd); color:var(--fg); cursor:pointer; font-size:1rem; line-height:1; padding:.1rem .5rem; border-radius:4px; }
.cs-cf-body{ flex:1; overflow-y:auto; padding:.6rem 1rem 1rem; }
.cs-cf-group{ margin:1rem 0 .35rem; font-size:.72rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
.cs-cf-note{ color:var(--muted); font-size:.84rem; margin:.3rem 0; }
.cs-cf-pub{ border:1px solid #2f7d32; border-radius:6px; padding:.5rem .7rem; font-size:.85rem; margin:.4rem 0; }
.cs-cf-search{ width:100%; box-sizing:border-box; font:inherit; font-size:.9rem; padding:.45rem .6rem; border:1px solid var(--fg); background:transparent; color:inherit; border-radius:6px; }
.cs-cf-list{ list-style:none; margin:0; padding:0; }
.cs-cf-item{ display:block; border:1px solid var(--line-soft, #ddd); border-radius:6px; padding:.45rem .6rem; margin:.35rem 0; cursor:pointer; }
.cs-cf-item:hover{ border-color:var(--fg); }
.cs-cf-item.sel{ border-color:#0b57d0; box-shadow:0 0 0 1px #0b57d0 inset; }
.cs-cf-item b{ display:block; font-size:.9rem; }
.cs-cf-item small{ display:block; color:var(--muted); font-size:.76rem; margin-top:.1rem; }
.cs-cf-foot{ border-top:1px solid var(--line-soft, #ddd); padding:.8rem 1rem 1rem; }
.cs-cf-chosen{ font-size:.84rem; margin:0 0 .5rem; color:var(--muted); }
.cs-cf-chosen b{ color:var(--fg); }
.cs-cf-main{ display:block; width:100%; font:600 .92rem/1.2 system-ui,sans-serif; padding:.6rem .8rem; border:1px solid var(--fg); border-radius:8px; background:var(--fg); color:var(--bg); cursor:pointer; }
.cs-cf-main:disabled{ opacity:.45; cursor:not-allowed; }
.cs-cf-alt{ display:block; width:100%; margin-top:.4rem; font:inherit; font-size:.85rem; padding:.45rem; border:1px solid var(--line-soft, #ddd); border-radius:8px; background:none; color:inherit; cursor:pointer; }
.cs-cf-steps{ list-style:none; margin:.4rem 0; padding:0; }
.cs-cf-step{ display:flex; gap:.6rem; padding:.5rem 0; border-bottom:1px solid var(--line-soft, #ddd); }
.cs-cf-step i{ font-style:normal; width:1.3rem; text-align:center; flex:none; }
.cs-cf-step.running i{ animation:cs-cf-spin 1s linear infinite; display:inline-block; }
.cs-cf-step.done i{ color:#2f7d32; } .cs-cf-step.failed i{ color:#c00; }
.cs-cf-step small{ display:block; color:var(--muted); font-size:.78rem; }
.cs-cf-step.failed small{ color:#c00; }
@keyframes cs-cf-spin{ to{ transform:rotate(360deg); } }
.cs-cf-err{ border:1px solid #c00; color:#c00; border-radius:6px; padding:.5rem .7rem; font-size:.86rem; margin:.6rem 0; }
.cs-cf-ok{ border:1px solid #2f7d32; border-radius:6px; padding:.6rem .7rem; margin:.6rem 0; }
.cs-cf-ok a{ font-weight:600; word-break:break-all; }
@media print{ .cs-cf, .cs-cf-btn{ display:none !important; } }
</style>`

function drawer(sessionId: string): string {
  const s = JSON.stringify(encodeURIComponent(sessionId))
  return `<aside class="cs-cf" id="csCf" aria-label="Отправить в Confluence" aria-hidden="true">
<div class="cs-cf-head"><h4>Отправить в Confluence</h4><button type="button" class="cs-cf-x" id="csCfX" aria-label="Закрыть">×</button></div>
<div class="cs-cf-body" id="csCfBody"></div>
<div class="cs-cf-foot" id="csCfFoot"></div>
</aside>
<script id="cs-cf-script">(function(){
var S=${s}, box=document.getElementById("csCf"), body=document.getElementById("csCfBody"), foot=document.getElementById("csCfFoot");
var chosen=null, data=null, poll=null, timer=null, last=null;
function el(tag, cls, text){ var e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
function get(path){ return fetch(path, {headers:{accept:"application/json"}, credentials:"same-origin"}).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||("ошибка "+r.status)); return j; }); }); }
function open(){ box.classList.add("open"); box.setAttribute("aria-hidden","false"); }
function close(){ box.classList.remove("open"); box.setAttribute("aria-hidden","true"); }
document.getElementById("csCfX").addEventListener("click", close);
document.querySelectorAll("[data-cs-cf]").forEach(function(b){ b.addEventListener("click", function(){ open(); start(); }); });
function label(t){ document.querySelectorAll("[data-cs-cf]").forEach(function(b){ b.textContent=t; }); }
function item(p, reasons){
  var li=el("li","cs-cf-item"); li.tabIndex=0; li.setAttribute("role","option");
  li.appendChild(el("b",null,p.title));
  var meta=[p.space?("пространство "+p.space):"", (reasons||[]).join(" · ")].filter(Boolean).join(" — ");
  if(meta) li.appendChild(el("small",null,meta));
  function pick(){ chosen={id:p.id,title:p.title,space:p.space,url:p.url}; body.querySelectorAll(".cs-cf-item").forEach(function(x){ x.classList.toggle("sel", x===li); }); renderFoot(); }
  li.addEventListener("click", pick); li.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); pick(); } });
  if(chosen && chosen.id===p.id) li.classList.add("sel");
  return li;
}
function renderFoot(){
  foot.textContent="";
  var c=el("p","cs-cf-chosen");
  if(chosen){ c.appendChild(document.createTextNode("Подстраницей страницы ")); c.appendChild(el("b",null,"«"+chosen.title+"»")); }
  else c.textContent="Выберите родительскую страницу — БФТ появится её подстраницей.";
  foot.appendChild(c);
  var go=el("button","cs-cf-main", data&&data.published?"Отправить (обновить страницу)":"Отправить"); go.type="button"; go.id="csCfSend"; go.disabled=!chosen;
  go.addEventListener("click", send); foot.appendChild(go);
  if(data && !data.configured) foot.appendChild(el("p","cs-cf-note","Публикация ещё не настроена администратором — отправка покажет, чего не хватает."));
}
function renderPick(){
  stopPoll(); body.textContent="";
  if(data.published){
    var pub=el("div","cs-cf-pub"); pub.appendChild(document.createTextNode("Уже опубликовано: "));
    var a=el("a",null,"открыть страницу"); a.href=data.published.url; a.target="_blank"; a.rel="noopener"; pub.appendChild(a);
    pub.appendChild(document.createTextNode(". Повторная отправка обновит эту же страницу, дубля не будет.")); body.appendChild(pub);
  }
  body.appendChild(el("div","cs-cf-group","Найти свою страницу"));
  var q=el("input","cs-cf-search"); q.type="search"; q.id="csCfQ"; q.placeholder="Название страницы или ссылка на неё"; q.autocomplete="off"; body.appendChild(q);
  var found=el("ul","cs-cf-list"); found.id="csCfFound"; body.appendChild(found);
  var hint=el("p","cs-cf-note"); body.appendChild(hint);
  q.addEventListener("input", function(){ clearTimeout(timer); var v=q.value.trim(); found.textContent=""; hint.textContent=""; if(v.length<2) return;
    timer=setTimeout(function(){ hint.textContent="Ищу…"; get("customer-form.confluenceSearch?session="+S+"&q="+encodeURIComponent(v)).then(function(r){
      if(q.value.trim()!==v) return; hint.textContent=r.message||""; r.results.forEach(function(p){ found.appendChild(item(p,[])); });
      if(r.results.length===1 && /^https?:|^\\d+$/.test(v)){ found.firstChild.click(); }
    }).catch(function(e){ hint.textContent=e.message; }); }, 400); });
  body.appendChild(el("div","cs-cf-group","Куда лучше положить — ТОП-5"));
  if(!data.suggestions.length) body.appendChild(el("p","cs-cf-note", data.searchable?"Подходящих страниц не нашлось — найдите свою поиском выше.":"Поиск по Confluence сейчас недоступен — вставьте ссылку на страницу."));
  var list=el("ul","cs-cf-list"); list.id="csCfTop"; data.suggestions.forEach(function(p){ list.appendChild(item(p,p.reasons)); }); body.appendChild(list);
  renderFoot();
}
var ICON={pending:"○", running:"◌", done:"✓", failed:"✕"};
function renderProgress(r){
  body.textContent=""; foot.textContent="";
  var p=r.progress||{status:"running"};
  body.appendChild(el("p","cs-cf-note", r.parent?("Подстраница «"+r.parent.title+"»"):"Отправка"));
  var steps=p.steps||[{key:"start",label:"Отправка запущена — ждём исполнителя",status:"running"}];
  var ul=el("ol","cs-cf-steps"); ul.id="csCfSteps";
  steps.forEach(function(s){ var li=el("li","cs-cf-step "+s.status); li.dataset.step=s.key; li.appendChild(el("i",null,ICON[s.status]||"○")); var t=el("div"); t.appendChild(el("span",null,s.label)); if(s.detail) t.appendChild(el("small",null,s.detail)); li.appendChild(t); ul.appendChild(li); });
  body.appendChild(ul);
  (p.warnings||[]).forEach(function(w){ body.appendChild(el("p","cs-cf-note","⚠ "+w)); });
  if(p.status==="done"){
    var ok=el("div","cs-cf-ok"); ok.id="csCfDone"; ok.appendChild(el("div",null,"Готово — БФТ опубликован в Confluence."));
    var url=p.url||(r.published&&r.published.url); if(url){ var a=el("a",null,url); a.href=url; a.target="_blank"; a.rel="noopener"; ok.appendChild(a); }
    body.appendChild(ok); label("✓ В Confluence");
    var again=el("button","cs-cf-alt","Отправить ещё раз или в другое место"); again.type="button"; again.addEventListener("click", function(){ load(); }); foot.appendChild(again);
  } else if(p.status==="failed" || p.status==="unknown"){
    var err=el("div","cs-cf-err", p.error||"Отправка не удалась."); err.id="csCfErr"; body.appendChild(err);
    var retry=el("button","cs-cf-main","Повторить"); retry.type="button"; retry.id="csCfRetry";
    retry.addEventListener("click", function(){ chosen=r.parent; send(); }); foot.appendChild(retry);
    var other=el("button","cs-cf-alt","Выбрать другую страницу"); other.type="button"; other.addEventListener("click", function(){ load(); }); foot.appendChild(other);
  } else {
    foot.appendChild(el("p","cs-cf-note","Можно закрыть панель или перезагрузить страницу — отправка продолжится, ход сохранится."));
  }
}
function stopPoll(){ if(poll){ clearInterval(poll); poll=null; } }
function watch(){ stopPoll(); var tick=function(){ get("customer-form.confluenceProgress?session="+S).then(function(r){ last=r; renderProgress(r); var st=r.progress&&r.progress.status; if(st==="done"||st==="failed"||st==="unknown") stopPoll(); }).catch(function(e){ body.appendChild(el("p","cs-cf-err",e.message)); stopPoll(); }); }; tick(); poll=setInterval(tick, 2000); }
function load(){
  stopPoll(); body.textContent=""; foot.textContent=""; body.appendChild(el("p","cs-cf-note","Подбираю, куда лучше положить БФТ…"));
  get("customer-form.confluenceParents?session="+S).then(function(d){ data=d; if(!chosen && d.current) chosen=d.current; renderPick(); })
    .catch(function(e){ body.textContent=""; body.appendChild(el("p","cs-cf-err",e.message)); });
}
function send(){
  if(!chosen) return; var b=document.getElementById("csCfSend")||document.getElementById("csCfRetry"); if(b) b.disabled=true;
  fetch("customer-form.confluencePublish", {method:"POST", credentials:"same-origin", headers:{"content-type":"application/json"}, body:JSON.stringify({session:decodeURIComponent(S), parent:chosen})})
    .then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j.error||("ошибка "+r.status)); return j; }); })
    .then(function(){ label("◌ В Confluence…"); watch(); })
    .catch(function(e){ if(b) b.disabled=false; var err=el("div","cs-cf-err",e.message); err.id="csCfErr"; body.insertBefore(err, body.firstChild); });
}
function start(){ if(last && last.progress && last.progress.status==="running") watch(); else load(); }
// Отправка идёт (или только что прошла) — панель открыта сразу: после перезагрузки ход виден.
get("customer-form.confluenceProgress?session="+S).then(function(r){ last=r; var st=r.progress&&r.progress.status;
  if(st==="running"){ open(); label("◌ В Confluence…"); watch(); } else if(r.published) label("✓ В Confluence"); }).catch(function(){});
})();</script>`
}

/** Страница полного БФТ + вкладка/кнопка «Отправить в Confluence» и панель. */
export function withConfluence(page: string, sessionId: string): string {
  let out = page
  const rail = out.indexOf('<nav class="cs-rail"')
  const railEnd = rail < 0 ? -1 : out.indexOf('</nav>', rail)
  if (railEnd > 0) {
    const tab = '<button type="button" class="cs-rail-tab cf" data-cs-cf title="Опубликовать БФТ подстраницей выбранной страницы Confluence">⇪ В Confluence</button>'
    out = out.slice(0, railEnd) + tab + out.slice(railEnd)
  } else {
    // Без рейки (нет формы вопросов) — кнопкой под «Скачать».
    const dl = out.indexOf('id="customer-download-deep"')
    const end = dl < 0 ? -1 : out.indexOf('</div>', dl)
    const btn = '<button type="button" class="cs-cf-btn" data-cs-cf>⇪ Отправить в Confluence</button>'
    if (end > 0) out = out.slice(0, end + 6) + btn + out.slice(end + 6)
    else {
      const h1 = out.indexOf('</h1>')
      out = h1 < 0 ? btn + out : out.slice(0, h1 + 5) + btn + out.slice(h1 + 5)
    }
  }
  const html = STYLE + drawer(sessionId)
  const at = out.lastIndexOf('</body>')
  return at < 0 ? out + html : out.slice(0, at) + html + out.slice(at)
}
