/** react-dom даёт таблица модулей оболочки dsh; типов пакета в devDependencies нет — нужен только портал. */
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react'
  export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal
}
