/* Поверхность встречи: ответы, фильтр по участнику, прогресс, сборка промта.
 *
 * Ответы живут в localStorage браузера, не в файле: они превращаются в промт и
 * уходят в чат, а не остаются частью артефакта. Ключ ответа — хэш текста
 * вопроса (его считает экспортёр), поэтому пересборка скрипта после правки
 * документа не сдвигает уже данные ответы на соседний вопрос.
 */
(function () {
  "use strict";

  var DATA = __DATA_JSON__;
  var STORE_KEY = __STORE_KEY_JSON__;

  // Приватный режим и запрет на данные сайта роняют сам доступ к хранилищу, а не
  // только чтение: без try страница осталась бы пустой вместо рабочей формы.
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function save(state) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* нет места или доступа — встреча продолжается, промт соберётся из DOM */
    }
  }

  var state = load();
  var byId = {};
  DATA.questions.forEach(function (q) { byId[q.id] = q; });

  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  var doneCount = document.getElementById("doneCount");
  var totalCount = document.getElementById("totalCount");

  function entry(id) {
    if (!state[id]) state[id] = { answer: "", who: "", skipped: false };
    return state[id];
  }

  function isDone(rec) {
    return !!(rec && (rec.skipped || (rec.answer || "").trim()));
  }

  function paint(card) {
    var id = card.dataset.qid;
    var rec = state[id] || {};
    var answered = !!(rec.answer || "").trim();
    card.classList.toggle("answered", answered);
    card.classList.toggle("skipped", !!rec.skipped && !answered);
    var skip = card.querySelector(".skip");
    skip.setAttribute("aria-pressed", rec.skipped ? "true" : "false");
    var stateEl = card.querySelector(".state");
    stateEl.textContent = answered ? "отвечено" : (rec.skipped ? "не относится" : "");
  }

  function refreshProgress() {
    var visible = cards.filter(function (c) { return !c.hidden; });
    var done = visible.filter(function (c) { return isDone(state[c.dataset.qid]); });
    doneCount.textContent = String(done.length);
    totalCount.textContent = String(visible.length);
  }

  cards.forEach(function (card) {
    var id = card.dataset.qid;
    var rec = entry(id);
    var answer = card.querySelector(".answer");
    var who = card.querySelector(".who");
    var skip = card.querySelector(".skip");

    answer.value = rec.answer || "";
    who.value = rec.who || "";
    // Адресат вопроса — разумная заготовка «кто ответил»: на встрече её правят,
    // когда отвечает не тот, кому вопрос был адресован.
    if (!who.value && card.dataset.whom && card.dataset.whom.indexOf("[") !== 0) {
      who.placeholder = card.dataset.whom;
    }

    answer.addEventListener("input", function () {
      entry(id).answer = answer.value;
      if (answer.value.trim()) entry(id).skipped = false;
      save(state);
      paint(card);
      refreshProgress();
    });
    who.addEventListener("input", function () {
      entry(id).who = who.value;
      save(state);
    });
    skip.addEventListener("click", function () {
      var rec2 = entry(id);
      rec2.skipped = !rec2.skipped;
      save(state);
      paint(card);
      refreshProgress();
    });

    paint(card);
  });

  /* --- фильтр по участнику --- */
  var filters = document.getElementById("filters");
  var people = ["Все"].concat(DATA.participants.filter(function (p) {
    return p && p.indexOf("[") !== 0;
  }));
  var active = "Все";

  function applyFilter() {
    cards.forEach(function (card) {
      card.hidden = active !== "Все" && card.dataset.whom !== active;
    });
    refreshProgress();
  }

  people.forEach(function (name) {
    var b = document.createElement("button");
    b.className = "chip";
    b.type = "button";
    b.textContent = name;
    b.setAttribute("aria-pressed", name === active ? "true" : "false");
    b.addEventListener("click", function () {
      active = name;
      Array.prototype.forEach.call(filters.children, function (el) {
        el.setAttribute("aria-pressed", el === b ? "true" : "false");
      });
      applyFilter();
    });
    filters.appendChild(b);
  });

  /* --- панели --- */
  function wireDrawer(btnId, drawerId, closeId, onOpen) {
    var btn = document.getElementById(btnId);
    var drawer = document.getElementById(drawerId);
    var close = document.getElementById(closeId);
    if (!btn || !drawer) return;
    btn.addEventListener("click", function () {
      var opening = !drawer.classList.contains("open");
      Array.prototype.forEach.call(document.querySelectorAll(".drawer.open"), function (d) {
        d.classList.remove("open");
      });
      if (opening) {
        drawer.classList.add("open");
        if (onOpen) onOpen();
      }
    });
    if (close) close.addEventListener("click", function () { drawer.classList.remove("open"); });
  }

  /* --- сборка результата --- */
  function collected() {
    return DATA.questions
      .map(function (q) { return { q: q, rec: state[q.id] || {} }; })
      .filter(function (item) { return (item.rec.answer || "").trim(); });
  }

  function unanswered() {
    return DATA.questions.filter(function (q) {
      var rec = state[q.id] || {};
      return !(rec.answer || "").trim() && !rec.skipped;
    });
  }

  function plural(n, one, few, many) {
    var mod100 = n % 100, mod10 = n % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function label(q) {
    var parts = [q.stage];
    if (q.tag) parts.push(q.tag);
    return parts.join(" · ");
  }

  function buildPrompt() {
    var answers = collected();
    var lines = [];
    lines.push("Внеси в " + (DATA.source || DATA.epic + "-fast.md") +
               " результаты CustDev-интервью" + (DATA.prepared ? " по скрипту от " + DATA.prepared : "") + ".");
    lines.push("");
    if (!answers.length) {
      lines.push("Ответов пока нет: на встрече ничего не записано.");
      return lines.join("\n");
    }
    lines.push("Ответы:");
    answers.forEach(function (item, i) {
      var who = (item.rec.who || "").trim() || item.q.whom || "участник";
      lines.push((i + 1) + ". [" + label(item.q) + "] " + item.q.text);
      lines.push("   → «" + item.rec.answer.trim() + "» (" + who + ")");
    });
    var left = unanswered();
    if (left.length) {
      lines.push("");
      // Перечислять поимённо все непройденные вопросы бессмысленно: следующему прогону
      // важны непроверенные гипотезы (за каждой стоит пробел документа), а хвост
      // основного скрипта достаточно посчитать.
      var hyps = [], script = 0;
      left.forEach(function (q) {
        if (q.hyp) hyps.push(q.stage.replace("Дополнительная гипотеза ", ""));
        else script += 1;
      });
      var parts = [];
      if (hyps.length) parts.push("гипотезы " + hyps.join(", "));
      if (script) parts.push(script + " " + plural(script, "вопрос", "вопроса", "вопросов") + " основного скрипта");
      lines.push("Не проверено, до этого не дошли: " + parts.join("; ") + ".");
    }
    lines.push("");
    lines.push("Правила: ответ участника — цитата-источник требования; закрывай [УТОЧНИТЬ] только тем,");
    lines.push("что прозвучало; опровергнутую гипотезу не правь молча, вынеси вопросом в чат.");
    lines.push("Приложи транскрибацию встречи отдельно — по странице не видно того, что сказали помимо вопросов.");
    return lines.join("\n");
  }

  function buildAnswersFile() {
    var lines = [];
    lines.push("# Ответы CustDev-интервью: " + DATA.epic);
    lines.push("");
    lines.push("Скрипт: `" + DATA.doc + "`. Заполнено на встрече, архив разговора.");
    lines.push("");
    lines.push("## Профиль персоны");
    lines.push("");
    lines.push("| Критерий | Что выяснили |");
    lines.push("|---|---|");
    ["Общая характеристика", "Контекстное поведение", "Ценности и цели", "Боли и трудности"]
      .forEach(function (c) { lines.push("| " + c + " | |"); });
    lines.push("");
    lines.push("## Ответы");
    lines.push("");
    lines.push("| # | Этап | Вопрос | Ответ | Кто ответил |");
    lines.push("|---|---|---|---|---|");
    DATA.questions.forEach(function (q) {
      var rec = state[q.id] || {};
      var answer = (rec.answer || "").trim() || (rec.skipped ? "не относится" : "");
      var who = (rec.who || "").trim();
      lines.push("| " + q.n + " | " + label(q) + " | " + q.text.replace(/\|/g, "\\|") +
                 " | " + answer.replace(/\|/g, "\\|").replace(/\n/g, " ") + " | " + who + " |");
    });
    return lines.join("\n");
  }

  var promptOut = document.getElementById("promptOut");
  wireDrawer("triggerBtn", "triggerDrawer", "triggerClose");
  wireDrawer("exportBtn", "exportDrawer", "exportClose", function () {
    promptOut.value = buildPrompt();
  });

  var copyBtn = document.getElementById("copyBtn");
  copyBtn.addEventListener("click", function () {
    promptOut.value = buildPrompt();
    promptOut.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {
      ok = false;
    }
    if (!ok && navigator.clipboard) {
      navigator.clipboard.writeText(promptOut.value).then(function () {
        copyBtn.textContent = "Скопировано";
      });
      return;
    }
    copyBtn.textContent = ok ? "Скопировано" : "Выделено — Ctrl+C";
    setTimeout(function () { copyBtn.textContent = "Скопировать промт"; }, 2000);
  });

  document.getElementById("downloadBtn").addEventListener("click", function () {
    var blob = new Blob([buildAnswersFile()], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = DATA.epic + "-custdev-answers.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  applyFilter();
  refreshProgress();
})();
