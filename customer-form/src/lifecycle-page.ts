/**
 * Страница «Жизненный цикл» заявки (ADR-0022): стадия, кого ждём, раунд, вопросы и
 * хроника событий из workflow Temporal. Только чтение; за входом портала.
 */
import { FAVICON_TAG } from './links.js'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export const STAGE_LABEL: Record<string, string> = {
  intake: 'Диалог с заказчиком',
  scenario: 'Сценарий приёмки на согласовании',
  brief: 'Собираются первичные требования',
  brief_review: 'Первичные требования на проверке',
  deep: 'Собирается полный БФТ',
  deep_failed: 'Полный БФТ не собран',
  agreement: 'Согласование',
  rebuilding: 'Пересборка по ответам',
  validated: 'Согласован',
  handed_off: 'Передан в исполнение',
  cancelled: 'Отменён',
}

const REASON: Record<string, string> = { approved: 'согласованы первичные', retry: '«Собрать заново»', answers: 'ответы формы' }
const WAIT_LABEL = (w: string) => w === 'customer' ? 'заказчика' : w === 'po' ? 'PO' : w === 'model' ? 'модель' : w.startsWith('team:') ? w.slice(5) : w
const ACTOR_LABEL: Record<string, string> = { customer: 'заказчик', po: 'PO', team: 'команда', system: 'портал', mail: 'почта' }

export interface LifecyclePageData {
  title: string
  taskId: number
  status: { stage: string; waitingFor: string[]; round: number; events: number; updatedAt: string; questions?: { total: number; answered: number; unknown?: number }; rebuild?: { dueAt: string; lastSubmitAt: string }; build?: { reason: string; startedAt: string; queued?: { reason: string } }; column?: string }
  timeline: Array<{ at: string; kind: string; actor: string; summary: string; stage: string }>
  /** Ссылка на историю цикла в Temporal UI — только администратору. */
  temporalHref?: string
  backHref: string
}

const when = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function lifecyclePage(d: LifecyclePageData): string {
  const s = d.status
  const rows = [...d.timeline].reverse().map((t) => `<tr><td class="t">${esc(when(t.at))}</td><td>${esc(t.summary)}</td><td class="m">${esc(ACTOR_LABEL[t.actor] ?? t.actor)}</td><td class="m">${esc(STAGE_LABEL[t.stage] ?? t.stage)}</td></tr>`).join('')
  const facts = [
    ['Стадия', STAGE_LABEL[s.stage] ?? s.stage],
    ['Ждём', s.waitingFor.length ? s.waitingFor.map(WAIT_LABEL).join(', ') : '—'],
    ['Колонка в трекере', s.column ?? '—'],
    ['Раунд согласования', s.round ? String(s.round) : '—'],
    ['Вопросы формы', s.questions ? `отвечено ${s.questions.answered} из ${s.questions.total}${s.questions.unknown ? `, «не знаю» — ${s.questions.unknown}` : ''}` : '—'],
    ['Сборка полного БФТ', s.build ? `идёт с ${when(s.build.startedAt)} (${REASON[s.build.reason] ?? s.build.reason})${s.build.queued ? `, следом ещё одна (${REASON[s.build.queued.reason] ?? s.build.queued.reason})` : ''}` : '—'],
    ['Пересборка по ответам', s.rebuild ? `ждёт, около ${when(s.rebuild.dueAt)}` : '—'],
    ['Событий', String(s.events)],
    ['Обновлено', when(s.updatedAt)],
  ].map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${FAVICON_TAG}
<meta name="robots" content="noindex,nofollow"><title>Жизненный цикл · #${d.taskId}</title>
<style>
:root{--fg:#111;--muted:#777;--line:#e4e1da;--bg:#fff;--chip:#f3f1ec}
@media (prefers-color-scheme:dark){:root{--fg:#eee;--muted:#999;--line:#333;--bg:#151515;--chip:#222}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 Georgia,"Times New Roman",serif}
.wrap{max-width:960px;margin:0 auto;padding:2rem 16px 4rem}
.kicker{font:.7rem/1.3 "Courier New",monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
h1{font-size:1.5rem;margin:.3rem 0 1rem}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin:0 0 1.6rem}
.facts div{background:var(--chip);border-radius:8px;padding:.5rem .7rem;display:flex;flex-direction:column}
.facts span{font:.7rem "Courier New",monospace;text-transform:uppercase;color:var(--muted)}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:560px}
th,td{text-align:left;vertical-align:top;padding:.45rem .55rem;border-bottom:1px solid var(--line)}
th{font:.7rem "Courier New",monospace;text-transform:uppercase;color:var(--muted)}
td.t{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--muted)}td.m{color:var(--muted);font-size:.9rem}
a{color:inherit}.links{display:flex;gap:1.2rem;margin:0 0 1rem;font-size:.9rem}
</style></head><body><div class="wrap" data-lifecycle="${d.taskId}">
<div class="kicker">Жизненный цикл БФТ · заявка #${d.taskId}</div><h1>${esc(d.title)}</h1>
<div class="links"><a href="${esc(d.backHref)}">← Все заявки</a>${d.temporalHref ? `<a href="${esc(d.temporalHref)}" target="_blank" rel="noreferrer">История в Temporal ↗</a>` : ''}</div>
<div class="facts">${facts}</div>
<div class="scroll"><table><thead><tr><th>Когда</th><th>Событие</th><th>Кто</th><th>Стадия после</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="m">Событий пока нет.</td></tr>'}</tbody></table></div>
</div></body></html>`
}
