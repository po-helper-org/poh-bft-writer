export class BftError extends Error {}

/** Документ есть на диске, но прочитать его не удалось. Пустой экран без причины хуже ошибки. */
export class DocumentUnreadableError extends BftError {
  constructor(readonly path: string, readonly cause: unknown) {
    super(`Документ ${path} не читается: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'DocumentUnreadableError'
  }
}

/**
 * Путь из браузера увёл за пределы каталога документов.
 *
 * Проверка обязательна и симлинко-осведомлённа: путь приходит с клиента, и без
 * неё «документ» вида `../../.ssh/id_rsa` был бы прочитан и показан.
 */
export class DocumentOutsideWorkspaceError extends BftError {
  constructor(readonly path: string) {
    super(`Путь ${path} ведёт за пределы каталога документов`)
    this.name = 'DocumentOutsideWorkspaceError'
  }
}

export class TaskNotFoundError extends BftError {
  constructor(readonly id: string) {
    super(`Требование ${id} не найдено`)
    this.name = 'TaskNotFoundError'
  }
}

export class InvalidTaskIdError extends BftError {
  constructor(readonly id: string) {
    super(`Недопустимый идентификатор требования: ${id}`)
    this.name = 'InvalidTaskIdError'
  }
}

/** Журнал работы не записался. Молча потерянный отрезок хуже явной ошибки. */
export class WorkLogWriteError extends BftError {
  constructor(readonly path: string, readonly cause: unknown) {
    super(`Журнал работы ${path} не записан: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'WorkLogWriteError'
  }
}
