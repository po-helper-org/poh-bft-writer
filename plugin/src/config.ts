/**
 * Конфигурация плагина: где лежит воркспейс и его артефакты.
 *
 * Функция чистая — окружение приходит параметром, а не читается из `process.env`.
 * Так ядро остаётся без ввода-вывода и тестируется без подмены глобальных
 * объектов; `process.env` подставляет host-слой в точке запуска.
 *
 * Секретов здесь нет и быть не может: токены живут только в окружении.
 */

/**
 * Каталог документов по умолчанию — тот же, что объявляет `bft-config.template.md`
 * этого репозитория. Форма без точки живёт в воркспейсах, где каталог
 * переименовали; обе перечислены явно, потому что раньше расхождение чинилось
 * догадкой на стороне плагина и ломалось молча.
 */
export const DEFAULT_DOCS_PATH = '.bft/documentation'
export const DOCS_PATH_FALLBACKS = ['bft/documentation'] as const

export const DEFAULT_INDEX_PATH = '.bft/index'
export const INDEX_PATH_FALLBACKS = ['bft/index'] as const

export interface BftPluginConfig {
  /** Корень воркспейса. Без него плагин не стартует: угадывать чужой воркспейс опаснее, чем упасть сразу. */
  workspaceRoot: string
  /** Каталог документов относительно корня воркспейса. */
  docsPath: string
  /** Запасные каталоги документов — для воркспейсов с прежней раскладкой. */
  docsPathFallbacks: readonly string[]
  /** Каталог индекса относительно корня воркспейса. */
  indexPath: string
  /**
   * Исполняемый файл Backlog.md. Пусто — доски нет, и это штатный режим:
   * стадия тогда выводится из артефактов самого репозитория.
   */
  backlogBin?: string
  /** Тип задач Backlog.md, который считается требованием БФТ. */
  taskType: string
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** Пустая строка и отсутствующая переменная равнозначны: обе значат «не задано». */
function value(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

export function loadConfig(env: Record<string, string | undefined>): BftPluginConfig {
  const workspaceRoot = value(env, 'BFT_WORKSPACE_ROOT')
  if (!workspaceRoot) {
    throw new ConfigError(
      'BFT_WORKSPACE_ROOT не задан. Это корень воркспейса, где лежит каталог документов БФТ; ' +
        'без него плагин не знает, чьи требования показывать.',
    )
  }

  const docsPath = value(env, 'BFT_DOCS_PATH')
  return {
    workspaceRoot,
    docsPath: docsPath ?? DEFAULT_DOCS_PATH,
    // Явно заданный путь запасных не имеет: если PO назвал каталог, искать
    // где-то ещё — значит молча показать не тот воркспейс.
    docsPathFallbacks: docsPath ? [] : DOCS_PATH_FALLBACKS,
    indexPath: value(env, 'BFT_INDEX_PATH') ?? DEFAULT_INDEX_PATH,
    backlogBin: value(env, 'BFT_BACKLOG_BIN'),
    taskType: value(env, 'BFT_TASK_TYPE') ?? 'bft',
  }
}

/** Человекочитаемый разбор конфига — для диагностики при старте. */
export function describeConfig(config: BftPluginConfig): string[] {
  return [
    `воркспейс:      ${config.workspaceRoot}`,
    `документы:      ${config.docsPath}${config.docsPathFallbacks.length ? ` (запасные: ${config.docsPathFallbacks.join(', ')})` : ''}`,
    `индекс:         ${config.indexPath}`,
    `Backlog.md:     ${config.backlogBin ?? 'не задан — стадия выводится из артефактов'}`,
    `тип задач:      ${config.taskType}`,
  ]
}
