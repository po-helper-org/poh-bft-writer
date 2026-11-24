/**
 * «Ответы формы → входящее событие в БФТ» (ADR-0027): отправка формы вопросов — входящее
 * событие заявки. Что пришло и что с пересборкой — из процесса заявки в Temporal (query
 * `inbox`, ADR-0022); тексты ответов — из файла формы (одна отправка — ответы с одним `at`).
 *
 * Здесь — сводка для страницы документа (чистая, тестируется) и раздел «Входящие» сайдбара
 * вопросов: список, ответы по клику, оповещение «Форма заполнена» без перезагрузки (опрос).
 */
import { submissionsOf, type BftForm, type Submission } from './forms.js'
import type { InboxEntry, InboxRebuildState } from './lifecycle.js'

export type InboxStatus = InboxRebuildState | 'unknown'

export interface InboxItem {
  id: string
  at: string
  /** Подпись респондента; нет — не назвался (страница так и пишет). */
  author?: string
  /** Адресаты вопросов отправки — разделы «Для: …» формы. */
  addressees: string[]
  saved: number
  unknown: number
  rebuild: { state: InboxStatus; label: string; dueAt?: string; at?: string; reason?: string }
  items: Submission['items']
}

export interface InboxView {
  /** Процесс заявки ответил: статусы пересборки — из него. */
  cycle: boolean
  /** Новые сверху. */
  items: InboxItem[]
}

const hm = (iso?: string) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) } catch { return iso.slice(0, 16) }
}

export function rebuildLabel(r: { state: InboxStatus; dueAt?: string; at?: string; reason?: string }, cycle: boolean): string {
  switch (r.state) {
    case 'waiting': return `Ждёт паузу — пересборка ${r.dueAt ? `в ${hm(r.dueAt)}` : 'скоро'}`
    case 'building': return 'Собирается по этим ответам'
    case 'ready': return `Готово — учтено в БФТ${r.at ? ` ${hm(r.at)}` : ''}`
    case 'failed': return `Ошибка пересборки${r.reason ? `: ${r.reason.slice(0, 160)}` : ''}`
    case 'skipped': return `Пересборка не понадобилась${r.reason ? `: ${r.reason.slice(0, 160)}` : ''}`
    default: return cycle ? 'Нет в процессе заявки (ответы до учёта входящих событий)' : 'Статус неизвестен: процесс заявки недоступен'
  }
}

/**
 * Входящие: записи процесса заявки, дополненные ответами из файла формы. Отправки, которых
 * процесс не знает (до этого кода или Temporal недоступен), показываются честно — без статуса.
 */
export function inboxView(form: BftForm | undefined, cycle: readonly InboxEntry[] | undefined): InboxView {
  const subs = form ? submissionsOf(form) : []
  const byAt = new Map(subs.map((s) => [s.at, s]))
  const items: InboxItem[] = (cycle ?? []).map((e) => {
    const sub = byAt.get(e.at)
    byAt.delete(e.at)
    return {
      id: e.id, at: e.at, ...(e.author ? { author: e.author } : sub?.author ? { author: sub.author } : {}),
      addressees: e.addressees.length ? e.addressees : sub?.addressees ?? [],
      saved: e.saved, unknown: e.unknown,
      rebuild: { ...e.rebuild, label: rebuildLabel(e.rebuild, true) },
      items: sub?.items ?? [],
    }
  })
  for (const sub of byAt.values()) {
    items.push({
      id: `form:${sub.at}`, at: sub.at, ...(sub.author ? { author: sub.author } : {}), addressees: sub.addressees,
      saved: sub.saved, unknown: sub.unknown, rebuild: { state: 'unknown', label: rebuildLabel({ state: 'unknown' }, !!cycle) }, items: sub.items,
    })
  }
  return { cycle: !!cycle, items: items.sort((a, b) => b.at.localeCompare(a.at)) }
}

const jsonInScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')

export const INBOX_STYLE = `<style id="customer-inbox-style">
.cs-inbox{ margin:.6rem 0 .2rem; }
.cs-inbox[hidden]{ display:none; }
.cs-inbox-list{ list-style:none; margin:0; padding:0; }
.ib{ border:1px solid var(--line-soft); border-left:3px solid #1a73e8; border-radius:6px; margin:.4rem 0; padding:.45rem .6rem; cursor:pointer; }
.ib:hover{ background:var(--mark); }
.ib-head{ display:flex; justify-content:space-between; gap:.5rem; font-weight:600; font-size:.86rem; }
.ib-new{ color:#fff; background:#1a73e8; border-radius:4px; font-size:.68rem; font-weight:600; padding:0 .35rem; margin-left:.35rem; }
.ib-meta{ display:block; color:var(--muted); font-size:.78rem; margin-top:.1rem; }
.ib-st{ display:inline-block; margin-top:.3rem; font-size:.76rem; border-radius:4px; padding:.05rem .4rem; background:var(--line-soft); }
.ib-st.waiting{ background:#fff4d6; color:#7a5200; } .ib-st.building{ background:#e3edfd; color:#174ea6; }
.ib-st.ready{ background:#e6f4ea; color:#1e6b2f; } .ib-st.failed{ background:#fde7e7; color:#a50e0e; }
.ib-ans{ display:none; margin:.45rem 0 0; padding:0; list-style:none; cursor:default; }
.ib.open .ib-ans{ display:block; }
.ib-ans li{ border-top:1px solid var(--line-soft); padding:.35rem 0; font-size:.82rem; }
.ib-ans .q{ display:block; color:var(--muted); }
.ib-ans .a{ display:block; white-space:pre-wrap; }
.ib-ans .unk{ color:#9a5b00; font-style:italic; }
.cs-toast{ position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:80; display:flex; gap:.8rem; align-items:center; max-width:min(560px,94vw);
  background:#202124; color:#fff; border-radius:8px; padding:.7rem 1rem; box-shadow:0 4px 14px rgba(0,0,0,.25); font:14px/1.4 system-ui,sans-serif; }
.cs-toast b{ font-weight:600; }
.cs-toast button{ font:inherit; font-weight:600; background:none; border:0; color:#8ab4f8; cursor:pointer; padding:.2rem .4rem; }
.cs-rail-tab.q.has-new::after{ content:" ●"; color:#fff; }
@media print{ .cs-toast{ display:none !important; } }
</style>`

/** Раздел «Входящие» сайдбара вопросов и оповещение: опрос `url` раз в 5 с, пока вкладка видна. */
export function inboxBlock(url: string, sessionId: string): string {
  return `${INBOX_STYLE}<section class="cs-inbox" id="csInbox" hidden aria-live="polite"><div class="cs-sb-group" id="csInboxHead">Входящие</div><ul class="cs-inbox-list" id="csInboxList"></ul></section>
<script id="customer-inbox-js">(function(){
var URL_=${jsonInScript(url)}, SID=${jsonInScript(sessionId)}, KEY='bft-inbox-seen-'+SID;
var box=document.getElementById('csInbox'), list=document.getElementById('csInboxList'), head=document.getElementById('csInboxHead');
var seen={}; try{ seen=JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){}
var known=null, open={};
function save(){ try{ localStorage.setItem(KEY, JSON.stringify(seen)); }catch(e){} }
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function when(iso){ try{ return new Date(iso).toLocaleString('ru-RU',{ day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); }catch(e){ return iso; } }
function who(it){ return it.author ? it.author : 'Без подписи'; }
function forWhom(it){ return it.addressees.length ? 'вопросы для: '+it.addressees.join(', ') : ''; }
function count(it){ return 'ответов '+it.saved+(it.unknown ? ' (не знают — '+it.unknown+')' : ''); }
function render(view){
  box.hidden=!view.items.length;
  head.textContent='Входящие · '+view.items.length;
  list.innerHTML=view.items.map(function(it){
    var answers=it.items.length ? it.items.map(function(a){ return '<li><span class="q">'+esc(a.question)+(a.addressee?' · для: '+esc(a.addressee):'')+'</span>'+(a.status==='unknown' ? '<span class="a unk">не знаю / не ко мне</span>' : '<span class="a">'+esc(a.text)+'</span>')+'</li>'; }).join('') : '<li>Тексты ответов не найдены в файле формы.</li>';
    return '<li class="ib'+(open[it.id]?' open':'')+'" data-id="'+esc(it.id)+'" tabindex="0" aria-expanded="'+(open[it.id]?'true':'false')+'">'
      +'<div class="ib-head"><span>Форма заполнена'+(seen[it.id]?'':'<span class="ib-new">новое</span>')+'</span><span>'+esc(when(it.at))+'</span></div>'
      +'<span class="ib-meta">От: '+esc(who(it))+(it.author?'':' (не подписался)')+(forWhom(it)?' · '+esc(forWhom(it)):'')+'</span>'
      +'<span class="ib-meta">'+esc(count(it))+'</span>'
      +'<span class="ib-st '+esc(it.rebuild.state)+'" title="Пересборка документа по этим ответам — из процесса заявки">'+esc(it.rebuild.label)+'</span>'
      +'<ul class="ib-ans">'+answers+'</ul></li>';
  }).join('');
  var tab=document.getElementById('csSideToggle');
  if(tab) tab.classList.toggle('has-new', view.items.some(function(it){ return !seen[it.id]; }));
}
function toast(it){
  var old=document.querySelector('.cs-toast'); if(old) old.remove();
  var t=document.createElement('div'); t.className='cs-toast'; t.setAttribute('role','status');
  t.innerHTML='<span><b>Форма заполнена</b> — '+esc(who(it))+' · '+esc(count(it))+'</span><button type="button">Открыть</button>';
  t.querySelector('button').addEventListener('click', function(){ t.remove(); show(it.id); });
  document.body.appendChild(t); setTimeout(function(){ t.remove(); }, 15000);
}
function show(id){
  document.body.classList.add('cs-sb-open');
  open[id]=true; seen[id]=1; save();
  var li=list.querySelector('[data-id="'+(window.CSS&&CSS.escape?CSS.escape(id):id)+'"]');
  if(li){ li.classList.add('open'); li.setAttribute('aria-expanded','true'); var n=li.querySelector('.ib-new'); if(n) n.remove(); li.scrollIntoView({ block:'nearest' }); }
}
list.addEventListener('click', function(e){
  var li=e.target.closest('.ib'); if(!li || e.target.closest('.ib-ans')) return;
  var id=li.getAttribute('data-id'); open[id]=!open[id]; seen[id]=1; save();
  li.classList.toggle('open', !!open[id]); li.setAttribute('aria-expanded', open[id]?'true':'false');
  var n=li.querySelector('.ib-new'); if(n) n.remove();
});
list.addEventListener('keydown', function(e){ if((e.key==='Enter'||e.key===' ') && e.target.classList.contains('ib')){ e.preventDefault(); e.target.click(); } });
function poll(){
  if(document.hidden) return;
  fetch(URL_+(URL_.indexOf('?')<0?'?':'&')+'session='+encodeURIComponent(SID), { cache:'no-store' })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(view){
      if(!view || !view.items) return;
      var fresh=known ? view.items.filter(function(it){ return !known[it.id]; }) : [];
      known={}; view.items.forEach(function(it){ known[it.id]=1; });
      render(view);
      if(fresh.length) toast(fresh[0]);
    }).catch(function(){});
}
poll(); setInterval(poll, 5000);
document.addEventListener('visibilitychange', poll);
})();</script>`
}
