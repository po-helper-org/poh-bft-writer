/**
 * Адреса, которые узел отдаёт браузеру. Портал работает и в корне домена, и
 * под префиксом за nginx (https://host/bft/, префикс срезается до узла), а на
 * том же хосте живут другие приложения: абсолютный '/…' ушёл бы к ним.
 * Страницы и редиректы узла отдаются по <префикс>/api/<маршрут>, поэтому
 * ссылки с них — относительные.
 */

/** Со страницы узла на соседний маршрут: '/api/customer-form.x?…' → 'customer-form.x?…'. */
export const siblingHref = (route: string): string => route.replace(/^\/api\//, '')

/** Со страницы узла (<префикс>/api/<маршрут>) в корень портала. */
export const PORTAL_ROOT_HREF = '../'

/**
 * Значок вкладки страниц узла: без него браузер сам просит '/favicon.ico' от
 * корня хоста — под префиксом это чужое приложение. favicon.svg отдаёт dsh в корне портала.
 */
export const FAVICON_TAG = `<link rel="icon" type="image/svg+xml" href="${PORTAL_ROOT_HREF}favicon.svg">`

/**
 * Path куки портала — путь PORTAL_PUBLIC_URL ('/' по умолчанию): под префиксом
 * кука не уходит другим приложениям хоста.
 */
export function portalCookiePath(): string {
  try {
    return new URL(process.env.PORTAL_PUBLIC_URL ?? 'http://127.0.0.1:3080').pathname.replace(/\/+$/, '') || '/'
  } catch {
    return '/'
  }
}
