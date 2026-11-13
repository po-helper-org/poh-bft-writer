/**
 * Администратор портала (ADR-0012): штатные «Настройки» dsh — ключи
 * провайдеров («Модели»), плагины («Встроенные плагины», «Плагины») — только
 * за паролем.
 *
 * Ядро dsh 0.2 пускает браузер одним владельцем (`principal: owner`), а
 * гостевой принцип есть только у LiveShare через relay; маршруты плагинов
 * не-владельцу отвечают 403. Поэтому заказчик остаётся владельцем, а
 * разделение — здесь:
 *   - вход: `ADMIN_PASSWORD` из окружения → HttpOnly-кука с HMAC пароля
 *     (смена пароля гасит все входы);
 *   - сервер: методы записи настроек перекрыты точными Fetch-маршрутами
 *     (они проверяются раньше перехватчика шлюза /api). Администратора
 *     маршрут передаёт шлюзу как есть, остальным отвечает отказом;
 *   - клиент: заказчику сайдбар со «Настройками» скрыт, горячая клавиша
 *     настроек заблокирована; администратор видит интерфейс dsh целиком.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const ADMIN_PAGE = '/api/customer-form.admin'
export const ADMIN_STATUS = '/api/customer-form.adminStatus'

const COOKIE = 'portal_admin'
const COOKIE_DAYS = 30

/**
 * Методы шлюза, которые меняют настройки портала или дают доступ к
 * контейнеру: ключи провайдеров, документ настроек, плагины, вход в аккаунт
 * DeepSeek, терминал, остановка фоновых задач. Чтение (describe, list…)
 * открыто: без него не работает чат заказчика.
 */
export const ADMIN_ONLY_ENDPOINTS: readonly string[] = [
  'credentials/set', 'credentials/unset',
  'settings/update', 'settings/replace', 'settings/mutate', 'settings/openSettingsDocument',
  'pluginManager/setVersionExemption', 'pluginManager/updateBundle', 'pluginManager/setPluginEnabled',
  'pluginManager/setBundleEnabled', 'pluginManager/installBundle', 'pluginManager/cancelInstall', 'pluginManager/removeBundle',
  'pluginMarket/setIndexes',
  'account/startSignIn', 'account/signOut',
  'terminal/environment', 'terminal/shells', 'terminal/list', 'terminal/create', 'terminal/retain',
  'terminal/attach', 'terminal/rename', 'terminal/close',
  'job/kill',
]

const password = (): string => process.env.ADMIN_PASSWORD?.trim() ?? ''

/** Значение куки для текущего пароля; пустое — пароль не задан, входа нет. */
function token(): string {
  const secret = password()
  return secret ? createHmac('sha256', secret).update('portal-admin-v1').digest('hex') : ''
}

function cookieOf(request: Request): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE) return value.join('=')
  }
  return undefined
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Запрос пришёл от вошедшего администратора. */
export function isAdmin(request: Request): boolean {
  const expected = token()
  const actual = cookieOf(request)
  return !!expected && !!actual && same(actual, expected)
}

/** Ответ шлюза «только администратор» в конверте server-response. */
export async function adminOnlyResponse(request: Request, endpoint: string): Promise<Response> {
  let rpcId = 'r'
  try { rpcId = ((await request.json()) as { rpcId?: string }).rpcId ?? rpcId } catch { /* пустое тело */ }
  return Response.json({
    type: 'server-response',
    rpcId,
    result: { ok: false, error: { code: 'portal/admin-only', message: `Только администратор портала: ${endpoint}. Войдите на ${ADMIN_PAGE}`, details: {} } },
  })
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function page(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Администратор портала</title>
<style>
:root{ --fg:#111; --muted:#777; --line:#e4e1da; --bg:#fff; --accent:#111; --on-accent:#fff; --warn:#b45309; }
@media (prefers-color-scheme:dark){ :root{ --fg:#eee; --muted:#999; --line:#333; --bg:#151515; --accent:#eee; --on-accent:#111; --warn:#f59e0b; } }
body{ margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
.wrap{ max-width:420px; margin:12vh auto 0; padding:0 16px; }
.kicker{ font:.7rem/1.3 ui-monospace,"Courier New",monospace; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
h1{ font-size:1.4rem; margin:.3rem 0 1rem; }
p{ color:var(--muted); margin:.4rem 0 1rem; }
label{ display:block; font-size:.85rem; margin-bottom:.3rem; }
input{ width:100%; box-sizing:border-box; font:inherit; padding:.55rem .7rem; border:1px solid var(--line); border-radius:8px; background:transparent; color:inherit; }
button, .btn{ display:inline-block; font:inherit; padding:.55rem 1rem; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:var(--on-accent); cursor:pointer; text-decoration:none; margin-top:.8rem; }
.ghost{ background:transparent; color:var(--fg); border-color:var(--line); }
.row{ display:flex; gap:.6rem; flex-wrap:wrap; align-items:center; }
.warn{ color:var(--warn); }
</style></head><body><div class="wrap" data-admin>${body}</div></body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}

function setCookie(value: string, maxAge: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`
}

/** GET — форма входа или «вы вошли»; POST — вход (password) или выход (logout). */
export async function adminPage(request: Request): Promise<Response> {
  const head = '<div class="kicker">Портал заказчика</div><h1>Администратор</h1>'
  if (!password()) {
    return page(`${head}<p class="warn">Пароль администратора не задан.</p><p>Задайте <code>ADMIN_PASSWORD</code> в <code>harness/.env</code> (его создаёт <code>./start.sh</code>) и перезапустите портал.</p>`)
  }
  if (request.method === 'POST') {
    const form = new URLSearchParams(await request.text())
    if (form.get('logout') !== null) {
      return new Response(null, { status: 303, headers: { location: ADMIN_PAGE, 'set-cookie': setCookie('', 0) } })
    }
    if (same(form.get('password') ?? '', password())) {
      return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': setCookie(token(), COOKIE_DAYS * 86400) } })
    }
    // Подбор пароля — не быстрее раза в секунду на запрос.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return page(`${head}${loginForm('Неверный пароль.')}`, 401)
  }
  if (isAdmin(request)) {
    return page(`${head}<p>Вы вошли. В портале открыт полный интерфейс: «Ещё → Настройки» — ключи провайдеров («Модели») и плагины («Встроенные плагины»), «Плагины» — каталог.</p>
<div class="row"><a class="btn" href="/">Открыть портал</a><form method="post"><button class="ghost" name="logout" value="1">Выйти</button></form></div>`)
  }
  return page(`${head}${loginForm()}`)
}

function loginForm(error?: string): string {
  return `<p>Настройки портала: ключи провайдеров, модель, плагины.</p>
${error ? `<p class="warn" role="alert">${esc(error)}</p>` : ''}
<form method="post"><label for="password">Пароль</label><input id="password" name="password" type="password" autocomplete="current-password" autofocus required><button type="submit">Войти</button></form>`
}
