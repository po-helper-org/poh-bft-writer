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
import { questionForMarker, type BftForm, type FormAnswer, type FormQuestion, type FormVersion } from './forms.js'
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

const FORM_PAGE_STYLE = `<style>
:root{ --fg:#141414; --muted:#6b6b6b; --line:#e2dfd8; --bg:#fbfaf7; --card:#fff; --accent:#1f5f99; --ok:#2f7d32; --warn:#9a5b00; }
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){ --fg:#ececec; --muted:#a0a0a0; --line:#34322e; --bg:#141414; --card:#1c1c1c; --accent:#7fb2e5; --ok:#7cc47f; --warn:#e0a54a; } }
*{ box-sizing:border-box; }
body{ margin:0; background:var(--bg); color:var(--fg); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
.wrap{ max-width:820px; margin:0 auto; padding:2rem 16px 7rem; }
.kicker{ font:.72rem/1.3 ui-monospace,Menlo,monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
h1{ font-size:1.55rem; line-height:1.25; margin:.35rem 0 .5rem; }
.meta{ color:var(--muted); font-size:.9rem; margin:0 0 1rem; }
.intro{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:.9rem 1rem; margin:0 0 1.2rem; }
.intro p{ margin:.2rem 0; }
.preview{ display:inline-block; margin:.2rem 0 1.2rem; font-weight:600; color:var(--accent); }
.who{ display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin:0 0 1.6rem; }
.who input{ flex:1 1 260px; }
input[type=text], textarea{ width:100%; font:inherit; color:inherit; background:var(--card); border:1px solid var(--line); border-radius:8px; padding:.55rem .7rem; }
textarea{ min-height:4.5rem; resize:vertical; }
textarea:focus, input:focus{ outline:2px solid var(--accent); outline-offset:1px; }
.side{ margin:2rem 0 .6rem; padding:.35rem 0; border-bottom:2px solid var(--fg); display:flex; justify-content:space-between; align-items:baseline; gap:1rem; }
.side h2{ margin:0; font-size:1.2rem; }
.side .count{ color:var(--muted); font-size:.85rem; white-space:nowrap; }
.side.teams{ border-bottom-color:var(--muted); }
.group{ margin:1.3rem 0 .4rem; font-size:.95rem; color:var(--muted); font-weight:600; }
.sub{ margin:1.2rem 0 .3rem; font-size:.85rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; }
.q{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:.8rem 1rem .9rem; margin:.6rem 0; scroll-margin-top:1rem; }
.q:target{ outline:2px solid var(--accent); }
.q-text{ margin:0 0 .3rem; font-weight:600; }
.q-where{ color:var(--muted); font-size:.82rem; margin:0 0 .5rem; }
.q-row{ display:flex; flex-wrap:wrap; gap:.4rem 1rem; align-items:center; margin-top:.45rem; font-size:.9rem; }
.q-row label{ display:inline-flex; gap:.35rem; align-items:center; cursor:pointer; color:var(--muted); }
.state{ font-size:.82rem; color:var(--ok); }
.state.unk{ color:var(--warn); }
.q.unknown textarea{ opacity:.55; }
.done{ margin-top:2.2rem; }
.done summary{ cursor:pointer; color:var(--muted); }
.done li{ margin:.4rem 0; }
.bar{ position:fixed; left:0; right:0; bottom:0; background:var(--card); border-top:1px solid var(--line); padding:.7rem 16px; }
.bar .in{ max-width:820px; margin:0 auto; display:flex; gap:1rem; align-items:center; flex-wrap:wrap; }
button{ font:inherit; cursor:pointer; }
.send{ background:var(--accent); color:#fff; border:0; border-radius:8px; padding:.6rem 1.2rem; font-weight:600; }
.send[disabled]{ opacity:.5; cursor:default; }
#status{ color:var(--muted); font-size:.92rem; }
.empty{ color:var(--muted); }
</style>`

function questionCard(q: FormQuestion, n: number, answer: FormAnswer | undefined): string {
  const unknown = answer?.status === 'unknown'
  const value = answer?.status === 'answer' ? answer.text : ''
  const state = answer
    ? `<span class="state${unknown ? ' unk' : ''}">${unknown ? 'Отмечено «не знаю»' : 'Ответ сохранён'} · ${esc(when(answer.at))}${answer.author ? ` · ${esc(answer.author)}` : ''}</span>`
    : ''
  return `<div class="q${unknown ? ' unknown' : ''}" id="q-${esc(q.qid)}" data-qid="${esc(q.qid)}">
<p class="q-text">${n}. ${esc(q.text)}</p>
${q.refs.length ? `<p class="q-where">Где в БФТ: ${esc(refText(q.refs))}</p>` : ''}
<textarea aria-label="Ответ на вопрос ${n}" placeholder="Ваш ответ" maxlength="4000" data-initial="${esc(value)}">${esc(value)}</textarea>
<div class="q-row"><label><input type="checkbox" class="unk"${unknown ? ' checked' : ''} data-initial="${unknown ? '1' : ''}"> Не знаю / не ко мне</label>${state}</div>
</div>`
}

export interface FormPageOpts {
  previewHref: string
  answerHref: string
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
  const customerHtml = customer.length ? cards(customer) : '<p class="empty">Вопросов к заказчику нет.</p>'
  const teamsHtml = teams.length
    ? teams.map((g) => `<p class="group">${esc(forWhom(g.addressee))}</p>${cards(g.items)}`).join('')
    : '<p class="empty">Вопросов к командам нет.</p>'
  const current = new Set(version.questions.map((q) => q.qid))
  const earlier = Object.values(form.answers).filter((a) => !current.has(a.qid))
  const earlierHtml = earlier.length
    ? `<details class="done"><summary>Уже учтено в БФТ — ответов ${earlier.length}</summary><ul>${earlier.map((a) => `<li><b>${esc(a.question)}</b><br>${a.status === 'unknown' ? '<i>не знаю / не ко мне</i>' : esc(a.text)} <span class="state">· ${esc(when(a.at))}${a.author ? ` · ${esc(a.author)}` : ''}</span></li>`).join('')}</ul></details>`
    : ''
  const total = version.questions.length
  const answered = version.questions.filter((q) => form.answers[q.qid]).length
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><link rel="icon" href="data:,">
<title>Вопросы по БФТ</title>${FORM_PAGE_STYLE}</head><body><div class="wrap" data-bft-form="${esc(form.id)}">
<div class="kicker">Вопросы по БФТ · заказчику и командам</div>
<h1>${esc(form.title)}</h1>
<p class="meta">Версия формы ${version.v} · обновлена ${esc(when(version.at))} · вопросов ${total}, отвечено ${answered}</p>
<a class="preview" href="${esc(opts.previewHref)}" target="_blank" rel="noopener">Открыть БФТ целиком (только чтение) →</a>
<div class="intro"><p>Ответьте на то, что знаете. Остальное оставьте пустым или отметьте «Не знаю / не ко мне».</p>
<p>Отвечать можно частями: сохранённые ответы не пропадут. Через пару минут после отправки БФТ пересоберётся с вашими ответами, а форма обновится.</p></div>
<div class="who"><input type="text" id="author" maxlength="120" placeholder="Как вас подписать — имя, команда (необязательно)" autocomplete="name"></div>
<div class="side"><h2>Вопросы заказчику</h2><span class="count">${answeredHere(customer)} из ${customer.length}</span></div>
${customerHtml}
<div class="side teams"><h2>Уточнения для команд</h2><span class="count">${answeredHere(teamList)} из ${teamCount}</span></div>
${teamsHtml}
${earlierHtml}
</div>
<div class="bar"><div class="in"><button class="send" id="send" type="button" disabled>Отправить ответы</button><span id="status">Изменений нет</span></div></div>
<script>(function(){
var ANSWER=${jsonInScript(opts.answerHref)}, ID=${jsonInScript(form.id)};
var send=document.getElementById('send'), status=document.getElementById('status'), author=document.getElementById('author');
try{ author.value=localStorage.getItem('bft-form-author')||''; }catch(e){}
function cards(){ return Array.prototype.slice.call(document.querySelectorAll('.q[data-qid]')); }
function changed(){ return cards().filter(function(c){ var t=c.querySelector('textarea'), u=c.querySelector('.unk'); return t.value.trim()!==t.getAttribute('data-initial').trim() || (u.checked?'1':'')!==u.getAttribute('data-initial'); }); }
function refresh(){ var n=changed().length; send.disabled=!n; status.textContent=n?('Изменено ответов: '+n):'Изменений нет'; }
document.addEventListener('input', refresh);
document.addEventListener('change', function(e){ if(e.target.classList.contains('unk')) e.target.closest('.q').classList.toggle('unknown', e.target.checked); refresh(); });
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
      refresh(); status.textContent='Сохранено ответов: '+res.j.saved+'. БФТ пересоберётся с ними через пару минут.';
    })
    .catch(function(e){ send.disabled=false; status.textContent='Не сохранилось: '+e.message+'. Попробуйте ещё раз.'; });
});
refresh();
})();</script>
</body></html>`
}

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
