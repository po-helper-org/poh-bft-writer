/** Документ есть на диске, но прочитать его не удалось. Пустой экран без причины хуже ошибки. */
export class DocumentUnreadableError extends Error {
  constructor(readonly path: string, readonly cause: unknown) {
    super(`Документ ${path} не читается: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'DocumentUnreadableError'
  }
}
