/**
 * Страницы формы вопросов по БФТ (ADR-0018):
 *  - formPage — сама форма по ссылке-ключу: «Вопросы заказчику» (сначала
 *    главные, потом остальные) и «Уточнения для команд» по адресатам; ответ,
 *    «Не знаю / не ко мне», подпись — по желанию; ссылка на предпросмотр БФТ;
 *  - previewPage — полный БФТ только на чтение по той же ссылке: без выгрузки,
 *    комментариев и служебных блоков; вопросы и пометки [УТОЧНИТЬ] ведут в форму;
 *  - deepFormBlock / deepFormFooter — слой формы на странице полного БФТ в
 *    портале: правка вопросов PO на месте и «Сформировать форму».
 * Открытые страницы — noindex, без запросов к корню хоста.
 */
import { deepPageBase } from './fast-page.js'
import { formTitle, questionForMarker, type BftForm, type FormAnswer, type FormQuestion, type FormVersion } from './forms.js'
import { UNASSIGNED, type QuestionRef } from './questions.js'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')
/** JSON внутри <script>: без «</script>» и разрывов строк JS. */
const jsonInScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '')

const when = (iso: string) => {
  try { return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' }) } catch { return iso.slice(0, 16) }
}
const refText = (refs: readonly QuestionRef[]) => refs.map((r) => (r.id && r.id !== r.section ? `${r.id} (${r.section})` : r.section)).join(', ')

/** Вопросы по сторонам и адресатам: заказчику — главные, затем остальные; командам — группы по адресату. */
export function arrange(questions: readonly FormQuestion[]): { customer: FormQuestion[]; teams: { addressee: string; items: FormQuestion[] }[] } {
  const rank = (q: FormQuestion) => (q.priority === 'main' ? 0 : 1)
  const byRank = (list: FormQuestion[]) => list.map((q, i) => ({ q, i })).sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i).map(({ q }) => q)
  const customer = byRank(questions.filter((q) => q.side === 'customer'))
  const groups = new Map<string, FormQuestion[]>()
  for (const q of questions.filter((x) => x.side === 'team')) {
    const key = [...groups.keys()].find((k) => k.toLowerCase() === q.addressee.toLowerCase()) ?? q.addressee
    groups.set(key, [...(groups.get(key) ?? []), q])
  }
  const teams = [...groups.entries()].map(([addressee, items]) => ({ addressee, items: byRank(items) }))
    .sort((a, b) => Number(a.addressee === UNASSIGNED) - Number(b.addressee === UNASSIGNED) || b.items.length - a.items.length)
  return { customer, teams }
}

const forWhom = (addressee: string) => (addressee === UNASSIGNED ? addressee : `Для: ${addressee}`)

// ---- форма ----

// Вид — как у привычных онлайн-форм: сиреневая подложка, шапка-карточка с цветной полосой, разделы,
// карточка на вопрос, ответ — подчёркнутое поле «Мой ответ». Светлая тема, без внешних шрифтов и скриптов.
const FORM_PAGE_STYLE = `<style>
:root{ --bg:#f0ebf8; --card:#fff; --fg:#202124; --muted:#5f6368; --line:#dadce0; --accent:#673ab7; --accent-soft:#f3eefb; --ok:#188038; --warn:#b06000; --err:#d93025; color-scheme:light; }
*{ box-sizing:border-box; }
html{ background:var(--bg); }
body{ margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 Roboto,"Helvetica Neue",Arial,sans-serif; }
.wrap{ max-width:770px; margin:0 auto; padding:12px 16px 48px; }
.tools{ display:flex; justify-content:flex-end; margin:0 0 12px; }
.card{ background:var(--card); border:1px solid var(--line); border-radius:8px; padding:24px; margin:0 0 12px; }
.head{ border-top:10px solid var(--accent); padding-top:22px; }
h1{ font-size:32px; line-height:1.25; font-weight:400; margin:0 0 12px; }
.head p{ margin:0 0 8px; font-size:14px; }
.meta{ color:var(--muted); font-size:12px; margin:12px 0 0; }
.preview{ color:var(--accent); font-weight:500; text-decoration:none; }
.preview:hover{ text-decoration:underline; }
.head .hr{ border:0; border-top:1px solid var(--line); margin:16px -24px 12px; }
.req{ color:var(--err); font-size:14px; }
.side{ margin:24px 0 12px; }
.side .tab{ display:inline-block; background:var(--accent); color:#fff; font-size:14px; font-weight:500; padding:8px 16px 10px; border-radius:8px 8px 0 0; margin-bottom:-6px; position:relative; }
.side .card{ margin:0; border-top-left-radius:0; }
.side h2{ margin:0 0 6px; font-size:24px; font-weight:400; }
.side p{ margin:0; color:var(--muted); }
.count{ color:var(--muted); font-size:12px; }
.group{ font-size:18px; font-weight:400; margin:0; }
.group-card{ padding:16px 24px; border-left:6px solid var(--accent); }
.sub{ margin:20px 4px 8px; font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; }
.q{ scroll-margin-top:12px; transition:box-shadow .15s; }
.q:target, .q:focus-within{ border-left:6px solid #4285f4; padding-left:19px; }
.q-text{ margin:0 0 4px; font-size:16px; line-height:1.5; }
.q-where{ color:var(--muted); font-size:12px; margin:0 0 12px; }
input[type=text], textarea{ display:block; width:100%; font:inherit; font-size:14px; color:inherit; background:transparent; border:0; border-bottom:1px solid var(--line); border-radius:0; padding:8px 0 6px; }
input[type=text]{ max-width:50%; min-width:260px; }
textarea{ resize:none; overflow:hidden; min-height:32px; line-height:1.5; }
input[type=text]:focus, textarea:focus{ outline:none; border-bottom:2px solid var(--accent); padding-bottom:5px; }
::placeholder{ color:#70757a; }
.q-row{ display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; margin-top:16px; font-size:14px; }
.q-row label{ display:inline-flex; gap:10px; align-items:center; cursor:pointer; }
input[type=checkbox]{ width:18px; height:18px; margin:0; accent-color:var(--accent); }
.state{ font-size:12px; color:var(--ok); }
.state.unk{ color:var(--warn); }
.q.unknown textarea{ color:var(--muted); }
.empty{ color:var(--muted); margin:0; }
.done summary{ cursor:pointer; font-size:16px; }
.done ul{ padding-left:18px; margin:12px 0 0; }
.done li{ margin:8px 0; }
.submit{ display:flex; flex-wrap:wrap; gap:12px 16px; align-items:center; margin:24px 0 8px; }
button{ font:inherit; cursor:pointer; }
.btn{ background:var(--accent); color:#fff; border:0; border-radius:4px; padding:9px 24px; font-size:14px; font-weight:500; letter-spacing:.25px; }
.btn:hover{ box-shadow:0 1px 2px rgba(60,64,67,.3),0 1px 3px 1px rgba(60,64,67,.15); }
.btn[disabled]{ background:#c7b8e2; box-shadow:none; cursor:default; }
.btn-line{ background:#fff; color:var(--accent); border:1px solid var(--line); border-radius:4px; padding:8px 16px; font-size:14px; font-weight:500; display:inline-flex; gap:8px; align-items:center; }
.btn-line:hover{ background:var(--accent-soft); }
#status{ color:var(--muted); }
.foot{ color:var(--muted); font-size:12px; text-align:center; margin:24px 0 0; }
/* «Подготовить письма» — панель справа */
.scrim{ position:fixed; inset:0; background:rgba(32,33,36,.4); z-index:20; }
.drawer{ position:fixed; top:0; right:0; bottom:0; width:min(520px,100%); background:#fff; z-index:21; display:flex; flex-direction:column; box-shadow:0 8px 10px 1px rgba(0,0,0,.14),0 3px 14px 2px rgba(0,0,0,.12); }
.drawer[hidden], .scrim[hidden]{ display:none; }
.dr-head{ display:flex; align-items:center; gap:12px; padding:16px 20px; border-bottom:1px solid var(--line); }
.dr-head b{ font-size:18px; font-weight:400; flex:1; }
.dr-x{ background:none; border:0; font-size:22px; line-height:1; color:var(--muted); padding:4px 8px; border-radius:50%; }
.dr-x:hover{ background:#f1f3f4; }
.dr-body{ flex:1; overflow:auto; padding:16px 20px; background:#f8f9fa; }
.dr-note{ color:var(--muted); margin:0 0 12px; }
.letter{ background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px 16px 16px; margin:0 0 12px; }
.letter .lt{ display:flex; justify-content:space-between; gap:8px; font-size:12px; color:var(--muted); margin:0 0 4px; }
.letter .lt b{ color:var(--accent); font-weight:500; }
.letter label{ display:flex; align-items:baseline; gap:8px; border-bottom:1px solid var(--line); }
.letter label span{ flex:none; width:56px; color:var(--muted); font-size:13px; }
.letter input{ border:0 !important; max-width:none; min-width:0; padding:8px 0; }
.letter input.bad{ color:var(--err); }
.letter textarea{ border:0; min-height:200px; resize:vertical; overflow:auto; padding-top:10px; font-size:13px; }
.letter textarea:focus{ border:0; padding-bottom:6px; }
.dr-foot{ display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; padding:12px 20px; border-top:1px solid var(--line); }
.dr-foot small{ color:var(--muted); flex:1 1 200px; }
.dr-foot .err{ color:var(--err); }
.dr-reset{ background:none; border:0; color:var(--accent); font-weight:500; padding:8px; }
@media (max-width:600px){ h1{ font-size:24px; } .card{ padding:20px 16px; } .head .hr{ margin:16px -16px 12px; } input[type=text]{ max-width:none; min-width:0; } }
</style>`

function questionCard(q: FormQuestion, n: number, answer: FormAnswer | undefined): string {
  const unknown = answer?.status === 'unknown'
  const value = answer?.status === 'answer' ? answer.text : ''
  const state = answer
    ? `<span class="state${unknown ? ' unk' : ''}">${unknown ? 'Отмечено «не знаю»' : 'Ответ сохранён'} · ${esc(when(answer.at))}${answer.author ? ` · ${esc(answer.author)}` : ''}</span>`
    : ''
  return `<div class="card q${unknown ? ' unknown' : ''}" id="q-${esc(q.qid)}" data-qid="${esc(q.qid)}">
<p class="q-text">${n}. ${esc(q.text)}</p>
${q.refs.length ? `<p class="q-where">Где в БФТ: ${esc(refText(q.refs))}</p>` : ''}
<textarea rows="1" aria-label="Ответ на вопрос ${n}" placeholder="Мой ответ" maxlength="4000" data-initial="${esc(value)}">${esc(value)}</textarea>
<div class="q-row"><label><input type="checkbox" class="unk"${unknown ? ' checked' : ''} data-initial="${unknown ? '1' : ''}"> Не знаю / не ко мне</label>${state}</div>
</div>`
}

export interface FormPageOpts {
  previewHref: string
  answerHref: string
}

/** Данные для писем: вопросы по адресатам — корневое письмо заказчику, ответы в цепочке — командам. */
export interface MailPlan {
  title: string
  slug: string
  customer: string[]
  teams: { addressee: string; items: string[] }[]
}

export function mailPlan(form: BftForm, version: FormVersion): MailPlan {
  const { customer, teams } = arrange(version.questions)
  return { title: formTitle(form.title), slug: form.slug, customer: customer.map((q) => q.text), teams: teams.map((g) => ({ addressee: g.addressee, items: g.items.map((q) => q.text) })) }
}

/** Форма по ссылке-ключу. */
export function formPage(form: BftForm, version: FormVersion, opts: FormPageOpts): string {
  const { customer, teams } = arrange(version.questions)
  let n = 0
  const cards = (list: FormQuestion[]) => {
    const main = list.filter((q) => q.priority === 'main')
    const more = list.filter((q) => q.priority !== 'main')
    return main.map((q) => questionCard(q, ++n, form.answers[q.qid])).join('')
      + (more.length ? `${main.length ? '<p class="sub">Ещё вопросы — уточнения</p>' : ''}${more.map((q) => questionCard(q, ++n, form.answers[q.qid])).join('')}` : '')
  }
  const answeredHere = (list: FormQuestion[]) => list.filter((q) => form.answers[q.qid]).length
  const teamCount = teams.reduce((s, g) => s + g.items.length, 0)
  const teamList = teams.flatMap((g) => g.items)
  const customerHtml = customer.length ? cards(customer) : '<div class="card"><p class="empty">Вопросов к заказчику нет.</p></div>'
  const teamsHtml = teams.length
    ? teams.map((g) => `<div class="card group-card"><p class="group">${esc(forWhom(g.addressee))}</p><p class="count">Вопросов: ${g.items.length}</p></div>${cards(g.items)}`).join('')
    : '<div class="card"><p class="empty">Вопросов к командам нет.</p></div>'
  const current = new Set(version.questions.map((q) => q.qid))
  const earlier = Object.values(form.answers).filter((a) => !current.has(a.qid))
  const earlierHtml = earlier.length
    ? `<details class="card done"><summary>Уже учтено в БФТ — ответов ${earlier.length}</summary><ul>${earlier.map((a) => `<li><b>${esc(a.question)}</b><br>${a.status === 'unknown' ? '<i>не знаю / не ко мне</i>' : esc(a.text)} <span class="state">· ${esc(when(a.at))}${a.author ? ` · ${esc(a.author)}` : ''}</span></li>`).join('')}</ul></details>`
    : ''
  const total = version.questions.length
  const answered = version.questions.filter((q) => form.answers[q.qid]).length
  const sections = (customer.length ? 1 : 0) + (teams.length ? 1 : 0) || 1
  const custNo = 1
  const teamNo = customer.length ? 2 : 1
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><link rel="icon" href="data:,">
<title>${esc(formTitle(form.title))} — вопросы по БФТ</title>${FORM_PAGE_STYLE}</head><body><div class="wrap" data-bft-form="${esc(form.id)}">
<div class="tools"><button class="btn-line" id="mailOpen" type="button" aria-haspopup="dialog">✉ Подготовить письма</button></div>
<div class="card head">
<h1>${esc(formTitle(form.title))}</h1>
<p>Ответьте на то, что знаете. Остальное оставьте пустым или отметьте «Не знаю / не ко мне».</p>
<p>Отвечать можно частями: сохранённые ответы не пропадут. Через пару минут после отправки требования пересоберутся с вашими ответами.</p>
<p><a class="preview" href="${esc(opts.previewHref)}" target="_blank" rel="noopener">Открыть БФТ целиком (только чтение)</a></p>
<hr class="hr">
<p class="meta">Версия формы ${version.v} · обновлена ${esc(when(version.at))} · вопросов ${total}, отвечено ${answered}</p>
</div>
<div class="card"><p class="q-text">Как вас подписать</p><p class="q-where">Имя и команда — необязательно</p>
<input type="text" id="author" maxlength="120" placeholder="Мой ответ" autocomplete="name"></div>
${customer.length || !teams.length ? `<div class="side"><span class="tab">Раздел ${custNo} из ${sections}</span><div class="card"><h2>Вопросы заказчику</h2><p class="count">Отвечено ${answeredHere(customer)} из ${customer.length}</p></div></div>
${customerHtml}` : ''}
${teams.length || !customer.length ? `<div class="side teams"><span class="tab">Раздел ${teamNo} из ${Math.max(sections, teamNo)}</span><div class="card"><h2>Уточнения для команд</h2><p class="count">Отвечено ${answeredHere(teamList)} из ${teamCount}</p></div></div>
${teamsHtml}` : ''}
${earlierHtml}
<div class="submit"><button class="btn" id="send" type="button" disabled>Отправить ответы</button><span id="status">Изменений нет</span></div>
<p class="foot">Форма собрана из бизнес-функциональных требований. Не отправляйте через неё пароли и персональные данные.</p>
</div>
${mailDrawer()}
<script>(function(){
var ANSWER=${jsonInScript(opts.answerHref)}, ID=${jsonInScript(form.id)};
var send=document.getElementById('send'), status=document.getElementById('status'), author=document.getElementById('author');
try{ author.value=localStorage.getItem('bft-form-author')||''; }catch(e){}
function cards(){ return Array.prototype.slice.call(document.querySelectorAll('.q[data-qid]')); }
function grow(t){ t.style.height='auto'; t.style.height=t.scrollHeight+'px'; }
cards().forEach(function(c){ grow(c.querySelector('textarea')); });
function changed(){ return cards().filter(function(c){ var t=c.querySelector('textarea'), u=c.querySelector('.unk'); return t.value.trim()!==t.getAttribute('data-initial').trim() || (u.checked?'1':'')!==u.getAttribute('data-initial'); }); }
function refresh(){ var n=changed().length; send.disabled=!n; status.textContent=n?('Изменено ответов: '+n):'Изменений нет'; }
document.addEventListener('input', function(e){ if(e.target.closest && e.target.closest('.q')) { grow(e.target); refresh(); } });
document.addEventListener('change', function(e){ if(e.target.classList.contains('unk')){ e.target.closest('.q').classList.toggle('unknown', e.target.checked); refresh(); } });
window.addEventListener('beforeunload', function(e){ if(changed().length){ e.preventDefault(); e.returnValue=''; } });
send.addEventListener('click', function(){
  var list=changed(); if(!list.length) return;
  try{ localStorage.setItem('bft-form-author', author.value.trim()); }catch(e){}
  var answers=list.map(function(c){ var u=c.querySelector('.unk').checked; return { qid:c.getAttribute('data-qid'), text:c.querySelector('textarea').value, status:u?'unknown':'answer' }; });
  send.disabled=true; status.textContent='Отправляю…';
  fetch(ANSWER,{ method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ id:ID, author:author.value.trim(), answers:answers }) })
    .then(function(r){ return r.json().then(function(j){ return { ok:r.ok, j:j }; }); })
    .then(function(res){
      if(!res.ok) throw new Error(res.j && res.j.error || 'не сохранилось');
      list.forEach(function(c){ var t=c.querySelector('textarea'), u=c.querySelector('.unk'); t.setAttribute('data-initial', u.checked?'':t.value); u.setAttribute('data-initial', u.checked?'1':'');
        var s=c.querySelector('.state'); if(!s){ s=document.createElement('span'); c.querySelector('.q-row').appendChild(s); }
        s.className='state'+(u.checked?' unk':''); s.textContent=u.checked?'Отмечено «не знаю» · только что':'Ответ сохранён · только что'; });
      refresh(); status.textContent='Сохранено ответов: '+res.j.saved+'. Требования пересоберутся с ними через пару минут.';
    })
    .catch(function(e){ send.disabled=false; status.textContent='Не сохранилось: '+e.message+'. Попробуйте ещё раз.'; });
});
refresh();
})();</script>
<script>${MAIL_SCRIPT.replace('__PLAN__', () => jsonInScript(mailPlan(form, version))).replace('__ID__', () => jsonInScript(form.id)).replace('__PREVIEW__', () => jsonInScript(opts.previewHref))}</script>
</body></html>`
}

function mailDrawer(): string {
  return `<div class="scrim" id="mailScrim" hidden></div>
<aside class="drawer" id="mailDrawer" role="dialog" aria-modal="true" aria-labelledby="mailTitle" hidden>
<div class="dr-head"><b id="mailTitle">Письма с вопросами</b><button class="dr-x" id="mailClose" type="button" aria-label="Закрыть">×</button></div>
<div class="dr-body"><p class="dr-note">Первое письмо — корневое, остальные — ответы на него в той же цепочке: каждому адресату свои вопросы и ссылка на эту форму. Впишите адреса, поправьте текст и нажмите «Отправить» — скачается архив писем-черновиков (.eml), их откроет почтовый клиент.</p><div id="mailList"></div></div>
<div class="dr-foot"><button class="btn" id="mailSend" type="button">Отправить</button><button class="dr-reset" id="mailReset" type="button">Сбросить текст</button><small id="mailStatus">Адреса — через запятую</small></div>
</aside>`
}

/** Письма: тексты по адресатам, правка, .eml-цепочка (Message-ID / In-Reply-To / References) в .zip. */
const MAIL_SCRIPT = `(function(){
var PLAN=__PLAN__, ID=__ID__, PREVIEW=__PREVIEW__, KEY='bft-mail-'+ID;
var drawer=document.getElementById('mailDrawer'), scrim=document.getElementById('mailScrim'), list=document.getElementById('mailList'), st=document.getElementById('mailStatus');
var link=location.href.split('#')[0], preview=new URL(PREVIEW, location.href).toString();
function plural(n,a,b,c){ var m=n%10, h=n%100; return n+' '+(m===1&&h!==11?a:m>=2&&m<=4&&(h<12||h>14)?b:c); }
function numbered(items){ return items.map(function(t,i){ return (i+1)+'. '+t; }).join('\\n'); }
function subject(){ return 'Вопросы по требованиям: '+PLAN.title; }
function drafts(){
  var out=[], s=subject();
  var root=['Здравствуйте!','','Готовим бизнес-функциональные требования по заявке «'+PLAN.title+'». Чтобы закончить документ, нужны ответы на несколько вопросов.',''];
  if(PLAN.customer.length) root=root.concat(['Вопросы к вам ('+plural(PLAN.customer.length,'вопрос','вопроса','вопросов')+'):', numbered(PLAN.customer), '']);
  if(PLAN.teams.length) root=root.concat(['Вопросы к командам — ниже в этой цепочке, каждой отдельным письмом.','']);
  root=root.concat(['Ответить можно в форме, без входа и регистрации:', link, '', 'Что не знаете — отметьте в форме «Не знаю / не ко мне».', 'Документ целиком (только чтение): '+preview, '', 'Спасибо!']);
  out.push({ key:'root', label:'Корневое письмо · заказчику', to:'', cc:'', subject:s, body:root.join('\\n') });
  PLAN.teams.forEach(function(g){
    out.push({ key:'team:'+g.addressee, label:'Ответ в цепочке · '+g.addressee, to:'', cc:'', subject:'Re: '+s,
      body:['Коллеги, добрый день!','','По заявке «'+PLAN.title+'» нужна ваша помощь — '+plural(g.items.length,'вопрос','вопроса','вопросов')+'. Адресат в требованиях: '+g.addressee+'.','',numbered(g.items),'','Ответить можно в той же форме — раздел «Уточнения для команд»:',link,'','Если вопрос не к вам — отметьте «Не знаю / не ко мне» или подскажите, кому переадресовать.','','Спасибо!'].join('\\n') });
  });
  return out;
}
function saved(){ try{ return JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){ return {}; } }
function letters(){ var s=saved(); return drafts().map(function(d){ var k=s[d.key]; return k?{ key:d.key, label:d.label, to:k.to||'', cc:k.cc||'', subject:k.subject||d.subject, body:k.body||d.body }:d; }); }
function esc(t){ return String(t).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function render(){
  list.innerHTML=letters().map(function(l,i){ return '<section class="letter" data-key="'+esc(l.key)+'"><p class="lt"><b>'+(i?'Ответ '+i:'Письмо 1')+'</b><span>'+esc(l.label)+'</span></p>'
    +'<label><span>Кому</span><input type="text" data-f="to" value="'+esc(l.to)+'" placeholder="адрес@компания.ru" autocomplete="email"></label>'
    +'<label><span>Копия</span><input type="text" data-f="cc" value="'+esc(l.cc)+'" placeholder="необязательно"></label>'
    +'<label><span>Тема</span><input type="text" data-f="subject" value="'+esc(l.subject)+'"></label>'
    +'<textarea data-f="body" aria-label="Текст письма">'+esc(l.body)+'</textarea></section>'; }).join('');
}
function collect(){ return Array.prototype.map.call(list.querySelectorAll('.letter'), function(sec){ var o={ key:sec.getAttribute('data-key') }; sec.querySelectorAll('[data-f]').forEach(function(f){ o[f.getAttribute('data-f')]=f.value; }); return o; }); }
function store(){ var s={}; collect().forEach(function(l){ s[l.key]={ to:l.to, cc:l.cc, subject:l.subject, body:l.body }; }); try{ localStorage.setItem(KEY, JSON.stringify(s)); }catch(e){} }
function open(v){ drawer.hidden=scrim.hidden=!v; if(v){ render(); document.body.style.overflow='hidden'; } else document.body.style.overflow=''; }
document.getElementById('mailOpen').addEventListener('click', function(){ open(true); });
document.getElementById('mailClose').addEventListener('click', function(){ open(false); });
scrim.addEventListener('click', function(){ open(false); });
document.addEventListener('keydown', function(e){ if(e.key==='Escape' && !drawer.hidden) open(false); });
list.addEventListener('input', function(e){ if(e.target.classList) e.target.classList.remove('bad'); store(); });
document.getElementById('mailReset').addEventListener('click', function(){ var keep={}; collect().forEach(function(l){ keep[l.key]={ to:l.to, cc:l.cc }; }); try{ localStorage.setItem(KEY, JSON.stringify(keep)); }catch(e){} render(); st.textContent='Текст писем — как было, адреса сохранены'; st.className=''; });
var EMAIL=/^[^@\\s,;<>]+@[^@\\s,;<>]+\\.[^@\\s,;<>]+$/;
function addrs(v){ return v.split(/[,;\\s]+/).filter(Boolean); }
function b64(s){ var b=new TextEncoder().encode(s), out=''; for(var i=0;i<b.length;i+=0x8000) out+=String.fromCharCode.apply(null, b.subarray(i,i+0x8000)); return btoa(out); }
function word(s){ if(/^[\\x20-\\x7e]*$/.test(s)) return s; var parts=[], cur=''; Array.from(s).forEach(function(ch){ if(new TextEncoder().encode(cur+ch).length>42){ parts.push(cur); cur=''; } cur+=ch; }); if(cur) parts.push(cur); return parts.map(function(p){ return '=?UTF-8?B?'+b64(p)+'?='; }).join('\\r\\n '); }
function eml(l, id, parent){
  var h=['X-Unsent: 1','MIME-Version: 1.0','Date: '+new Date().toUTCString().replace('GMT','+0000'),'Message-ID: '+id];
  if(addrs(l.to).length) h.push('To: '+addrs(l.to).join(', '));
  if(addrs(l.cc).length) h.push('Cc: '+addrs(l.cc).join(', '));
  if(parent){ h.push('In-Reply-To: '+parent, 'References: '+parent); }
  h.push('Subject: '+word(l.subject),'Content-Type: text/plain; charset=utf-8','Content-Transfer-Encoding: base64','');
  return h.join('\\r\\n')+'\\r\\n'+b64(l.body.replace(/\\r?\\n/g,'\\r\\n')).replace(/.{76}/g,'$&\\r\\n')+'\\r\\n';
}
var CRC=(function(){ var t=[]; for(var n=0;n<256;n++){ var c=n; for(var k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; t[n]=c>>>0; } return t; })();
function crc(b){ var c=0xFFFFFFFF; for(var i=0;i<b.length;i++) c=CRC[(c^b[i])&255]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function zip(files){
  var enc=new TextEncoder(), parts=[], central=[], off=0;
  function u16(v){ return [v&255,(v>>>8)&255]; } function u32(v){ return [v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255]; }
  files.forEach(function(f){ var name=enc.encode(f.name), data=enc.encode(f.text), c=crc(data);
    var head=[].concat([0x50,0x4b,3,4],u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(c),u32(data.length),u32(data.length),u16(name.length),u16(0));
    parts.push(new Uint8Array(head), name, data);
    central.push(new Uint8Array([].concat([0x50,0x4b,1,2],u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0x21),u32(c),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off))), name);
    off+=head.length+name.length+data.length; });
  var size=central.reduce(function(s,p){ return s+p.length; },0);
  return new Blob(parts.concat(central,[new Uint8Array([].concat([0x50,0x4b,5,6],u16(0),u16(0),u16(files.length),u16(files.length),u32(size),u32(off),u16(0)))]),{ type:'application/zip' });
}
document.getElementById('mailSend').addEventListener('click', function(){
  var ls=collect(), bad=0;
  list.querySelectorAll('input[data-f="to"],input[data-f="cc"]').forEach(function(f){ var ok=addrs(f.value).every(function(a){ return EMAIL.test(a); }); f.classList.toggle('bad', !ok); if(!ok) bad++; });
  if(bad){ st.textContent='Проверьте адреса — выделены красным'; st.className='err'; return; }
  var stamp=Date.now().toString(36), host='bft-form.local';
  var rootId='<bft-'+ID.slice(0,8)+'-'+stamp+'-0@'+host+'>';
  var files=ls.map(function(l,i){ var id=i?'<bft-'+ID.slice(0,8)+'-'+stamp+'-'+i+'@'+host+'>':rootId;
    return { name:(i<9?'0':'')+(i+1)+(i?'-otvet':'-koren')+'.eml', text:eml(l, id, i?rootId:'') }; });
  var a=document.createElement('a'); a.href=URL.createObjectURL(zip(files)); a.download=(PLAN.slug||'bft')+'-pisma.zip'; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  var empty=ls.filter(function(l){ return !addrs(l.to).length; }).length;
  st.className=''; st.textContent='Скачано писем: '+files.length+(empty?(', без адресата: '+empty+' — впишете в почте'):'')+'. Откройте их по порядку: сначала корневое.';
});
})();`

/** Ссылка не найдена или отозвана. */
export function formGonePage(revoked: boolean): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><link rel="icon" href="data:,"><title>Форма недоступна</title>${FORM_PAGE_STYLE}</head>
<body><div class="wrap"><div class="kicker">Вопросы по БФТ</div><h1>${revoked ? 'Ссылка отозвана' : 'Форма не найдена'}</h1>
<p class="meta">${revoked ? 'Владелец БФТ отозвал эту ссылку. Попросите у него новую.' : 'Проверьте ссылку целиком — она длинная, её легко обрезать при копировании.'}</p></div></body></html>`
}

// ---- пометки [УТОЧНИТЬ] → форма (шаг 9) ----

/** Пометка `<mark class="unc">[УТОЧНИТЬ у X: …]</mark>` со своим вопросом в форме — ссылкой на этот вопрос. */
export function linkMarks(page: string, questions: readonly FormQuestion[], href: (qid: string) => string): string {
  return page.replace(/<mark class="unc">([\s\S]*?)<\/mark>/g, (whole, inner: string) => {
    const text = unesc(inner.replace(/<[^>]+>/g, ''))
    const m = /\[УТОЧНИТЬ([^\]]*)\]/.exec(text)
    const q = m ? questionForMarker(m[1] ?? '', questions) : undefined
    return q ? `<a class="unc-link" href="${esc(href(q.qid))}" target="_blank" rel="noopener" title="Ответить в форме вопросов">${whole}</a>` : whole
  })
}

/** Вставить перед концом основного текста документа. */
export function appendToMain(page: string, html: string): string {
  const at = page.lastIndexOf('</main>')
  return at < 0 ? page.replace(/<\/body>/, `${html}</body>`) : page.slice(0, at) + html + page.slice(at)
}

// ---- слой формы на странице полного БФТ в портале ----

export interface DeepFormLayer {
  sessionId: string
  questions: FormQuestion[]
  answers: Record<string, FormAnswer>
  /** Убранные PO вопросы — их можно вернуть. */
  removed: FormQuestion[]
  /** Ссылка формы, если выдана и не отозвана. */
  link?: string
  version?: number
  /** Маршруты (относительно страницы) для правки и выдачи ссылки. */
  api: { create: string; revoke: string; edit: string }
}

export const FORM_STYLE = `<style id="customer-form-style">
.cs-side{ margin:1rem 0 .2rem; font-size:1.02rem; }
.cs-q{ margin:.3rem 0; }
.cs-q .cs-tools{ display:inline-flex; gap:.25rem; margin-left:.4rem; }
.cs-q .cs-tools button, .cs-add button, .cs-share button{ font:inherit; font-size:.82rem; border:1px solid var(--muted); background:transparent; color:inherit; border-radius:5px; padding:0 .45rem; cursor:pointer; }
.cs-ans{ display:block; font-size:.88em; color:#2f7d32; }
.cs-ans.unk{ color:#9a5b00; }
.cs-add{ display:flex; flex-wrap:wrap; gap:.4rem; margin:.8rem 0 .2rem; }
.cs-add input{ font:inherit; font-size:.9rem; padding:.2rem .4rem; border:1px solid var(--muted); background:transparent; color:inherit; border-radius:5px; }
.cs-add input[name=text]{ flex:1 1 300px; }
.cs-add input[name=addressee]{ flex:0 1 180px; }
.cs-form-link{ margin:.6rem 0 0; font-size:.92rem; }
.cs-share{ border:1.5px solid var(--fg); padding:.8rem 1.1rem 1rem; margin:3rem 0 2rem; }
.cs-share h2{ margin:.2rem 0 .5rem; }
.cs-share .cs-big{ font-size:1rem; font-weight:600; padding:.35rem 1rem; border-width:1.5px; }
.cs-share input{ width:100%; font:inherit; font-size:.9rem; padding:.35rem .5rem; margin:.4rem 0; border:1px solid var(--muted); background:transparent; color:inherit; border-radius:5px; }
.cs-share p{ margin:.3rem 0; }
a.unc-link{ text-decoration:none; }
a.unc-link mark{ text-decoration:underline dotted; cursor:pointer; }
</style>`

const answerLine = (a: FormAnswer | undefined) => !a ? ''
  : a.status === 'unknown'
    ? `<span class="cs-ans unk">не знают${a.author ? ` (${esc(a.author)})` : ''}</span>`
    : `<span class="cs-ans">✓ ${esc(a.text.length > 160 ? `${a.text.slice(0, 160)}…` : a.text)}${a.author ? ` — ${esc(a.author)}` : ''}</span>`

/** «Что нужно для согласования» со слоем формы: стороны, ответы, правка PO на месте (шаг 2). */
export function deepFormBlock(form: DeepFormLayer): string {
  const { customer, teams } = arrange(form.questions)
  const item = (q: FormQuestion) => `<li class="cs-q" data-qid="${esc(q.qid)}">${form.link ? `<a href="${esc(`${form.link}#q-${q.qid}`)}" target="_blank" rel="noopener">${esc(q.text)}</a>` : esc(q.text)}${q.refs.length ? ` <span class="cs-q-ref">— ${esc(refText(q.refs))}</span>` : ''}${q.manual ? ' <span class="cs-q-ref">(добавлен PO)</span>' : ''}<span class="cs-tools"><button type="button" data-op="edit" title="Переформулировать">✎</button><button type="button" data-op="addressee" title="Сменить адресата">кому</button><button type="button" data-op="remove" title="Убрать из формы">×</button></span>${answerLine(form.answers[q.qid])}</li>`
  const customerHtml = customer.length ? `<ul>${customer.map(item).join('')}</ul>` : '<p class="cs-q-ref">Вопросов к заказчику нет.</p>'
  const teamsHtml = teams.length ? teams.map((g) => `<h3>${esc(g.addressee === UNASSIGNED ? g.addressee : `Спросить у ${g.addressee}`)}</h3><ul>${g.items.map(item).join('')}</ul>`).join('') : '<p class="cs-q-ref">Вопросов к командам нет.</p>'
  const removed = form.removed.length
    ? `<details><summary class="cs-q-ref">Убраны из формы — ${form.removed.length}</summary><ul>${form.removed.map((q) => `<li class="cs-q" data-qid="${esc(q.qid)}">${esc(q.text)} <span class="cs-tools"><button type="button" data-op="restore">вернуть</button></span></li>`).join('')}</ul></details>`
    : ''
  return `<section class="cs-questions" id="customer-questions"><h2 id="sec-questions">Что нужно для согласования</h2>
<h3 class="cs-side">Вопросы заказчику</h3>${customerHtml}
<h3 class="cs-side">Уточнения для команд</h3>${teamsHtml}
${removed}
<form class="cs-add" id="csAddQ"><input name="text" placeholder="Свой вопрос — что нужно узнать?" maxlength="500" required><input name="addressee" placeholder="У кого (заказчика, команды…)" maxlength="120" value="заказчика"><button type="submit">+ Добавить вопрос</button></form>
<p class="cs-form-link">${form.link ? `Форма вопросов: <a href="${esc(form.link)}" target="_blank" rel="noopener">открыть</a> · версия ${form.version ?? 1}` : '<a href="#customer-form-share">Сформировать форму для заказчика и команд ↓</a>'}</p>
</section>`
}

/** Внизу БФТ — «Сформировать форму» / ссылка, «Скопировать», «Отозвать» (шаги 3–4). */
export function deepFormFooter(form: DeepFormLayer): string {
  const count = form.questions.length
  const customer = form.questions.filter((q) => q.side === 'customer').length
  const answered = form.questions.filter((q) => form.answers[q.qid]).length
  const body = form.link
    ? `<p>Ссылка открывается без входа в портал. Ответы встраиваются в БФТ: документ пересобирается через пару минут после ответа, форма — вслед за ним.</p>
<input id="csFormUrl" readonly value="${esc(form.link)}">
<p><button type="button" class="cs-big" id="csCopy">Скопировать ссылку</button> <a href="${esc(form.link)}" target="_blank" rel="noopener">Открыть форму</a> · <button type="button" id="csRevoke">Отозвать ссылку</button></p>
<p class="cs-q-ref">Вопросов ${count} (заказчику — ${customer}, командам — ${count - customer}), отвечено ${answered}. Отозванная ссылка перестаёт открываться; ответы остаются, новая ссылка — той же кнопкой.</p>`
    : `<p>Вопросы из «Что нужно для согласования» — формой по ссылке: заказчик и команды открывают её без входа в портал и отвечают. Ответы встраиваются в БФТ, документ пересобирается.</p>
<p><button type="button" class="cs-big" id="csCreate">Сформировать форму</button></p>
<p class="cs-q-ref">Вопросов ${count}: заказчику — ${customer}, командам — ${count - customer}. Поправить их можно выше, в «Что нужно для согласования».</p>`
  const script = `<script id="customer-form-js">(function(){
var API=${jsonInScript(form.api)}, SID=${jsonInScript(form.sessionId)};
function post(url, body){ return fetch(url,{ method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(Object.assign({ sessionId:SID }, body||{})) }).then(function(r){ return r.json().then(function(j){ if(!r.ok) throw new Error(j&&j.error||('ошибка '+r.status)); return j; }); }); }
function fail(e){ alert('Не получилось: '+e.message); }
function edit(body){ return post(API.edit, body).then(function(){ location.reload(); }, fail); }
document.addEventListener('click', function(e){
  var b=e.target.closest('[data-op]'); if(!b) return;
  var li=b.closest('[data-qid]'), qid=li&&li.getAttribute('data-qid'), op=b.getAttribute('data-op');
  if(op==='edit'){ var cur=(li.querySelector('a')||li).firstChild.textContent; var t=prompt('Вопрос', cur); if(t&&t.trim()&&t!==cur) edit({ op:'edit', qid:qid, text:t }); }
  else if(op==='addressee'){ var a=prompt('У кого спросить (заказчика, команды …)', ''); if(a&&a.trim()) edit({ op:'edit', qid:qid, addressee:a }); }
  else if(op==='remove'){ if(confirm('Убрать вопрос из формы?')) edit({ op:'remove', qid:qid }); }
  else if(op==='restore') edit({ op:'restore', qid:qid });
});
var add=document.getElementById('csAddQ');
if(add) add.addEventListener('submit', function(e){ e.preventDefault(); edit({ op:'add', text:add.text.value, addressee:add.addressee.value }); });
var create=document.getElementById('csCreate');
if(create) create.addEventListener('click', function(){ create.disabled=true; post(API.create).then(function(){ location.hash='customer-form-share'; location.reload(); }, function(e){ create.disabled=false; fail(e); }); });
var copy=document.getElementById('csCopy'), url=document.getElementById('csFormUrl');
if(copy) copy.addEventListener('click', function(){ url.select(); (navigator.clipboard?navigator.clipboard.writeText(url.value):Promise.reject()).catch(function(){ document.execCommand('copy'); }).then(function(){ copy.textContent='Скопировано'; setTimeout(function(){ copy.textContent='Скопировать ссылку'; }, 1500); }); });
var revoke=document.getElementById('csRevoke');
if(revoke) revoke.addEventListener('click', function(){ if(confirm('Отозвать ссылку? Она перестанет открываться у всех, кому её отправили.')) post(API.revoke).then(function(){ location.reload(); }, fail); });
})();</script>`
  return `<section class="cs-share" id="customer-form-share"><h2>Форма вопросов</h2>${body}</section>${script}`
}

// ---- предпросмотр по ссылке формы ----

export interface PreviewOpts {
  formHref: string
  /** БФТ пересобирается — показан прежний документ. */
  building: boolean
}

const PREVIEW_STYLE = `<style id="customer-preview-style">.promptbox, #panel, #panelToggle{ display:none !important; }
.cs-note{ border-left:3px solid #9a5b00; padding:.3rem .8rem; margin:0 0 1.2rem; }</style>`

/** Полный БФТ только на чтение: вопросы и пометки ведут в форму. */
export function previewPage(deepHtml: string, form: BftForm, version: FormVersion, opts: PreviewOpts): string {
  const href = (qid: string) => `${opts.formHref}#q-${qid}`
  const { customer, teams } = arrange(version.questions)
  const item = (q: FormQuestion) => `<li><a href="${esc(href(q.qid))}">${esc(q.text)}</a>${q.refs.length ? ` <span class="cs-q-ref">— ${esc(refText(q.refs))}</span>` : ''}${answerLine(form.answers[q.qid])}</li>`
  const block = `<section class="cs-questions" id="customer-questions"><h2 id="sec-questions">Что нужно для согласования</h2>
<h3 class="cs-side">Вопросы заказчику</h3>${customer.length ? `<ul>${customer.map(item).join('')}</ul>` : '<p class="cs-q-ref">Нет.</p>'}
<h3 class="cs-side">Уточнения для команд</h3>${teams.length ? teams.map((g) => `<p><b>${esc(forWhom(g.addressee))}</b></p><ul>${g.items.map(item).join('')}</ul>`).join('') : '<p class="cs-q-ref">Нет.</p>'}
<p class="cs-form-link"><a href="${esc(opts.formHref)}">Ответить в форме →</a></p></section>`
  const top = `<p class="cs-kicker">Предпросмотр БФТ · только чтение · <a href="${esc(opts.formHref)}">← к форме вопросов</a></p>`
  const note = opts.building ? '<p class="cs-note">БФТ пересобирается с новыми ответами — здесь пока предыдущая версия документа.</p>' : ''
  let page = deepPageBase(deepHtml, { top, afterH1: note, block })
  page = linkMarks(page, version.questions, href)
  page = page.replace(/<head>/, '<head><meta name="robots" content="noindex,nofollow">')
  const at = page.lastIndexOf('</body>')
  return at < 0 ? page + PREVIEW_STYLE : page.slice(0, at) + PREVIEW_STYLE + page.slice(at)
}
