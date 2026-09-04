<script>
(function(){
  function run(){
    if(!window.mermaid){
      var host = document.querySelector("pre.mermaid");
      if(host) host.insertAdjacentHTML("beforebegin", '<p style="color:#e00000;font-family:\'Courier New\',monospace;font-size:.8rem">mermaid.js не загрузился (нет сети?) — ниже сырой код диаграммы.</p>');
      return;
    }
    // Тема neutral рисует подписи серым по светлому — на печатной ч/б странице
    // текст диаграммы не читается. Палитра задаётся явно и повторяет страницу:
    // чёрный текст и линии, белые фигуры, серая заливка только у заметок.
    mermaid.initialize({
      startOnLoad:false,
      securityLevel:"loose",
      theme:"base",
      fontFamily:'Georgia, "Times New Roman", serif',
      // useMaxWidth:false — иначе mermaid ужимает всю схему под ширину колонки
      // текста и вместе с ней ужимает подписи: формально чёрные, фактически
      // нечитаемые. Схема рисуется в натуральную величину, а не влезающая по
      // ширине прокручивается внутри своего блока (.mermaid{overflow-x:auto}).
      sequence:{ useMaxWidth:false, actorFontSize:16, messageFontSize:15, noteFontSize:15,
                 wrap:true, width:165, boxMargin:10 },
      themeVariables:{
        fontFamily:'Georgia, "Times New Roman", serif',
        fontSize:"15px",
        textColor:"#000000",
        lineColor:"#000000",
        primaryColor:"#ffffff",
        primaryTextColor:"#000000",
        primaryBorderColor:"#000000",
        secondaryColor:"#f2f2f2",
        tertiaryColor:"#ffffff",
        actorBkg:"#ffffff",
        actorBorder:"#000000",
        actorTextColor:"#000000",
        actorLineColor:"#000000",
        signalColor:"#000000",
        signalTextColor:"#000000",
        labelBoxBkgColor:"#f2f2f2",
        labelBoxBorderColor:"#000000",
        labelTextColor:"#000000",
        loopTextColor:"#000000",
        noteBkgColor:"#f2f2f2",
        noteBorderColor:"#000000",
        noteTextColor:"#000000",
        altSectionBkgColor:"#ffffff",
        activationBkgColor:"#f2f2f2",
        activationBorderColor:"#000000",
        sequenceNumberColor:"#ffffff"
      }
    });
    mermaid.run({ querySelector:".mermaid" });
  }
  if(document.readyState === "complete" || document.readyState === "interactive") run();
  else document.addEventListener("DOMContentLoaded", run);
  window.addEventListener("load", function(){ if(window.mermaid) run(); });
})();
</script>
<script>
(function(){
  var STORE_KEY = __STORE_KEY_JSON__;
  var DOC_NAME = __DOC_NAME_JSON__;
  var DOC_REV = __DOC_REV_JSON__;      // хэш содержимого документа
  var EPIC = __EPIC_JSON__;
  var REV_KEY = STORE_KEY + "-rev";    // ревизия, на которой писались комментарии
  var ITER_KEY = STORE_KEY + "-iter";  // номер текущего круга правок

  function load(){
    try{ return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }catch(e){ return []; }
  }
  function save(list){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(list)); }catch(e){}
  }
  function esc(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  function fmtDate(iso){
    var d = new Date(iso);
    if(isNaN(d)) return "";
    function p(n){ return (n < 10 ? "0" : "") + n; }
    return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear() +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function copyText(s){
    try{ navigator.clipboard.writeText(s); return true; }
    catch(e){
      try{
        var ta = document.createElement("textarea");
        ta.value = s; document.body.appendChild(ta); ta.select();
        document.execCommand("copy"); ta.remove(); return true;
      }catch(e2){ return false; }
    }
  }

  function currentIteration(){
    var n = parseInt(localStorage.getItem(ITER_KEY) || "1", 10);
    return (isNaN(n) || n < 1) ? 1 : n;
  }

  // Документ пересобран — значит, круг правок уехал в работу и вернулся.
  // Открытые комментарии закрываются с датой и номером круга: удалять их
  // нельзя (по ним видно проделанную работу), но и тянуть в новый промт
  // нельзя — иначе ИИ получает уже выполненные правки второй раз.
  function syncRevision(){
    var seen = null;
    try{ seen = localStorage.getItem(REV_KEY); }catch(e){ return; }
    if(seen && seen !== DOC_REV){
      var now = new Date().toISOString(), iter = currentIteration(), closed = 0;
      var list = load();
      list.forEach(function(c){
        if(!c.closedAt){ c.closedAt = now; c.iteration = iter; closed++; }
      });
      if(closed){
        save(list);
        try{ localStorage.setItem(ITER_KEY, String(iter + 1)); }catch(e){}
      }
    }
    try{ localStorage.setItem(REV_KEY, DOC_REV); }catch(e){}
  }
  syncRevision();

  function openComments(){ return load().filter(function(c){ return !c.closedAt; }); }
  function closedComments(){ return load().filter(function(c){ return !!c.closedAt; }); }
  // Состояние точки — производное от комментариев, а не отдельный флаг: иначе
  // удалённый комментарий оставлял бы точку зелёной и «отвеченной» навсегда.
  function byUnc(list){
    var map = {};
    list.forEach(function(c){
      if(c.uncId){ (map[c.uncId] = map[c.uncId] || []).push(c); }
    });
    return map;
  }
  // Состояние точки считается по ОТКРЫТЫМ комментариям: закрытые относятся к
  // прошлому кругу, и точка, пережившая доработку, снова требует внимания.
  function commentsByUnc(){ return byUnc(openComments()); }
  function closedByUnc(){ return byUnc(closedComments()); }
  function nearestSection(el){
    var main = document.querySelector("main");
    if(!main) return "Документ";
    var top = el;
    while(top && top.parentElement !== main) top = top.parentElement;
    if(!top) return "Документ";
    var node = top;
    while(node){
      if(node.tagName === "H2") return node.textContent.trim();
      node = node.previousElementSibling;
    }
    return "Документ";
  }
  function addComment(section, quote, text, uncId){
    if(!text || !text.trim()) return;
    var list = load();
    list.push({ section: section, quote: quote || "", text: text.trim(), ts: new Date().toISOString(), uncId: uncId || null });
    save(list);
    render();
  }

  /* — section-level comment buttons (optional markup, if present) — */
  document.querySelectorAll(".cbtn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var form = btn.nextElementSibling;
      form.classList.toggle("open");
    });
  });
  document.querySelectorAll(".cform .csave").forEach(function(saveBtn){
    saveBtn.addEventListener("click", function(){
      var form = saveBtn.closest(".cform");
      var btn = form.previousElementSibling;
      var ta = form.querySelector("textarea");
      addComment(btn.getAttribute("data-c"), "", ta.value);
      ta.value = "";
      form.classList.remove("open");
    });
  });
  document.querySelectorAll(".cform textarea").forEach(function(ta){
    ta.addEventListener("keydown", function(e){
      if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
        e.preventDefault();
        ta.closest(".cform").querySelector(".csave").click();
      }
    });
  });

  /* — right-side comments panel — */
  var panel = document.getElementById("panel");
  document.getElementById("panelToggle").addEventListener("click", function(){
    panel.classList.toggle("open");
  });
  document.getElementById("copyBtn").addEventListener("click", function(){
    var ta = document.getElementById("promptOut");
    ta.select();
    copyText(ta.value);
  });

  // Отгрузка. Страница лежит файлом на диске и открыть чат агента не может,
  // поэтому кнопка делает единственное честное: кладёт команду в буфер.
  document.getElementById("shipBtn").addEventListener("click", function(){
    var cmd = "/bft-deliver " + EPIC;
    var hint = document.getElementById("shipHint");
    var ok = copyText(cmd);
    var left = openComments().length;
    hint.textContent = (ok ? "Команда «" + cmd + "» скопирована — вставьте её в чат с агентом."
                           : "Скопируйте команду вручную: " + cmd) +
      (left ? " Учтите: незакрытых комментариев — " + left + "; они в доработку ещё не уходили."
            : "");
    hint.className = "shiphint" + (left ? " warn" : " ok");
  });

  function buildPrompt(list){
    if(!list.length) return "";
    var lines = ["Доработай БФТ-документ " + DOC_NAME + " с учётом следующей обратной связи по разделам:", ""];
    list.forEach(function(item, i){
      var ref = item.quote ? (" (по фрагменту: «" + item.quote + "»)") : "";
      lines.push((i+1) + ". [" + item.section + "]" + ref + " " + item.text);
    });
    // Без пересборки страницы круг правок не закрывается: страница остаётся на
    // прежней ревизии, комментарии не переходят в историю и уезжают в
    // следующий промт повторно.
    lines.push("");
    lines.push("После правок — обязательно, в этом же порядке:");
    lines.push("1. python3 <skills_path>/bft-writer/scripts/bft-lint.py " + DOC_NAME +
               "  (ненулевой код — исправить, документ с ошибками не сохранять)");
    lines.push("2. python3 <skills_path>/bft-writer/scripts/bft-html-export.py " + DOC_NAME +
               "  (пересобрать страницу ревью — без этого замечания придут повторно)");
    return lines.join("\n");
  }

  function render(){
    var list = openComments();
    document.getElementById("cCount").textContent = list.length;
    var box = document.getElementById("itemsList");
    if(!list.length){
      box.innerHTML = '<p class="empty">Комментариев нет.</p>';
    } else {
      box.innerHTML = "";
      list.forEach(function(item, idx){
        var div = document.createElement("div");
        div.className = "item";
        var where = document.createElement("div");
        where.className = "where";
        where.textContent = "[" + item.section + "]" + (item.quote ? " «" + item.quote.slice(0,40) + (item.quote.length>40?"…":"") + "»" : "");
        var p = document.createElement("div");
        p.textContent = item.text;
        var del = document.createElement("button");
        del.textContent = "удалить";
        del.addEventListener("click", function(){
          // idx — позиция среди ОТКРЫТЫХ, а хранится общий список: удалять надо
          // по самой записи, иначе снесётся чужой закрытый комментарий.
          var target = list[idx];
          var removed = false;
          save(load().filter(function(c){
            if(!removed && c === target){ removed = true; return false; }
            if(!removed && c.ts === target.ts && c.text === target.text && !c.closedAt){
              removed = true; return false;
            }
            return true;
          }));
          render();
        });
        div.appendChild(where);
        div.appendChild(p);
        div.appendChild(del);
        box.appendChild(div);
      });
    }
    document.getElementById("promptOut").value = buildPrompt(list);
    paintDots();
    paintLooseMarkers();
    renderUncDrawer();
  }

  /* — generic popover helper — */
  function openPopover(x, y, quote, section, uncId){
    closePopover();
    var pop = document.createElement("div");
    pop.className = "popover";
    pop.id = "activePopover";
    pop.style.left = Math.max(8, Math.min(x, window.innerWidth - 296)) + "px";
    pop.style.top = (y + window.scrollY) + "px";
    var quoteHtml = quote ? '<div class="pquote">«' + esc(quote) + '»</div>' : "";
    var existing = uncId ? (commentsByUnc()[uncId] || []) : [];
    var existingHtml = existing.length
      ? '<div class="pexisting"><div class="pexisting-title">Уже оставлено</div>' +
        existing.map(function(c){
          return '<div class="pex-item">' + esc(c.text) +
                 '<button class="pex-del" type="button" data-ts="' + esc(c.ts) + '">удалить</button></div>';
        }).join("") + '</div>'
      : "";
    pop.innerHTML = quoteHtml + existingHtml +
      '<textarea placeholder="' + (existing.length ? "Ответ или ещё один комментарий" : "Комментарий для доработки") +
      ' (Ctrl+Enter — сохранить)"></textarea>' +
      '<div class="prow"><button class="save">Сохранить</button><button class="cancel">Отмена</button></div>';
    document.body.appendChild(pop);
    pop.querySelectorAll(".pex-del").forEach(function(btn){
      btn.addEventListener("click", function(){
        var ts = btn.getAttribute("data-ts"), removed = false;
        // Снимаем ровно одну запись: две с одинаковой меткой времени до
        // миллисекунды практически невозможны, а если и случатся — они
        // неразличимы, и удалить первую совпавшую ровно то, что нужно.
        save(load().filter(function(c){
          if(!removed && c.ts === ts){ removed = true; return false; }
          return true;
        }));
        render();
        closePopover();
      });
    });
    var ta = pop.querySelector("textarea");
    ta.focus();
    ta.addEventListener("keydown", function(e){
      if((e.ctrlKey || e.metaKey) && e.key === "Enter"){
        e.preventDefault();
        pop.querySelector(".save").click();
      }
    });
    pop.querySelector(".save").addEventListener("click", function(){
      addComment(section, quote, ta.value, uncId);
      closePopover();
    });
    pop.querySelector(".cancel").addEventListener("click", closePopover);
  }
  function closePopover(){
    var old = document.getElementById("activePopover");
    if(old) old.remove();
  }
  document.addEventListener("mousedown", function(e){
    var pop = document.getElementById("activePopover");
    if(pop && !pop.contains(e.target) && !e.target.classList.contains("unc-dot")){
      closePopover();
    }
  });

  /* — blinking dot on every [УТОЧНИТЬ]-mark + left-drawer quick list — */
  function hashString(s){
    // djb2 — only needs to be stable and cheap, not cryptographic.
    var h = 5381;
    for(var i=0;i<s.length;i++){ h = ((h*33) ^ s.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  }

  var uncDrawerList = document.getElementById("uncList");
  var uncMarks = Array.prototype.slice.call(document.querySelectorAll("main mark.unc"));
  var uncMeta = [];
  var uncIdSeen = {};
  uncMarks.forEach(function(mark, i){
    var section = nearestSection(mark);
    var container = mark.closest("td") || mark.closest("p") || mark.parentElement;
    var fullText = (container ? container.textContent : mark.textContent).replace(/\s+/g," ").trim();
    var snip = fullText.length > 100 ? fullText.slice(0,100) + "…" : fullText;

    // Stable across regenerations of the same document: derived from where the
    // point is (section) and what it says (surrounding text), not DOM order —
    // positional "unc-N" ids shift whenever an earlier [УТОЧНИТЬ] is added or
    // removed, silently reattributing the localStorage "answered" status to a
    // different point on the next export.
    var baseId = "unc-" + hashString(section + "|" + fullText);
    uncIdSeen[baseId] = (uncIdSeen[baseId] || 0) + 1;
    mark.id = uncIdSeen[baseId] > 1 ? baseId + "-" + uncIdSeen[baseId] : baseId;

    var dot = document.createElement("button");
    dot.className = "unc-dot";
    dot.type = "button";
    dot.setAttribute("aria-label", "Комментарий к пункту: " + snip.slice(0, 60));
    mark.insertAdjacentElement("afterend", dot);

    var meta = { mark: mark, section: section, snip: snip, dot: dot };
    uncMeta.push(meta);

    dot.addEventListener("click", function(e){
      e.stopPropagation();
      hideHint();
      var r = dot.getBoundingClientRect();
      openPopover(r.left, r.bottom + 4, mark.textContent.trim(), section, mark.id);
    });
    dot.addEventListener("mouseenter", function(){ showHint(dot, mark.id); });
    dot.addEventListener("mouseleave", hideHint);
    dot.addEventListener("focus", function(){ showHint(dot, mark.id); });
    dot.addEventListener("blur", hideHint);
  });

  function hideHint(){
    var old = document.getElementById("activeHint");
    if(old) old.remove();
  }
  function showHint(dot, key){
    hideHint();
    var cs = commentsByUnc()[key] || [];
    var hint = document.createElement("div");
    hint.className = "unc-hint";
    hint.id = "activeHint";
    var was = closedByUnc()[key] || [];
    if(cs.length){
      hint.innerHTML = '<div class="unc-hint-title">Оставлено: ' + cs.length + ' — клик, чтобы ответить</div>' +
        cs.map(function(c){ return '<div class="unc-hint-item">' + esc(c.text) + '</div>'; }).join("");
    } else if(was.length){
      // Точка пережила доработку: прошлое замечание закрыто, но показать его
      // нужно — иначе PO пишет то же самое второй раз.
      hint.innerHTML = '<div class="unc-hint-title">Закрыто в прошлом круге — клик, чтобы дополнить</div>' +
        was.map(function(c){
          return '<div class="unc-hint-item closed">' + esc(c.text) +
                 '<span class="when">закрыто ' + fmtDate(c.closedAt) + '</span></div>';
        }).join("");
    } else {
      hint.innerHTML = '<div class="unc-hint-title">Комментария нет</div>' +
        '<div class="unc-hint-item">Клик — оставить комментарий к этому пункту.</div>';
    }
    document.body.appendChild(hint);
    var r = dot.getBoundingClientRect();
    hint.style.left = Math.max(8, Math.min(r.left - 6, window.innerWidth - 316)) + "px";
    hint.style.top = (r.bottom + window.scrollY + 6) + "px";
  }
  function paintDots(){
    var map = commentsByUnc();
    uncMeta.forEach(function(m){
      m.dot.classList.toggle("has-comment", !!(map[m.mark.id] || []).length);
    });
  }

  /* — комментарий, оставленный прямо в тексте — */

  // Точка, к которой относится выделение. Сначала — та, которую выделение
  // задело или внутри которой началось; иначе ближайшая в той же ячейке или
  // абзаце. Без этого комментарий «по красному гейту», сделанный через текст,
  // уходил в никуда: uncId пустой, точка оставалась красной, обход её не
  // засчитывал, и у самого места комментария не было видно.
  function markForRange(range, container){
    var direct = container.closest && container.closest("mark.unc");
    if(direct) return direct;
    if(range.intersectsNode){
      for(var i = 0; i < uncMeta.length; i++){
        try{ if(range.intersectsNode(uncMeta[i].mark)) return uncMeta[i].mark; }catch(e){}
      }
    }
    var host = container.closest("td, th, li, p, h2, h3");
    if(!host) return null;
    var inside = uncMeta.filter(function(m){ return host.contains(m.mark); });
    if(!inside.length) return null;
    if(inside.length === 1) return inside[0].mark;
    // Несколько точек в одной ячейке: берём геометрически ближайшую к выделению.
    var rect = range.getBoundingClientRect(), best = null, bestD = Infinity;
    inside.forEach(function(m){
      var r = m.mark.getBoundingClientRect();
      var d = Math.abs(r.top - rect.top) * 1000 + Math.abs(r.left - rect.left);
      if(d < bestD){ bestD = d; best = m.mark; }
    });
    return best;
  }

  // Комментарий не к точке [УТОЧНИТЬ] всё равно должен быть виден у своего
  // места. Ключ — хэш цитаты: он переживает перезагрузку, потому что не
  // зависит ни от порядка в DOM, ни от номера комментария.
  function looseKey(quote){ return "q-" + hashString(norm(quote)); }
  function norm(s){ return (s || "").replace(/\s+/g, " ").trim(); }

  function findQuoteHost(quote){
    var needle = norm(quote).replace(/…$/, "");
    if(needle.length < 3) return null;
    var els = Array.prototype.slice.call(
      document.querySelectorAll("main td, main th, main li, main p, main h2, main h3"));
    for(var i = 0; i < els.length; i++){
      if(norm(els[i].textContent).indexOf(needle) !== -1) return els[i];
    }
    // Выделение могло охватить несколько элементов — тогда цитата шире любого
    // из них; годится первый, чей текст целиком лежит внутри цитаты.
    for(var j = 0; j < els.length; j++){
      var txt = norm(els[j].textContent);
      if(txt.length > 10 && needle.indexOf(txt) !== -1) return els[j];
    }
    return null;
  }

  function paintLooseMarkers(){
    Array.prototype.slice.call(document.querySelectorAll(".loose-dot"))
      .forEach(function(d){ d.remove(); });
    var placed = {};
    openComments().forEach(function(c){
      if(!c.uncId || c.uncId.indexOf("q-") !== 0 || placed[c.uncId]) return;
      var host = findQuoteHost(c.quote);
      if(!host) return;
      placed[c.uncId] = true;
      var dot = document.createElement("button");
      dot.className = "unc-dot has-comment loose-dot";
      dot.type = "button";
      dot.setAttribute("aria-label", "Комментарий к этому фрагменту");
      host.appendChild(dot);
      var key = c.uncId, quote = c.quote, section = c.section;
      dot.addEventListener("click", function(e){
        e.stopPropagation();
        hideHint();
        var r = dot.getBoundingClientRect();
        openPopover(r.left, r.bottom + 4, quote, section, key);
      });
      dot.addEventListener("mouseenter", function(){ showHint(dot, key); });
      dot.addEventListener("mouseleave", hideHint);
      dot.addEventListener("focus", function(){ showHint(dot, key); });
      dot.addEventListener("blur", hideHint);
    });
  }

  function jumpAndComment(meta){
    meta.mark.scrollIntoView({ behavior:"smooth", block:"center" });
    meta.mark.classList.add("flash");
    setTimeout(function(){ meta.mark.classList.remove("flash"); }, 1600);
    var r = meta.mark.getBoundingClientRect();
    openPopover(Math.min(r.left, window.innerWidth - 296), r.bottom + 8, meta.mark.textContent.trim(), meta.section, meta.mark.id);
    closeDrawers();
  }

  function makeUncItem(meta, comments){
    var item = document.createElement("button");
    var answered = comments.length > 0;
    item.className = "unc-item" + (answered ? " answered" : "");
    item.type = "button";
    item.innerHTML = (answered ? '<span class="check">✓</span> ' : "") +
      '<span class="sec">' + esc(meta.section) + '</span>' +
      '<span class="snip">' + esc(meta.snip) + '</span>' +
      comments.map(function(c){ return '<span class="said">' + esc(c.text) + '</span>'; }).join("");
    item.addEventListener("click", function(){ jumpAndComment(meta); });
    return item;
  }

  // Закрытый пункт рисуется из сохранённых данных, а не из живой точки: после
  // доработки её в документе может уже не быть, а история обязана остаться.
  function makeClosedItem(c){
    var item = document.createElement("div");
    item.className = "unc-item closed";
    item.title = "Закрыто " + fmtDate(c.closedAt);
    item.innerHTML = '<span class="check">✓</span><span class="sec">' + esc(c.section) + '</span>' +
      '<span class="said">' + esc(c.text) + '</span>';
    return item;
  }

  function divider(text, cls){
    var d = document.createElement("div");
    d.className = "unc-divider" + (cls ? " " + cls : "");
    d.textContent = text;
    return d;
  }

  function renderUncDrawer(){
    var map = commentsByUnc();
    var pending = uncMeta.filter(function(m){ return !(map[m.mark.id] || []).length; });
    var done = uncMeta.filter(function(m){ return (map[m.mark.id] || []).length; });
    var closed = closedComments();

    document.getElementById("uncCount").textContent = pending.length + "/" + done.length;

    uncDrawerList.innerHTML = "";
    if(!pending.length && !done.length && !closed.length){
      uncDrawerList.innerHTML = '<p class="empty">Точек «УТОЧНИТЬ» нет.</p>';
      return;
    }
    pending.forEach(function(m){ uncDrawerList.appendChild(makeUncItem(m, [])); });
    if(done.length){
      uncDrawerList.appendChild(divider("Отвечено в этом круге"));
      done.forEach(function(m){ uncDrawerList.appendChild(makeUncItem(m, map[m.mark.id])); });
    }

    // История: по кругам правок, свежие сверху. Так видно, какая работа уже
    // проделана, и не приходится держать это в голове между итерациями.
    var groups = {};
    closed.forEach(function(c){
      var k = c.iteration || 0;
      (groups[k] = groups[k] || []).push(c);
    });
    Object.keys(groups).map(Number).sort(function(a, b){ return b - a; }).forEach(function(k){
      var items = groups[k];
      uncDrawerList.appendChild(divider(
        "Итерация " + k + " · закрыта " + fmtDate(items[0].closedAt), "iter-head"));
      items.forEach(function(c){ uncDrawerList.appendChild(makeClosedItem(c)); });
    });
  }
  renderUncDrawer();

  var uncDrawer = document.getElementById("uncDrawer");
  var navDrawer = document.getElementById("navDrawer");
  // Обе панели выезжают из левой кромки, поэтому открытой может быть только одна:
  // иначе вторая молча ложится поверх первой.
  function syncRail(){
    document.body.classList.toggle("drawer-open",
      uncDrawer.classList.contains("open") || navDrawer.classList.contains("open"));
  }
  function closeDrawers(){
    uncDrawer.classList.remove("open");
    navDrawer.classList.remove("open");
    syncRail();
  }
  function toggleDrawer(d){
    var wasOpen = d.classList.contains("open");
    closeDrawers();
    if(!wasOpen) d.classList.add("open");
    syncRail();
  }
  document.getElementById("uncToggle").addEventListener("click", function(){ toggleDrawer(uncDrawer); });
  document.getElementById("uncClose").addEventListener("click", closeDrawers);
  document.getElementById("navToggle").addEventListener("click", function(){ toggleDrawer(navDrawer); });
  document.getElementById("navClose").addEventListener("click", closeDrawers);
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){ closeDrawers(); closePopover(); hideHint(); }
  });

  /* — comment-by-selection: input appears immediately on mouseup — */
  document.addEventListener("mouseup", function(e){
    if(e.target.closest(".popover") || e.target.classList.contains("unc-dot") || e.target.closest(".drawer") || e.target.closest(".rail") || e.target.closest(".promptbox")) return;
    setTimeout(function(){
      var sel = window.getSelection();
      var text = sel && sel.toString().trim();
      if(!text || text.length < 2){ return; }
      var anchorNode = sel.anchorNode;
      var container = anchorNode && (anchorNode.nodeType === 1 ? anchorNode : anchorNode.parentElement);
      if(!container || !container.closest("main")) return;
      var range = sel.getRangeAt(0);
      var rect = range.getBoundingClientRect();
      var quote = text.length > 220 ? text.slice(0,220) + "…" : text;
      // Работа «прямо по тексту» — такой же проход по документу, как через
      // панель: комментарий обязан попасть в ту же точку [УТОЧНИТЬ], а не
      // повиснуть отдельно. Не попал ни в одну — получает свой ключ по цитате.
      var mark = markForRange(range, container);
      openPopover(rect.left, rect.bottom + 6, quote, nearestSection(container),
                  mark ? mark.id : looseKey(quote));
    }, 0);
  });

  /* — оглавление в левой панели: разделы и подразделы документа — */
  function buildToc(){
    var box = document.getElementById("tocList");
    var heads = document.querySelectorAll("main h2[id], main h3[id]");
    box.innerHTML = "";
    if(!heads.length){
      box.innerHTML = '<p class="empty">Заголовков в документе нет.</p>';
      return;
    }
    heads.forEach(function(h){
      var a = document.createElement("a");
      // Отступ у h3 кодирует реальную вложенность, а не украшает список.
      a.className = "toc-link toc-" + h.tagName.toLowerCase();
      a.href = "#" + h.id;
      a.textContent = h.textContent.trim();
      a.addEventListener("click", closeDrawers);
      box.appendChild(a);
    });
  }
  buildToc();

  render();
})();
</script>
