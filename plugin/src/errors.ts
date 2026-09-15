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

/**
 * БФТ не передан в OKR: нет доски, не та стадия или `task edit` отказал.
 * Причина едет в окно словами — PO должен видеть, что чинить, а не «ошибка».
 */
export class OkrHandoffError extends BftError {
  constructor(readonly id: string, reason: string) {
    super(`Требование ${id} не передано в OKR: ${reason}`)
    this.name = 'OkrHandoffError'
  }
}

/** По требованию уже идёт ход Claude Code — второй параллельно не запускается. */
export class ChatBusyError extends BftError {
  constructor(readonly taskId: string, readonly runId: string) {
    super(`По требованию ${taskId} уже идёт ход — дождитесь его или остановите`)
    this.name = 'ChatBusyError'
  }
}

/** Чат через Claude Code не настроен в этой среде: порта запуска процессов нет. */
export class ChatUnavailableError extends BftError {
  constructor() {
    super('Чат через Claude Code недоступен в этой среде')
    this.name = 'ChatUnavailableError'
  }
}

/** Прогона с таким идентификатором узел не знает — перезапустился или прогон вычищен. */
export class ChatRunNotFoundError extends BftError {
  constructor(readonly runId: string) {
    super(`Ход ${runId} не найден — узел перезапускался, начните заново`)
    this.name = 'ChatRunNotFoundError'
  }
}
