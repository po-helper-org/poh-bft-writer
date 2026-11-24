/**
 * Страницы доступа к MCP (ADR-0023): «Доступ для ИИ-агентов» (личные токены),
 * вход (коробка без Authentik) и «Пользователи» (администратор). Без сборки и
 * внешних скриптов; POST — fetch с заголовком X-Bft-Request (чужой сайт его без
 * CORS не пошлёт — защита от подделки запроса).
 */
import type { McpTokenView } from './access.js'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

const STYLE = `
:root{--fg:#111;--muted:#6b6b6b;--line:#e4e1da;--bg:#fff;--card:#faf9f6;--accent:#1f5fbf;--ok:#1d7a3a;--warn:#b45309}
@media (prefers-color-scheme:dark){:root{--fg:#eee;--muted:#9a9a9a;--line:#333;--bg:#151515;--card:#1d1d1d;--accent:#6aa0ff;--ok:#5cc27c;--warn:#f0a34a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:2rem 16px 4rem}h1{font-size:1.5rem;margin:.2rem 0 .4rem}h2{font-size:1.05rem;margin:1.8rem 0 .6rem}
.kicker{font:.72rem/1.3 ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.muted{color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:.6rem 0}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:.5rem .4rem;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:.75rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
input{font:inherit;padding:.5rem .6rem;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);width:100%}
button{font:inherit;padding:.5rem .9rem;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}button.ghost{background:none;color:var(--accent)}
.row{display:flex;gap:.6rem;align-items:end;flex-wrap:wrap}.row>label{flex:1;min-width:180px}label span{display:block;font-size:.8rem;color:var(--muted);margin-bottom:.2rem}
pre{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto;font:13px/1.45 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all}
.fresh{border-color:var(--ok)}.err{color:var(--warn)}code{font:13px ui-monospace,monospace}
`

const SCRIPT = `
async function post(url, body){
  const r = await fetch(url, {method:'POST', headers:{'content-type':'application/json','x-bft-request':'1'}, body: JSON.stringify(body), credentials:'same-origin'});
  const out = await r.json().catch(()=>({error:'ответ не JSON'}));
  if (!r.ok || out.error) throw new Error(out.error || ('HTTP ' + r.status));
  return out;
}
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-post]'); if (!f) return;
  e.preventDefault();
  const msg = f.querySelector('.msg'); if (msg) msg.textContent = '';
  try {
    const out = await post(f.dataset.post, Object.fromEntries(new FormData(f)));
    if (out.fresh) { document.getElementById('fresh').innerHTML = out.fresh; f.reset(); return; }
    if (out.redirect) location.href = out.redirect; else location.reload();
  } catch (err) { if (msg) msg.textContent = err.message; }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
  try { await post(b.dataset.url, JSON.parse(b.dataset.act)); location.reload(); } catch (err) { alert(err.message); }
});
`

const page = (title: string, body: string) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${STYLE}</style></head><body><div class="wrap">${body}</div><script>${SCRIPT}</script></body></html>`

export interface AccessView {
  user: string
  mode: 'sso' | 'local'
  mcpUrl: string
  tokens: McpTokenView[]
  postUrl: string
  logoutUrl?: string
}

/** Только что выпущенный токен — блок показывается один раз, на томе только отпечаток. */
export function freshTokenBlock(token: string, name: string, mcpUrl: string): string {
  const config = JSON.stringify({ mcpServers: { bft: { type: 'http', url: mcpUrl, headers: { Authorization: `Bearer ${token}` } } } }, undefined, 2)
  return `<div class="card fresh"><b>Токен «${esc(name)}» выпущен.</b> Скопируйте его сейчас — портал хранит только отпечаток и показать его снова не сможет.
<pre>${esc(token)}</pre>
<p class="muted">Подключение (Claude Code, Cursor и другие клиенты MCP):</p><pre>${esc(config)}</pre>
<p class="muted">Claude Code одной командой:</p><pre>claude mcp add --transport http bft ${esc(mcpUrl)} --header "Authorization: Bearer ${esc(token)}"</pre></div>`
}

export function accessPage(v: AccessView): string {
  const live = v.tokens.filter((t) => !t.revokedAt)
  const rows = v.tokens.length ? `<table><thead><tr><th>Название</th><th>Начало</th><th>Выпущен</th><th>Последний вызов</th><th></th></tr></thead><tbody>${
    v.tokens.map((t) => `<tr><td>${esc(t.name)}</td><td><code>${esc(t.prefix)}…</code></td><td>${when(t.createdAt)}</td><td>${t.revokedAt ? `<span class="muted">отозван ${when(t.revokedAt)}</span>` : when(t.lastUsedAt)}</td><td>${
      t.revokedAt ? '' : `<button class="ghost" data-url="${esc(v.postUrl)}" data-act="${esc(JSON.stringify({ op: 'revoke', id: t.id }))}" data-confirm="Отозвать токен «${esc(t.name)}»? Агенты с ним сразу потеряют доступ.">Отозвать</button>`}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Токенов пока нет.</p>'
  return page('Доступ для ИИ-агентов', `
<div class="kicker">Система БФТ · MCP</div><h1>Доступ для ИИ-агентов</h1>
<p class="muted">Вы вошли как <b>${esc(v.user)}</b>${v.logoutUrl ? ` · <a href="${esc(v.logoutUrl)}">выйти</a>` : ''}. Подключите своего ИИ-агента к порталу: он проведёт заказчика по полному циклу — заявка, сценарий приёмки, бриф, полный БФТ, форма вопросов, публикация в Confluence. Тексты пишет модель агента (ваши токены), знания организации и проверки канона — портала.</p>
<div class="card"><b>Адрес MCP:</b> <code>${esc(v.mcpUrl)}</code><br><span class="muted">Транспорт — Streamable HTTP, вход — <code>Authorization: Bearer &lt;токен&gt;</code>.</span></div>
<div id="fresh"></div>
<h2>Новый токен</h2>
<form data-post="${esc(v.postUrl)}" class="row"><input type="hidden" name="op" value="issue"><label><span>Название (где используется)</span><input name="name" maxlength="80" placeholder="Claude Code на ноутбуке" required></label><button>Выпустить токен</button><span class="msg err"></span></form>
<h2>Мои токены · действующих ${live.length}</h2>${rows}`)
}

export function loginPage(postUrl: string, error?: string): string {
  return page('Вход в портал БФТ', `
<div class="kicker">Система БФТ</div><h1>Вход</h1>
<p class="muted">Учётную запись выдаёт администратор портала.</p>
<form data-post="${esc(postUrl)}" class="card" style="max-width:420px">
<label><span>Логин</span><input name="login" autocomplete="username" required></label><br><br>
<label><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label><br><br>
<button>Войти</button> <span class="msg err">${error ? esc(error) : ''}</span></form>`)
}

export function usersPage(users: { login: string; name: string; createdAt: string; disabled?: boolean }[], postUrl: string, mode: 'sso' | 'local'): string {
  const rows = users.length ? `<table><thead><tr><th>Логин</th><th>Имя</th><th>Заведён</th><th>Статус</th><th></th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.login)}</td><td>${esc(u.name)}</td><td>${when(u.createdAt)}</td><td>${u.disabled ? '<span class="err">отключён</span>' : 'активен'}</td><td><button class="ghost" data-url="${esc(postUrl)}" data-act="${esc(JSON.stringify({ op: u.disabled ? 'enable' : 'disable', login: u.login }))}">${u.disabled ? 'Включить' : 'Отключить'}</button></td></tr>`).join('')}</tbody></table>` : '<p class="muted">Пользователей пока нет.</p>'
  return page('Пользователи портала', `
<div class="kicker">Система БФТ · администратор</div><h1>Пользователи</h1>
${mode === 'sso' ? '<div class="card">Портал работает за корпоративным входом (PORTAL_AUTH=sso): пользователи — из Authentik, здесь их заводить не нужно.</div>' : ''}
<p class="muted">Пользователь входит на странице входа и сам выпускает себе токены MCP. Отключённый теряет вход и все токены сразу.</p>
<h2>Завести или сменить пароль</h2>
<form data-post="${esc(postUrl)}" class="row"><input type="hidden" name="op" value="save">
<label><span>Логин</span><input name="login" required pattern="[a-z0-9][a-z0-9._-]{1,39}"></label>
<label><span>Имя</span><input name="name"></label>
<label><span>Пароль (от 10 знаков)</span><input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
<button>Сохранить</button><span class="msg err"></span></form>
<h2>Все пользователи</h2>${rows}`)
}
