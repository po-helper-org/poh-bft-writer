/* Поверхность встречи: опросник по одному вопросу на экран, материалы в боковых панелях.
 *
 * Ответы живут в localStorage браузера, не в файле: они превращаются в промт и уходят в
 * чат, а не остаются частью артефакта. Ключ ответа — хэш текста вопроса (его считает
 * экспортёр), поэтому пересборка скрипта после правки документа не сдвигает уже данные
 * ответы на соседний вопрос.
 */
(function () {
  "use strict";

  var DATA = __DATA_JSON__;
  var STORE_KEY = __STORE_KEY_JSON__;

  // Приватный режим и запрет на данные сайта роняют сам доступ к хранилищу, а не только
  // чтение: без try страница осталась бы пустой вместо рабочей формы.
  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      /* нет места или доступа — встреча продолжается, промт соберётся из состояния в памяти */
    }
  }

  var state = load();
  var cards = Array.prototype.slice.call(document.querySelectorAll(".q"));
  var byId = {};
  cards.forEach(function (card) { byId[card.dataset.qid] = card; });

  var order = cards.slice();
  var cursor = 0;

  function entry(id) {
    if (!state[id]) state[id] = { answer: "", who: "", skipped: false };
    return state[id];
  }
  function answered(id) { return ((state[id] || {}).answer || "").trim() !== ""; }
  function skipped(id) { return !!(state[id] || {}).skipped; }
  function done(id) { return answered(id) || skipped(id); }

  /* ---------- навигация ---------- */

  function render() {
    cards.forEach(function (card) { card.hidden = true; });
    var finish = document.getElementById("finish");
    var atEnd = cursor >= order.length;
    finish.hidden = !atEnd;

    if (!atEnd && order.length) {
      var card = order[cursor];
      card.hidden = false;
      var box = card.querySelector("textarea.answer");
      // Фокус в поле ответа сразу: на встрече печатают, не целятся мышью.
      window.setTimeout(function () { box.focus({ preventScroll: true }); }, 0);
    }

    var doneCount = order.filter(function (c) { return done(c.dataset.qid); }).length;
    document.getElementById("navDone").textContent = String(doneCount);
    document.getElementById("navTotal").textContent = String(order.length);

    var share = order.length ? (atEnd ? 1 : cursor / order.length) : 0;
    document.getElementById("barFill").style.width = (share * 100).toFixed(1) + "%";

    document.getElementById("prevBtn").disabled = cursor === 0;
    document.getElementById("nextBtn").disabled = atEnd;
    document.getElementById("skipBtn").disabled = atEnd;
    document.getElementById("skipBtn").textContent =
      !atEnd && order.length && skipped(order[cursor].dataset.qid) ? "Вернуть" : "Пропустить";

    Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (item, i) {
      var id = item.dataset.qid;
      item.dataset.state = answered(id) ? "answered" : (skipped(id) ? "skipped" : "open");
      item.setAttribute("aria-current", !atEnd && i === cursor ? "true" : "false");
    });

    if (atEnd) {
      document.getElementById("finishText").textContent =
        "Отвечено " + doneCount + " из " + order.length + ".";
      document.getElementById("promptOut").value = buildPrompt();
    }
  }

  function step(delta) {
    cursor = Math.max(0, Math.min(order.length, cursor + delta));
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function jump(qid) {
    var at = order.findIndex(function (c) { return c.dataset.qid === qid; });
    if (at < 0) return;
    cursor = at;
    render();
  }

  cards.forEach(function (card) {
    var id = card.dataset.qid;
    var rec = entry(id);
    var box = card.querySelector("textarea.answer");
    var who = card.querySelector("input.who");

    box.value = rec.answer || "";
    who.value = rec.who || "";
    // Адресат вопроса — разумная заготовка «кто ответил»: на встрече её правят, когда
    // отвечает не тот, кому вопрос был адресован.
    if (!who.value && card.dataset.whom && card.dataset.whom.indexOf("[") !== 0) {
      who.placeholder = card.dataset.whom;
    }

    box.addEventListener("input", function () {
      var r = entry(id);
      r.answer = box.value;
      if (box.value.trim()) r.skipped = false;
      save();
      render();
    });
    who.addEventListener("input", function () { entry(id).who = who.value; save(); });
  });

  document.getElementById("prevBtn").addEventListener("click", function () { step(-1); });
  document.getElementById("nextBtn").addEventListener("click", function () { step(1); });
  document.getElementById("skipBtn").addEventListener("click", function () {
    if (cursor >= order.length) return;
    var id = order[cursor].dataset.qid;
    var rec = entry(id);
    rec.skipped = !rec.skipped;
    save();
    if (rec.skipped) step(1); else render();
  });
  document.getElementById("finishBack").addEventListener("click", function () { step(-1); });
  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); step(1); }
    if (event.altKey && event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
    if (event.key === "Escape") { closeDrawers(); setNav(false); }
  });

  /* ---------- панели ---------- */

  function closeDrawers() {
    Array.prototype.forEach.call(document.querySelectorAll(".drawer"), function (d) { d.hidden = true; });
    Array.prototype.forEach.call(document.querySelectorAll(".rail-tab"), function (b) {
      b.setAttribute("aria-expanded", "false");
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".rail-tab"), function (tab) {
    tab.setAttribute("aria-expanded", "false");
    tab.addEventListener("click", function () {
      var drawer = document.getElementById("drawer-" + tab.dataset.drawer);
      var opening = drawer.hidden;
      closeDrawers();
      if (!opening) return;
      drawer.hidden = false;
      tab.setAttribute("aria-expanded", "true");
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (btn) {
    btn.addEventListener("click", closeDrawers);
  });

  Array.prototype.forEach.call(document.querySelectorAll(".pane-tabs button"), function (tab) {
    tab.addEventListener("click", function () {
      var strip = tab.parentElement;
      Array.prototype.forEach.call(strip.children, function (b) {
        b.setAttribute("aria-pressed", b === tab ? "true" : "false");
      });
      var body = strip.parentElement.querySelector(".drawer-body");
      Array.prototype.forEach.call(body.children, function (pane) {
        pane.hidden = pane.dataset.pane !== tab.dataset.pane;
      });
    });
  });

  /* ---------- правая панель навигации ---------- */

  var navPanel = document.getElementById("navPanel");
  var navToggle = document.getElementById("navToggle");
  function setNav(open) {
    navPanel.hidden = !open;
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
  }
  navToggle.addEventListener("click", function () { setNav(navPanel.hidden); });
  document.getElementById("navClose").addEventListener("click", function () { setNav(false); });
  Array.prototype.forEach.call(document.querySelectorAll(".nav-item"), function (item) {
    item.addEventListener("click", function () { jump(item.dataset.qid); });
  });

  /* ---------- письмо участникам ---------- */

  function copyFrom(field, button, label) {
    field.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    if (!ok && navigator.clipboard) {
      navigator.clipboard.writeText(field.value).then(function () { button.textContent = "Скопировано"; });
      return;
    }
    button.textContent = ok ? "Скопировано" : "Выделено — Ctrl+C";
    window.setTimeout(function () { button.textContent = label; }, 2000);
  }

  var agendaText = document.getElementById("agendaText");
  var agendaCopy = document.getElementById("agendaCopy");
  agendaCopy.addEventListener("click", function () { copyFrom(agendaText, agendaCopy, "Скопировать"); });
  document.getElementById("agendaMail").addEventListener("click", function () {
    // Первая строка письма — тема: она уходит в subject, остальное в тело. Адресов у
    // страницы нет (в personas.csv их не бывает), поэтому «Кому» заполняет PO в почте.
    var lines = agendaText.value.split("\n");
    var subject = lines[0].replace(/^Тема:\s*/, "");
    var body = lines.slice(1).join("\n").replace(/^\n+/, "");
    window.location.href = "mailto:?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);
  });

  /* ---------- результат встречи ---------- */

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
    var answers = DATA.questions.filter(function (q) { return answered(q.id); });
    var lines = [];
    lines.push("Внеси в " + (DATA.source || DATA.epic + "-fast.md") +
               " результаты CustDev-интервью" + (DATA.prepared ? " по скрипту от " + DATA.prepared : "") + ".");
    lines.push("");
    if (!answers.length) {
      lines.push("Ответов пока нет: на встрече ничего не записано.");
      return lines.join("\n");
    }
    lines.push("Ответы:");
    answers.forEach(function (q, i) {
      var rec = state[q.id];
      var who = (rec.who || "").trim() || q.whom || "участник";
      lines.push((i + 1) + ". [" + label(q) + "] " + q.text);
      lines.push("   → «" + rec.answer.trim() + "» (" + who + ")");
    });

    var left = DATA.questions.filter(function (q) { return !done(q.id); });
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
      lines.push("| " + q.n + " | " + label(q) + " | " + q.text.replace(/\|/g, "\\|") +
                 " | " + answer.replace(/\|/g, "\\|").replace(/\n/g, " ") + " | " + (rec.who || "").trim() + " |");
    });
    return lines.join("\n");
  }

  var promptOut = document.getElementById("promptOut");
  var copyBtn = document.getElementById("copyBtn");
  copyBtn.addEventListener("click", function () {
    promptOut.value = buildPrompt();
    copyFrom(promptOut, copyBtn, "Скопировать промт");
  });
  document.getElementById("downloadBtn").addEventListener("click", function () {
    var blob = new Blob([buildAnswersFile()], { type: "text/markdown;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = DATA.epic + "-custdev-answers.md";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  render();
})();
