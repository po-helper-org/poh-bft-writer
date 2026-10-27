/**
 * Страница быстрой версии БФТ глазами заказчика (ADR-0007 rev15).
 *
 * Сам документ рендерит bft-html-export.py навыка — та же страница уходит PO в
 * заявку. Узел при выдаче заказчику накладывает поверх неё слой:
 *  - «Всё ок — отгружай в Confluence/Jira» → «Согласовать»: согласование
 *    фиксирует узел (/api/customer-form.bftFastApprove), в чат уходит строка
 *    о согласовании;
 *  - «Скопировать промт» → «Отправить замечания в чат»: замечания сразу
 *    отправляются сообщением в чат (клиент customer-form: setDraft + submit),
 *    агент правит поля и пересобирает документ;
 *  - промт для PO и открытое поле для /bft-deep заказчику не показываются.
 * Хранилище замечаний — то же, что у страницы (bft-comments-<slug>): отметка
 * sentAt не даёт отправить одно замечание дважды.
 */

export interface CustomerLayer {
  sessionId: string
  slug: string
  approveUrl: string
  /** Согласование этой же версии документа, если было. */
  approvedAt?: string
}

const STYLE = `<style id="customer-layer-style">
#promptOut{ display:none !important; }
.shipbtn.approved{ border-color:#2f6b2a; color:#2f6b2a; cursor:default; }
/* Узкая правая панель портала: плавающие кнопки сверху и рейка слева не наезжают на текст. */
@media (max-width:1100px){ .layout{ padding-top:5.5rem; padding-left:3rem; padding-right:1.25rem; } }
#panel h4 + #itemsList + h4{ display:none; }
.panel{ width:min(360px, calc(100vw - 4rem)); box-sizing:border-box; }
.shiphint{ max-width:min(340px, calc(100vw - 4rem)); }
</style>`

function script(layer: CustomerLayer): string {
  // json.dumps-подобная подстановка: значения не ломают литерал скрипта.
  const cfg = JSON.stringify({ ...layer, store: `bft-comments-${layer.slug}` }).replace(/</g, '\\u003c')
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

  // Связь с чатом: клиент customer-form отправляет текст сообщением и отвечает ack.
  var acked = {};
  window.addEventListener("message", function(e){
    if(e.origin !== location.origin || !e.data || e.data.type !== "customer-form/say-ack") return;
    acked[e.data.id] = e.data.ok;
  });
  function say(text, done){
    if(window.parent === window){ done(false); return; }
    var id = Math.random().toString(36).slice(2);
    window.parent.postMessage({ type: "customer-form/say", id: id, text: text }, location.origin);
    setTimeout(function(){ done(acked[id] === true); }, 500);
  }

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
  function approvedView(at){
    approve.textContent = "Согласовано · " + when(at);
    approve.classList.add("approved");
    approve.disabled = true;
  }
  if(approve){
    approve.textContent = "Согласовать";
    if(CFG.approvedAt) approvedView(CFG.approvedAt);
    approve.addEventListener("click", function(){
      var left = unsent().length;
      if(left){ hint("Есть неотправленные замечания (" + left + "): отправьте их в чат или удалите, чтобы согласовать.", false); return; }
      approve.disabled = true;
      fetch(CFG.approveUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: CFG.sessionId }) })
        .then(function(r){ return r.json().then(function(v){ if(!r.ok) throw new Error(v.error || r.status); return v; }); })
        .then(function(v){
          approvedView(v.approvedAt);
          hint("Документ согласован — PO возьмёт его в проработку.", true);
          say("✅ Согласовываю быструю версию БФТ.", function(){});
        })
        .catch(function(e){ approve.disabled = false; hint("Не удалось согласовать: " + e.message, false); });
    });
  }
})();
</script>`
}

/** Страница экспорта + слой заказчика перед </body>. */
export function customerFastPage(html: string, layer: CustomerLayer): string {
  const at = html.lastIndexOf('</body>')
  const layerHtml = STYLE + script(layer)
  return at < 0 ? html + layerHtml : html.slice(0, at) + layerHtml + html.slice(at)
}
