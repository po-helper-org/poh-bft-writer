/**
 * Единый стиль страницы полного БФТ в портале (ADR-0029): «Комментарии»,
 * подсказки и поповеры у пометок, колонка «ИИ-агент» и вкладки рейки — в одном
 * каркасе с боковыми панелями «Вопросы» и «Планирование» (form-page.ts):
 * шрифт 14/20, шапка 16/24, отступы 4/8/12/16, радиус 8, тонкие линии.
 * Слой подключается последним и только переопределяет оформление — поведение
 * экспорта навыка, агента и публикации не трогает. Плюс раскладка: колонка
 * агента на широком экране сдвигает документ, на узком открыта одна панель.
 */

const THEME_STYLE = `<style id="bft-page-theme">
:root{ --sb-font:system-ui,-apple-system,"Segoe UI",sans-serif; --ag-w:min(360px,100vw); }

/* Рейка: все вкладки одного вида; открытая — светлая с обводкой; у «Вопросов» — красная метка. */
nav.cs-rail .cs-rail-tab{ background:var(--fg); color:var(--bg); font:500 12px/16px var(--sb-font); letter-spacing:.02em; padding:12px 6px;
  border-radius:8px 0 0 8px; transition:background-color .3s cubic-bezier(.22,1,.36,1), color .3s cubic-bezier(.22,1,.36,1); }
nav.cs-rail .cs-rail-tab:visited{ color:var(--bg); }
nav.cs-rail .cs-rail-tab:hover{ opacity:.88; }
nav.cs-rail .cs-rail-tab[aria-expanded="true"]{ background:var(--bg); color:var(--fg); box-shadow:inset 0 0 0 1px var(--fg); opacity:1; }
nav.cs-rail .cs-rail-tab.q{ box-shadow:inset 3px 0 0 #e00000; }
nav.cs-rail .cs-rail-tab.q[aria-expanded="true"]{ box-shadow:inset 0 0 0 1px var(--fg), inset 3px 0 0 #e00000; }
nav.cs-rail .cs-rail-tab:focus-visible{ outline:2px solid var(--fg); outline-offset:2px; }

/* «Комментарии»: пилюля в углу и карточка-панель. */
.promptbox{ top:12px; right:16px; gap:8px; font:400 14px/20px var(--sb-font); }
.promptbox > #panelToggle{ height:36px; padding:0 14px; border:1px solid var(--line-soft); border-radius:18px; background:var(--bg); color:var(--fg);
  box-shadow:0 2px 10px rgba(0,0,0,.08); font:500 14px/20px var(--sb-font); cursor:pointer; }
.promptbox > #panelToggle:hover{ border-color:var(--fg); }
.promptbox .panel{ width:360px; max-width:calc(100vw - 32px); padding:0; border:1px solid var(--line-soft); border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.12); }
.promptbox .panel h4{ margin:0; padding:12px 16px; border-bottom:1px solid var(--line-soft); font:500 16px/24px var(--sb-font); text-transform:none; letter-spacing:0; }
.promptbox #itemsList{ padding:4px 16px 8px; }
.promptbox .panel .item{ padding:8px 0; font-size:14px; }
.promptbox .panel .item .where{ font-size:12px; line-height:16px; }
.promptbox .panel .item button{ font:400 12px/16px var(--sb-font); }
.promptbox .panel .empty{ margin:8px 0; font-style:normal; color:var(--muted); }
.promptbox .panel .copybtn{ display:block; width:calc(100% - 32px); margin:0 16px 8px !important; padding:8px 12px; border:1px solid var(--fg); border-radius:8px;
  background:var(--fg); color:var(--bg); font:600 14px/20px var(--sb-font); cursor:pointer; }
.promptbox .panel #copyBtn{ margin-bottom:16px !important; border-color:var(--line-soft); background:transparent; color:var(--fg); }
.promptbox .panel #copyBtn:hover{ border-color:var(--fg); }
.promptbox .panel .copybtn:only-of-type{ margin-bottom:16px !important; }

/* Подсказка и поповер у пометок и выделения. */
.unc-hint{ padding:8px 12px; border-radius:8px; font:400 13px/18px var(--sb-font); box-shadow:0 8px 24px rgba(0,0,0,.18); }
.unc-hint-title{ text-transform:none; letter-spacing:0; font-size:12px; }
.unc-hint-item .when{ font-size:12px; }
.popover{ width:300px; padding:12px; border:1px solid var(--line-soft); border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.12); font:400 14px/20px var(--sb-font); }
.popover .pquote{ font-size:12px; line-height:16px; }
.popover textarea{ font:400 14px/20px var(--sb-font); padding:8px; border-radius:8px; }
.popover .prow{ gap:8px; margin-top:8px; }
.popover button{ padding:6px 12px; border-radius:8px; font:600 13px/18px var(--sb-font); }
.popover button.cancel{ border-color:var(--line-soft); }
.popover .pexisting-title{ text-transform:none; letter-spacing:0; font-size:12px; }
.popover .pex-del{ font:400 12px/16px var(--sb-font); }

/* Колонка «ИИ-агент» — каркас боковой панели: те же цвета, шапка, подвал и кнопки. */
#bftAgentBtn,#bftAgent,#bftAgentFresh,#agReviewTip{ --ag-fg:var(--fg); --ag-bg:var(--bg); --ag-line:var(--line-soft); --ag-mute:var(--muted); --ag-soft:var(--mark);
  font:400 14px/20px var(--sb-font); }
#bftAgentBtn{ height:36px; padding:0 14px; border-radius:18px; font-weight:500; }
#bftAgentBtn:hover{ border-color:var(--fg); }
#bftAgent{ width:var(--ag-w); }
#bftAgent header{ height:auto; padding:12px 8px 12px 16px; border-bottom:0; font:500 16px/24px var(--sb-font); }
#bftAgent header button{ width:32px; height:32px; border-radius:8px; font-size:20px; }
#bftAgent header button:hover,#bftAgent header a:hover{ background:var(--mark); color:var(--fg); }
#bftAgent header a{ height:32px; border-radius:8px; font-size:12px; }
#bftAgent .ag-body{ padding:8px 16px 16px; border-top:1px solid var(--line-soft); }
#agList:empty::before{ content:"Выделите текст в документе и оставьте замечание — или напишите ниже, что поправить. Агент внесёт правку и покажет итог здесь.";
  display:block; padding:8px 0; color:var(--muted); }
#bftAgent .ag-top,#bftAgent .ag-txt small,#bftAgent .ag-link,#bftAgent .ag-err,#bftAgent .ag-note,#bftAgent .ag-msg{ font-size:12px; line-height:16px; }
#bftAgent footer{ padding:12px 16px 16px; }
#bftAgent .ag-pend,#bftAgent .ag-review{ border-radius:8px; padding:8px 8px 8px 12px; }
#bftAgent .ag-btn,#agReviewTip .ag-btn,#agReviewTip .ag-ghost{ height:32px; padding:0 12px; border-radius:8px; font-weight:600; }
#bftAgent .ag-compose{ padding:8px 8px 8px 12px; border-radius:8px; }
#bftAgent .ag-compose:focus-within{ border-color:var(--fg); }
#bftAgent .ag-send{ width:32px; height:32px; }
#agReviewTip{ border-radius:12px; padding:16px; }
#bftAgentFresh{ height:36px; border-radius:18px; }
#bftAgentFresh button{ height:28px; border-radius:14px; }

/* Раскладка: открытая колонка агента на широком экране сдвигает документ и «Комментарии». */
@media (min-width:1180px){
  body.cs-ag-open{ padding-right:var(--ag-w); }
  body.cs-ag-open .promptbox{ right:calc(var(--ag-w) + 16px); }
}
@media print{ body.cs-ag-open{ padding-right:0; } }
</style>`

/** Состояние колонки агента — классом на body; на узком экране открыта одна панель: слева или агент. */
const THEME_SCRIPT = `<script id="bft-page-theme-js">(function(){
function run(){
  var ag=document.getElementById("bftAgent"); if(!ag) return;
  var narrow=function(){ return window.innerWidth<1180; };
  var wasAg=ag.classList.contains("open"), wasSide=document.body.classList.contains("cs-sb-open");
  function sync(){
    var isAg=ag.classList.contains("open"), isSide=document.body.classList.contains("cs-sb-open");
    if(document.body.classList.contains("cs-ag-open")!==isAg) document.body.classList.toggle("cs-ag-open", isAg);
    if(narrow()){
      if(isAg && !wasAg && isSide && window.csPanel) window.csPanel("");
      else if(isSide && !wasSide && isAg){ var x=document.getElementById("agClose"); if(x) x.click(); }
    }
    wasAg=ag.classList.contains("open"); wasSide=document.body.classList.contains("cs-sb-open");
  }
  new MutationObserver(sync).observe(ag,{ attributes:true, attributeFilter:["class"] });
  new MutationObserver(sync).observe(document.body,{ attributes:true, attributeFilter:["class"] });
  sync();
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", run); else run();
})();</script>`

/** Слой стиля — в самый конец страницы, после всех слоёв (форма, планирование, агент, публикация). */
export function withPageTheme(page: string): string {
  const html = THEME_STYLE + THEME_SCRIPT
  const at = page.lastIndexOf('</body>')
  return at < 0 ? page + html : page.slice(0, at) + html + page.slice(at)
}
