/**
 * Адрес маршрута узла для браузера. Портал живёт и в корне домена, и под
 * префиксом (https://host/bft/ за nginx, префикс срезается): абсолютный
 * '/api/…' ушёл бы мимо портала. Разрешаем относительно document.baseURI —
 * dsh кладёт в index.html <base href="./">, как и для своего RPC.
 */
export const portalHref = (path: string): string => new URL(path.replace(/^\/+/, ''), document.baseURI).toString()
