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
  var ANSWERED_KEY = STORE_KEY + "-answered";
  var DOC_NAME = __DOC_NAME_JSON__;

  function load(){
    try{ return JSON.parse(localStorage.getItem(STORE_KEY) || "[]"); }catch(e){ return []; }
  }
  function save(list){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(list)); }catch(e){}
  }
  function loadAnswered(){
    try{ return JSON.parse(localStorage.getItem(ANSWERED_KEY) || "[]"); }catch(e){ return []; }
  }
  function saveAnswered(list){
    try{ localStorage.setItem(ANSWERED_KEY, JSON.stringify(list)); }catch(e){}
  }
  function markAnswered(uncId){
    if(!uncId) return;
    var a = loadAnswered();
    if(a.indexOf(uncId) === -1){ a.push(uncId); saveAnswered(a); }
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
    markAnswered(uncId);
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
    var quoteHtml = quote ? '<div class="pquote">«' + quote.replace(/</g,"&lt;") + '»</div>' : "";
    pop.innerHTML = quoteHtml +
      '<textarea placeholder="Комментарий для доработки (Ctrl+Enter — сохранить)"></textarea>' +
      '<div class="prow"><button class="save">Сохранить</button><button class="cancel">Отмена</button></div>';
    document.body.appendChild(pop);
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

    uncMeta.push({ mark: mark, section: section, snip: snip });

    var dot = document.createElement("button");
    dot.className = "unc-dot";
    dot.title = "Оставить комментарий к этому пункту";
    dot.type = "button";
    mark.insertAdjacentElement("afterend", dot);
    dot.addEventListener("click", function(e){
      e.stopPropagation();
      var r = dot.getBoundingClientRect();
      openPopover(r.left, r.bottom + 4, mark.textContent.trim(), section, mark.id);
    });
  });

  function jumpAndComment(meta){
    meta.mark.scrollIntoView({ behavior:"smooth", block:"center" });
    meta.mark.classList.add("flash");
    setTimeout(function(){ meta.mark.classList.remove("flash"); }, 1600);
    var r = meta.mark.getBoundingClientRect();
    openPopover(Math.min(r.left, window.innerWidth - 296), r.bottom + 8, meta.mark.textContent.trim(), meta.section, meta.mark.id);
    document.getElementById("uncDrawer").classList.remove("open");
  }

  function makeUncItem(meta, answered){
    var item = document.createElement("button");
    item.className = "unc-item" + (answered ? " answered" : "");
    item.type = "button";
    item.innerHTML = (answered ? '<span class="check">✓</span> ' : "") +
      '<span class="sec">' + meta.section + '</span><span class="snip">' + meta.snip.replace(/</g,"&lt;") + '</span>';
    item.addEventListener("click", function(){ jumpAndComment(meta); });
    return item;
  }

  function renderUncDrawer(){
    var answeredIds = loadAnswered();
    var pending = uncMeta.filter(function(m){ return answeredIds.indexOf(m.mark.id) === -1; });
    var done = uncMeta.filter(function(m){ return answeredIds.indexOf(m.mark.id) !== -1; });

    document.getElementById("uncCount").textContent = pending.length + "/" + done.length;

    uncDrawerList.innerHTML = "";
    if(!pending.length && !done.length){
      uncDrawerList.innerHTML = '<p class="empty">Точек «УТОЧНИТЬ» нет.</p>';
      return;
    }
    pending.forEach(function(m){ uncDrawerList.appendChild(makeUncItem(m, false)); });
    if(done.length){
      var div = document.createElement("div");
      div.className = "unc-divider";
      div.textContent = "Отвечено";
      uncDrawerList.appendChild(div);
      done.forEach(function(m){ uncDrawerList.appendChild(makeUncItem(m, true)); });
    }
  }
  renderUncDrawer();

  var uncDrawer = document.getElementById("uncDrawer");
  document.getElementById("uncToggle").addEventListener("click", function(){
    uncDrawer.classList.toggle("open");
  });
  document.getElementById("uncClose").addEventListener("click", function(){
    uncDrawer.classList.remove("open");
  });

  /* — comment-by-selection: input appears immediately on mouseup — */
  document.addEventListener("mouseup", function(e){
    if(e.target.closest(".popover") || e.target.classList.contains("unc-dot") || e.target.closest(".unc-drawer") || e.target.closest(".promptbox")) return;
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

  /* — TOC built from real h2 headings in main — */
  function buildToc(){
    var box = document.getElementById("tocList");
    var heads = document.querySelectorAll("main h2[id]");
    heads.forEach(function(h){
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent.trim();
      box.appendChild(a);
    });
  }
  buildToc();

  render();
})();
</script>
