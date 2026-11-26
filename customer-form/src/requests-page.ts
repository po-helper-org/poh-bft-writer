/**
 * «Все заявки» портала (ADR-0012, шаг 7; ADR-0029 — единый стиль): на какой стадии
 * каждая заявка и в одно касание — чат, документ, артефакты.
 *
 *  - requestsShell — страница сразу, со скелетом списка; список подгружается
 *    фрагментом (?part=list), пока трекер отвечает;
 *  - requestsList — фрагмент: фильтр по стадии со счётчиками и строки заявок
 *    из карточек customer-form.bftList (bft-list.ts) — данные те же, что у Инбокса PO;
 *  - requestsError — фрагмент «трекер не ответил» с «Повторить».
 *
 * Каркас — как у боковых панелей «Вопросы» и «Планирование» (form-page.ts, .cs-sb):
 * системный шрифт 12/14/16/24, отступы 4/8/12/16/24/32, радиусы 8/12, тонкие линии,
 * зелёный/жёлтый/красный — всегда с иконкой и подписью.
 */
import type { BftArtifact, BftCard } from './bft-list.js'
import { FAVICON_TAG } from './links.js'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** Шаги пути заявки — шкала стадии в строке и фильтр. */
export const STEPS = ['Диалог', 'Сценарий', 'Требования', 'Полный БФТ', 'Согласование'] as const

/** Тон стадии: ждём заказчика, идёт работа, шаг готов, сбой, просто диалог. */
export type StageTone = 'idle' | 'wait' | 'work' | 'done' | 'fail'

export interface StageView { step: number; tone: StageTone }

const CYCLE: Record<string, StageView> = {
  intake: { step: 1, tone: 'idle' },
  scenario: { step: 2, tone: 'wait' },
  brief: { step: 3, tone: 'work' },
  brief_review: { step: 3, tone: 'wait' },
  deep: { step: 4, tone: 'work' },
  rebuilding: { step: 4, tone: 'work' },
  deep_failed: { step: 4, tone: 'fail' },
  agreement: { step: 5, tone: 'wait' },
  validated: { step: 5, tone: 'done' },
  handed_off: { step: 5, tone: 'done' },
}

const BY_STAGE: Record<BftCard['stage'], StageView> = {
  dialog: { step: 1, tone: 'idle' },
  demo: { step: 2, tone: 'wait' },
  'fast-review': { step: 3, tone: 'wait' },
  'fast-approved': { step: 3, tone: 'done' },
  'deep-building': { step: 4, tone: 'work' },
  'deep-ready': { step: 4, tone: 'done' },
  'deep-failed': { step: 4, tone: 'fail' },
}

/** Шаг и тон заявки: по циклу (ADR-0022), если он есть, иначе по файлам заявки. */
export function stageView(card: Pick<BftCard, 'stage' | 'lifecycle'>): StageView {
  return (card.lifecycle && CYCLE[card.lifecycle.stage]) || BY_STAGE[card.stage]
}

/** Документ заявки — полный БФТ, иначе первичные требования. */
export function documentOf(card: Pick<BftCard, 'artifacts'>): BftArtifact | undefined {
  return card.artifacts.find((a) => a.kind === 'deep') ?? card.artifacts.find((a) => a.kind === 'fast')
}

// Иконки — по мотивам Phosphor (regular), один штрих 16px на всей странице.
const svg = (body: string) => `<svg class="ic" viewBox="0 0 256 256" aria-hidden="true" focusable="false">${body}</svg>`
const ICON = {
  chat: svg('<path d="M45 192l-21 21V56a8 8 0 0 1 8-8h192a8 8 0 0 1 8 8v128a8 8 0 0 1-8 8Z"/><line x1="88" y1="104" x2="168" y2="104"/><line x1="88" y1="136" x2="144" y2="136"/>'),
  doc: svg('<path d="M200 224H56a8 8 0 0 1-8-8V40a8 8 0 0 1 8-8h96l56 56v128a8 8 0 0 1-8 8Z"/><polyline points="152 32 152 88 208 88"/><line x1="96" y1="136" x2="160" y2="136"/><line x1="96" y1="168" x2="160" y2="168"/>'),
  stack: svg('<polyline points="32 176 128 232 224 176"/><polyline points="32 128 128 184 224 128"/><polygon points="32 80 128 136 224 80 128 24 32 80"/>'),
  caret: svg('<polyline points="208 96 128 176 48 96"/>'),
  search: svg('<circle cx="112" cy="112" r="80"/><line x1="168.6" y1="168.6" x2="224" y2="224"/>'),
  plus: svg('<line x1="40" y1="128" x2="216" y2="128"/><line x1="128" y1="40" x2="128" y2="216"/>'),
  done: svg('<circle cx="128" cy="128" r="96"/><polyline points="88 136 112 160 168 104"/>'),
  wait: svg('<circle cx="128" cy="128" r="96"/><polyline points="128 72 128 128 184 128"/>'),
  work: svg('<path d="M128 32a96 96 0 1 1-96 96"/><polyline points="32 80 32 128 80 128"/>'),
  fail: svg('<path d="M142 40l88 152a16 16 0 0 1-14 24H40a16 16 0 0 1-14-24l88-152a16 16 0 0 1 28 0Z"/><line x1="128" y1="104" x2="128" y2="144"/><circle cx="128" cy="180" r="4"/>'),
  idle: svg('<circle cx="128" cy="128" r="96" stroke-dasharray="20 18"/>'),
  download: svg('<line x1="128" y1="40" x2="128" y2="152"/><polyline points="80 104 128 152 176 104"/><line x1="40" y1="216" x2="216" y2="216"/>'),
  retry: svg('<polyline points="176 104 224 104 224 56"/><path d="M190 190a88 88 0 1 1 34-86"/>'),
}

const TONE_LABEL: Record<StageTone, string> = { idle: 'идёт диалог', wait: 'ждём ответа', work: 'в работе', done: 'шаг готов', fail: 'сбой' }

const when = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear()
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'Europe/Moscow' }).replace(/\s?г\.$/, '')
}

const ext = { target: '_blank', rel: 'noreferrer' }
const extAttrs = `target="${ext.target}" rel="${ext.rel}"`

function artifactsMenu(card: BftCard): string {
  if (!card.artifacts.length) return `<span class="rq-btn" aria-disabled="true" title="Артефакты появятся после диалога">${ICON.stack}<span>Артефакты</span></span>`
  const items = card.artifacts.map((a) => `<li class="rq-art-item"><a class="rq-art-link" href="${esc(a.url)}" ${extAttrs} data-kind="${a.kind}"><span class="rq-art-label">${esc(a.label)}</span>${a.note ? `<span class="rq-art-note">${esc(a.note)}</span>` : ''}</a>${a.downloads?.length ? `<span class="rq-dl">${a.downloads.map((d) => `<a href="${esc(d.url)}" download title="Скачать ${esc(a.label)} в .${d.format}">${ICON.download}.${d.format}</a>`).join('')}</span>` : ''}</li>`).join('')
  return `<details class="rq-art"><summary class="rq-btn">${ICON.stack}<span>Артефакты</span><span class="rq-cnt">${card.artifacts.length}</span>${ICON.caret}</summary><div class="rq-menu"><ul>${items}</ul></div></details>`
}

/** Одна заявка: номер, название, стадия шкалой и подписью, три действия. */
export function requestRow(card: BftCard): string {
  const { step, tone } = stageView(card)
  const doc = documentOf(card)
  const segs = STEPS.map((name, i) => `<i class="${i + 1 < step || (i + 1 === step && tone === 'done') ? 'past' : i + 1 === step ? 'now' : ''}" title="${esc(name)}"></i>`).join('')
  const meta = [
    `<span class="rq-no">#${card.taskId}</span>`,
    card.status ? `<span title="Колонка в трекере">${esc(card.status)}</span>` : '',
    card.questions ? `<span>ответов ${card.questions.answered} из ${card.questions.total}</span>` : '',
    `<span>создана ${esc(when(card.created))}</span>`,
  ].filter(Boolean).join('<span class="dot" aria-hidden="true">·</span>')
  const search = [`#${card.taskId}`, card.title, card.stageLabel, card.status ?? '', STEPS[step - 1]].join(' ').toLowerCase()
  return `<li class="rq" data-request="${card.taskId}" data-step="${step}" data-tone="${tone}" data-search="${esc(search)}">
<div class="rq-main"><div class="rq-meta">${meta}</div><h2 class="rq-title">${esc(card.title)}</h2></div>
<div class="rq-stage tone-${tone}"><div class="rq-stage-label">${ICON[tone]}<span>${esc(card.stageLabel)}</span><span class="sr">, ${TONE_LABEL[tone]}</span></div>
<div class="rq-steps" aria-hidden="true">${segs}</div><div class="rq-step-cap">Шаг ${step} из ${STEPS.length} · ${STEPS[step - 1]}</div></div>
<div class="rq-actions">
<a class="rq-btn" href="${esc(card.chatUrl)}" ${extAttrs} data-act="chat">${ICON.chat}<span>Чат</span></a>
${doc ? `<a class="rq-btn" href="${esc(doc.url)}" ${extAttrs} data-act="doc" title="${esc(doc.label)}${doc.note ? ` — ${esc(doc.note)}` : ''}">${ICON.doc}<span>Документ</span></a>` : `<span class="rq-btn" aria-disabled="true" title="Документ появится после согласования сценария приёмки">${ICON.doc}<span>Документ</span></span>`}
${artifactsMenu(card)}
</div></li>`
}

/** Фрагмент списка: фильтр по стадии со счётчиками, строки и «ничего не нашлось». */
export function requestsList(cards: BftCard[], newUrl: string): string {
  if (!cards.length) {
    return `<div class="rq-state" data-state="empty">${ICON.chat}<h2>Заявок пока нет</h2><p>Заявка появится здесь, когда заказчик опишет задачу в чате портала. Отсюда же откроются её документ и артефакты.</p><a class="rq-primary" href="${esc(newUrl)}" ${extAttrs}>${ICON.plus}<span>Начать заявку</span></a></div>`
  }
  const steps = cards.map((c) => stageView(c))
  const count = (step: number) => steps.filter((s) => s.step === step).length
  const failed = steps.filter((s) => s.tone === 'fail').length
  const chip = (value: string, label: string, n: number, extra = '') => `<button type="button" class="rq-chip${extra}" data-filter="${value}" aria-pressed="${value === '' ? 'true' : 'false'}"><span>${label}</span><span class="rq-cnt">${n}</span></button>`
  const chips = [
    chip('', 'Все', cards.length),
    ...STEPS.map((name, i) => (count(i + 1) ? chip(String(i + 1), name, count(i + 1)) : '')),
    failed ? chip('fail', 'Не собран', failed, ' fail') : '',
  ].join('')
  return `<div class="rq-filters" role="group" aria-label="Стадия">${chips}</div>
<p class="rq-shown" aria-live="polite" data-total="${cards.length}">Заявок: ${cards.length}</p>
<ol class="rq-list" data-requests>${cards.map(requestRow).join('')}</ol>
<div class="rq-state" data-state="nothing" hidden>${ICON.search}<h2>Ничего не нашлось</h2><p>Проверьте номер или слово в названии либо выберите другую стадию.</p><button type="button" class="rq-alt" data-reset>Сбросить фильтры</button></div>`
}

/** Трекер не ответил — фрагмент вместо списка. */
export function requestsError(detail = 'Трекер не ответил, список заявок не загрузился.'): string {
  return `<div class="rq-state err" data-state="error" role="alert">${ICON.fail}<h2>Список не загрузился</h2><p>${esc(detail)} Попробуйте ещё раз через минуту.</p><button type="button" class="rq-alt" data-retry>${ICON.retry}<span>Повторить</span></button></div>`
}

const skeleton = Array.from({ length: 5 }, () => `<li class="rq sk"><div class="rq-main"><i style="width:30%"></i><i style="width:72%;height:20px"></i></div><div class="rq-stage"><i style="width:80%"></i><i style="height:4px"></i></div><div class="rq-actions"><i class="b"></i><i class="b"></i><i class="b"></i></div></li>`).join('')

const STYLE = `<style>
:root{ --fg:#111111; --bg:#ffffff; --muted:#666666; --line-soft:#e5e5e5; --mark:#f4f4f4; --ok:#2f7d32; --warn:#9a5b00; --err:#b3261e; --work:#1f5fa8;
  --font:system-ui,-apple-system,"Segoe UI",sans-serif; --ease:cubic-bezier(.22,1,.36,1); color-scheme:light dark; }
@media (prefers-color-scheme:dark){ :root{ --fg:#ededed; --bg:#181818; --muted:#a3a3a3; --line-soft:#313131; --mark:#272727; --ok:#7cc47f; --warn:#e3a54a; --err:#f2867e; --work:#7fb0ea; } }
*{ box-sizing:border-box; }
body{ margin:0; background:var(--bg); color:var(--fg); font:400 14px/20px var(--font); -webkit-font-smoothing:antialiased; }
a{ color:inherit; }
.sr{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.skip{ position:absolute; left:16px; top:-48px; padding:8px 12px; border-radius:8px; background:var(--fg); color:var(--bg); z-index:9; }
.skip:focus{ top:8px; }
:focus-visible{ outline:2px solid var(--fg); outline-offset:2px; }
.ic{ width:16px; height:16px; flex:none; fill:none; stroke:currentColor; stroke-width:16; stroke-linecap:round; stroke-linejoin:round; }
.wrap{ max-width:1200px; margin:0 auto; padding:32px 32px 64px; }
.rq-head{ display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:24px; }
.rq-head h1{ margin:0; font:600 24px/32px var(--font); }
.rq-head p{ margin:4px 0 0; color:var(--muted); max-width:680px; text-wrap:pretty; }
.rq-primary,.rq-alt{ display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:36px; padding:8px 12px; border-radius:8px; font:600 14px/20px var(--font); text-decoration:none; cursor:pointer;
  transition:opacity .3s var(--ease), border-color .3s var(--ease), background-color .3s var(--ease); }
.rq-primary{ border:1px solid var(--fg); background:var(--fg); color:var(--bg); }
.rq-primary:visited{ color:var(--bg); }
.rq-primary:hover{ opacity:.88; }
.rq-alt{ border:1px solid var(--line-soft); background:transparent; color:var(--fg); }
.rq-alt:hover{ border-color:var(--fg); }
.rq-primary:active,.rq-alt:active,.rq-btn:active,.rq-chip:active{ transform:translateY(1px); }
.rq-bar{ position:sticky; top:0; z-index:5; display:flex; flex-direction:column; gap:12px; margin:0 -8px; padding:12px 8px; background:var(--bg); }
.rq-search{ position:relative; max-width:480px; }
.rq-search .ic{ position:absolute; left:12px; top:10px; color:var(--muted); }
.rq-search input{ width:100%; height:36px; padding:8px 40px; border:1px solid var(--line-soft); border-radius:8px; background:var(--bg); color:var(--fg); font:400 14px/20px var(--font); transition:border-color .3s var(--ease); }
.rq-search input:hover{ border-color:var(--muted); }
.rq-search input:focus{ border-color:var(--fg); outline:none; }
.rq-search input::-webkit-search-cancel-button{ display:none; }
.rq-search kbd{ position:absolute; right:8px; top:8px; padding:0 4px; border:1px solid var(--line-soft); border-radius:4px; color:var(--muted); font:500 12px/16px var(--font); }
.rq-filters{ display:flex; gap:8px; flex-wrap:wrap; }
.rq-chip{ display:inline-flex; align-items:center; gap:8px; min-height:32px; padding:4px 12px; border:1px solid var(--line-soft); border-radius:9999px; background:transparent; color:var(--fg); font:500 14px/20px var(--font); cursor:pointer; transition:border-color .3s var(--ease), background-color .3s var(--ease), color .3s var(--ease); }
.rq-chip:hover{ border-color:var(--fg); }
.rq-chip[aria-pressed="true"]{ border-color:var(--fg); background:var(--fg); color:var(--bg); }
.rq-chip.fail{ color:var(--err); }
.rq-chip.fail[aria-pressed="true"]{ border-color:var(--err); background:var(--err); color:var(--bg); }
.rq-cnt{ min-width:20px; padding:0 8px; border-radius:9999px; background:var(--mark); color:var(--fg); font:500 12px/16px var(--font); text-align:center; font-variant-numeric:tabular-nums; }
.rq-chip[aria-pressed="true"] .rq-cnt{ background:var(--bg); color:var(--fg); }
.rq-shown{ margin:4px 0 12px; color:var(--muted); font-size:12px; line-height:16px; }
.rq-list{ list-style:none; margin:0; padding:0; border:1px solid var(--line-soft); border-radius:12px; }
.rq{ position:relative; display:grid; grid-template-columns:minmax(0,1fr) 280px 400px; align-items:center; gap:24px; padding:16px; transition:background-color .3s var(--ease); }
.rq:first-child{ border-radius:12px 12px 0 0; } .rq:last-child{ border-radius:0 0 12px 12px; } .rq:only-child{ border-radius:12px; }
.rq + .rq::before{ content:""; position:absolute; left:16px; right:16px; top:0; height:1px; background:var(--line-soft); }
.rq:hover{ background:var(--mark); }
.rq[hidden]{ display:none; }
.rq-main{ min-width:0; }
.rq-meta{ display:flex; flex-wrap:wrap; align-items:center; gap:4px 8px; color:var(--muted); font:400 12px/16px var(--font); }
.rq-meta span{ white-space:nowrap; }
.rq-no{ color:var(--fg); font-weight:500; font-variant-numeric:tabular-nums; }
.rq-title{ margin:4px 0 0; font:500 16px/24px var(--font); overflow-wrap:anywhere; text-wrap:pretty; }
.rq-stage{ min-width:0; }
.rq-stage-label{ display:flex; align-items:flex-start; gap:8px; font:500 14px/20px var(--font); }
.rq-stage-label .ic{ margin-top:2px; }
.rq-steps{ display:grid; grid-template-columns:repeat(5,1fr); gap:4px; margin:8px 0 4px 24px; }
.rq-steps i{ height:4px; border-radius:9999px; background:var(--line-soft); }
.rq-steps i.past{ background:var(--muted); }
.rq-step-cap{ margin-left:24px; color:var(--muted); font:400 12px/16px var(--font); }
.tone-done .rq-stage-label .ic{ color:var(--ok); }
.tone-done .rq-steps i.past{ background:var(--ok); }
.tone-wait .rq-stage-label .ic{ color:var(--warn); } .tone-wait .rq-steps i.now{ background:var(--warn); }
.tone-work .rq-stage-label .ic{ color:var(--work); } .tone-work .rq-steps i.now{ background:var(--work); }
.tone-fail .rq-stage-label{ color:var(--err); } .tone-fail .rq-steps i.now{ background:var(--err); }
.tone-idle .rq-stage-label .ic{ color:var(--muted); } .tone-idle .rq-steps i.now{ background:var(--fg); }
.rq-actions{ display:flex; gap:8px; justify-content:flex-end; }
.rq-btn{ display:inline-flex; align-items:center; gap:8px; min-height:36px; padding:8px 12px; border:1px solid var(--line-soft); border-radius:8px; background:var(--bg); color:var(--fg); font:600 14px/20px var(--font); text-decoration:none; white-space:nowrap; cursor:pointer; list-style:none; user-select:none;
  transition:border-color .3s var(--ease), background-color .3s var(--ease); }
.rq-btn:visited{ color:var(--fg); }
.rq-btn:hover{ border-color:var(--fg); }
.rq-btn[aria-disabled="true"]{ color:var(--muted); border-style:dashed; background:transparent; cursor:default; }
.rq-btn[aria-disabled="true"]:hover{ border-color:var(--line-soft); }
.rq-btn::-webkit-details-marker{ display:none; }
.rq-btn .rq-cnt{ margin-left:-4px; }
.rq-art{ position:relative; }
.rq-art .rq-btn > .ic:last-child{ width:12px; height:12px; color:var(--muted); transition:transform .3s var(--ease); }
.rq-art[open] .rq-btn{ border-color:var(--fg); }
.rq-art[open] .rq-btn > .ic:last-child{ transform:rotate(180deg); }
.rq-menu{ position:absolute; right:0; top:calc(100% + 8px); z-index:6; width:340px; padding:8px; border:1px solid var(--line-soft); border-radius:12px; background:var(--bg); box-shadow:0 8px 32px rgba(0,0,0,.12); animation:rq-in .3s var(--ease); }
@keyframes rq-in{ from{ opacity:0; transform:translateY(-4px); } }
.rq-menu ul{ list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
.rq-art-item{ padding:8px; border-radius:4px; transition:background-color .3s var(--ease); }
.rq-art-item:hover{ background:var(--mark); }
.rq-art-link{ display:flex; flex-direction:column; text-decoration:none; }
.rq-art-link:hover .rq-art-label{ text-decoration:underline; text-underline-offset:3px; }
.rq-art-label{ font:500 14px/20px var(--font); }
.rq-art-note{ color:var(--muted); font:400 12px/16px var(--font); }
.rq-dl{ display:flex; gap:4px; margin-top:8px; }
.rq-dl a{ display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border:1px solid var(--line-soft); border-radius:4px; color:var(--fg); font:500 12px/16px var(--font); text-decoration:none; transition:border-color .3s var(--ease); }
.rq-dl a:hover{ border-color:var(--fg); }
.rq-dl .ic{ width:12px; height:12px; }
.rq-state{ display:flex; flex-direction:column; align-items:center; gap:8px; padding:48px 24px; border:1px dashed var(--line-soft); border-radius:12px; text-align:center; }
.rq-state[hidden]{ display:none; }
.rq-state > .ic{ width:24px; height:24px; color:var(--muted); }
.rq-state h2{ margin:4px 0 0; font:500 16px/24px var(--font); }
.rq-state p{ margin:0 0 8px; max-width:420px; color:var(--muted); text-wrap:pretty; }
.rq-state.err{ border-style:solid; border-color:var(--err); }
.rq-state.err > .ic{ color:var(--err); }
.rq.sk{ pointer-events:none; }
.rq.sk i{ display:block; height:16px; margin:4px 0; border-radius:4px; background:var(--mark); animation:rq-pulse 1.2s ease-in-out infinite; }
.rq.sk .rq-actions i.b{ width:96px; height:36px; margin:0; border-radius:8px; }
@keyframes rq-pulse{ 50%{ opacity:.5; } }
@media (prefers-reduced-motion:reduce){ *{ animation:none !important; transition:none !important; } }
@media (max-width:1023px){
  .rq{ grid-template-columns:minmax(0,1fr) 240px; }
  .rq-actions{ grid-column:1 / -1; justify-content:flex-start; }
}
@media (max-width:719px){
  .wrap{ padding:24px 16px 48px; }
  .rq-head .rq-primary{ width:100%; }
  .rq-search{ max-width:none; }
  .rq-search kbd{ display:none; }
  .rq-filters{ flex-wrap:nowrap; overflow-x:auto; margin:0 -16px; padding:0 16px; scrollbar-width:none; }
  .rq-filters::-webkit-scrollbar{ display:none; }
  .rq-chip{ flex:none; }
  .rq{ grid-template-columns:minmax(0,1fr); gap:12px; }
  .rq-actions{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
  .rq-btn{ justify-content:center; min-height:44px; padding:8px; }
  .rq-btn .rq-cnt,.rq-art .rq-btn > .ic:last-child{ display:none; }
  .rq-art{ position:static; }
  .rq-art[open]{ grid-column:1 / -1; grid-row:1; }
  .rq-menu{ position:static; width:auto; margin-top:8px; box-shadow:none; }
  .rq-dl a{ min-height:32px; padding:4px 12px; }
  .rq.sk .rq-actions i.b{ width:auto; height:44px; }
}
@media (pointer:coarse){ .rq-btn,.rq-primary,.rq-alt{ min-height:44px; } .rq-chip{ min-height:40px; } }
</style>`

/** Фильтры, поиск, «Артефакты» и загрузка списка. Состояние фильтров — в адресе (?q=&stage=). */
const SCRIPT = `<script>(function(){
var box=document.getElementById("rqBox"), q=document.getElementById("rqQ"), skel=box.innerHTML;
var params=new URLSearchParams(location.search), stage=params.get("stage")||"";
if(params.get("q")) q.value=params.get("q");
function apply(){
  var list=box.querySelector("[data-requests]"); if(!list) return;
  var words=q.value.trim().toLowerCase().split(/ +/).filter(Boolean), shown=0, rows=list.children;
  for(var i=0;i<rows.length;i++){ var r=rows[i], s=r.getAttribute("data-search");
    var ok=(!stage||(stage==="fail"?r.getAttribute("data-tone")==="fail":r.getAttribute("data-step")===stage))&&words.every(function(w){return s.indexOf(w)>=0;});
    r.hidden=!ok; if(ok) shown++; }
  box.querySelectorAll(".rq-chip").forEach(function(c){ c.setAttribute("aria-pressed", String(c.getAttribute("data-filter")===stage)); });
  var total=box.querySelector(".rq-shown").getAttribute("data-total");
  box.querySelector(".rq-shown").textContent=shown==total?"Заявок: "+total:"Показано "+shown+" из "+total;
  list.hidden=!shown; box.querySelector('[data-state="nothing"]').hidden=!!shown;
  var u=new URLSearchParams(); if(q.value.trim()) u.set("q",q.value.trim()); if(stage) u.set("stage",stage);
  history.replaceState(null,"",location.pathname+(u.toString()?"?"+u:""));
}
function load(){
  box.setAttribute("aria-busy","true"); box.innerHTML=skel;
  fetch("customer-form.requests?part=list",{cache:"no-store",credentials:"same-origin"}).then(function(r){ return r.text().then(function(t){ return { ok:r.ok, t:t }; }); })
    .then(function(x){ box.innerHTML=x.t; if(!box.querySelector(".rq-filters [data-filter=\\""+stage+"\\"]")) stage=""; apply(); })
    .catch(function(){ box.innerHTML=document.getElementById("rqErr").innerHTML; })
    .then(function(){ box.removeAttribute("aria-busy"); });
}
q.addEventListener("input", apply);
box.addEventListener("click", function(e){
  var c=e.target.closest("[data-filter]"); if(c){ stage=c.getAttribute("data-filter"); apply(); return; }
  if(e.target.closest("[data-reset]")){ stage=""; q.value=""; apply(); q.focus(); return; }
  if(e.target.closest("[data-retry]")){ load(); return; }
});
box.addEventListener("toggle", function(e){ if(!e.target.open) return; box.querySelectorAll("details.rq-art[open]").forEach(function(d){ if(d!==e.target) d.open=false; }); }, true);
document.addEventListener("click", function(e){ if(!e.target.closest("details.rq-art")) box.querySelectorAll("details.rq-art[open]").forEach(function(d){ d.open=false; }); });
document.addEventListener("keydown", function(e){
  if(e.key==="Escape"){ var d=box.querySelector("details.rq-art[open]"); if(d){ d.open=false; d.querySelector("summary").focus(); } else if(document.activeElement===q&&q.value){ q.value=""; apply(); } }
  if(e.key==="/"&&document.activeElement!==q&&!/INPUT|TEXTAREA/.test(document.activeElement.tagName)){ e.preventDefault(); q.focus(); }
});
load();
})();</script>`

/** Страница «Все заявки»: шапка, поиск, скелет списка; список догружается фрагментом. */
export function requestsShell(newUrl: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FAVICON_TAG}
<meta name="robots" content="noindex,nofollow"><title>Все заявки</title>${STYLE}</head><body>
<a class="skip" href="#rqBox">К списку заявок</a>
<main class="wrap">
<header class="rq-head"><div><h1>Все заявки</h1><p>Стадия каждой заявки, её чат, документ и артефакты.</p></div>
<a class="rq-primary" href="${esc(newUrl)}" ${extAttrs}>${ICON.plus}<span>Новая заявка</span></a></header>
<div class="rq-bar"><label class="rq-search">${ICON.search}<span class="sr">Поиск по заявкам</span><input id="rqQ" type="search" placeholder="Номер или слово из названия" autocomplete="off"><kbd aria-hidden="true">/</kbd></label></div>
<section id="rqBox" aria-busy="true" aria-label="Заявки"><div class="rq-filters" aria-hidden="true"></div><p class="rq-shown">Загружаю заявки…</p><ol class="rq-list">${skeleton}</ol></section>
<noscript><p>Список заявок показывается со включённым JavaScript.</p></noscript>
<template id="rqErr">${requestsError('Портал не ответил, список заявок не загрузился.')}</template>
</main>${SCRIPT}</body></html>`
}
