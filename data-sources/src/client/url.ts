/**
 * Адрес маршрута узла для браузера: портал бывает и в корне домена, и под
 * префиксом (https://host/bft/), поэтому '/api/…' разрешаем относительно
 * document.baseURI (dsh кладёт <base href="./">), а не корня домена.
 */
export const portalHref = (path: string): string => new URL(path.replace(/^\/+/, ''), document.baseURI).toString()
