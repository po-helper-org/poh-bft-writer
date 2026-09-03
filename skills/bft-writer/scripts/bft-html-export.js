<script>
(function(){
  function run(){
    if(!window.mermaid){
      var host = document.querySelector("pre.mermaid");
      if(host) host.insertAdjacentHTML("beforebegin", '<p style="color:#e00000;font-family:\'Courier New\',monospace;font-size:.8rem">mermaid.js не загрузился (нет сети?) — ниже сырой код диаграммы.</p>');
      return;
    }
    mermaid.initialize({ startOnLoad:false, theme:"neutral", securityLevel:"loose" });
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

  function load(){
    try{ return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }catch(e){ return []; }
  }
  function save(list){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(list)); }catch(e){}
  }
  function esc(s){
    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  // Состояние точки — производное от комментариев, а не отдельный флаг: иначе
  // удалённый комментарий оставлял бы точку зелёной и «отвеченной» навсегда.
  function commentsByUnc(){
    var map = {};
    load().forEach(function(c){
      if(c.uncId){ (map[c.uncId] = map[c.uncId] || []).push(c); }
    });
    return map;
  }
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
    try{ navigator.clipboard.writeText(ta.value); }catch(e){ try{ document.execCommand("copy"); }catch(e2){} }
  });

  function buildPrompt(list){
    if(!list.length) return "";
    var lines = ["Доработай БФТ-документ " + DOC_NAME + " с учётом следующей обратной связи по разделам:", ""];
    list.forEach(function(item, i){
      var ref = item.quote ? (" (по фрагменту: «" + item.quote + "»)") : "";
      lines.push((i+1) + ". [" + item.section + "]" + ref + " " + item.text);
    });
    return lines.join("\n");
  }

  function render(){
    var list = load();
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
          var l = load();
          l.splice(idx, 1);
          save(l);
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
    dot.addEventListener("mouseenter", function(){ showHint(meta); });
    dot.addEventListener("mouseleave", hideHint);
    dot.addEventListener("focus", function(){ showHint(meta); });
    dot.addEventListener("blur", hideHint);
  });

  function hideHint(){
    var old = document.getElementById("activeHint");
    if(old) old.remove();
  }
  function showHint(meta){
    hideHint();
    var cs = commentsByUnc()[meta.mark.id] || [];
    var hint = document.createElement("div");
    hint.className = "unc-hint";
    hint.id = "activeHint";
    hint.innerHTML = cs.length
      ? '<div class="unc-hint-title">Оставлено: ' + cs.length + ' — клик, чтобы ответить</div>' +
        cs.map(function(c){ return '<div class="unc-hint-item">' + esc(c.text) + '</div>'; }).join("")
      : '<div class="unc-hint-title">Комментария нет</div>' +
        '<div class="unc-hint-item">Клик — оставить комментарий к этому пункту.</div>';
    document.body.appendChild(hint);
    var r = meta.dot.getBoundingClientRect();
    hint.style.left = Math.max(8, Math.min(r.left - 6, window.innerWidth - 316)) + "px";
    hint.style.top = (r.bottom + window.scrollY + 6) + "px";
  }
  function paintDots(){
    var map = commentsByUnc();
    uncMeta.forEach(function(m){
      m.dot.classList.toggle("has-comment", !!(map[m.mark.id] || []).length);
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

  function renderUncDrawer(){
    var map = commentsByUnc();
    var pending = uncMeta.filter(function(m){ return !(map[m.mark.id] || []).length; });
    var done = uncMeta.filter(function(m){ return (map[m.mark.id] || []).length; });

    document.getElementById("uncCount").textContent = pending.length + "/" + done.length;

    uncDrawerList.innerHTML = "";
    if(!pending.length && !done.length){
      uncDrawerList.innerHTML = '<p class="empty">Точек «УТОЧНИТЬ» нет.</p>';
      return;
    }
    pending.forEach(function(m){ uncDrawerList.appendChild(makeUncItem(m, [])); });
    if(done.length){
      var div = document.createElement("div");
      div.className = "unc-divider";
      div.textContent = "Отвечено";
      uncDrawerList.appendChild(div);
      done.forEach(function(m){ uncDrawerList.appendChild(makeUncItem(m, map[m.mark.id])); });
    }
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
      openPopover(rect.left, rect.bottom + 6, quote, nearestSection(container));
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
