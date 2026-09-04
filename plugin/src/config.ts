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

/**
 * Бинарь Backlog.md по умолчанию.
 *
 * Умолчание живёт здесь, а не только в `cordis.patch.yml` пакета, потому что
 * слой профиля харнесса не дополняет конфигурацию пакета, а заменяет её целиком:
 * профиль обязан задать `workspaceRoot`, и в этот момент всё остальное из
 * патча пакета пропадает (проверено `dsh --profile web --dump-config`). Значение
 * в коде переживает такую замену; без него доска молча исчезала бы у всех, кто
 * настроил раздел ровно так, как написано в инструкции.
 *
 * Отсутствие бинаря в PATH не ошибка: запуск вернёт код -1, и очередь останется
 * той же, что была бы без доски.
 */
export const DEFAULT_BACKLOG_BIN = 'backlog'

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
   * Исполняемый файл Backlog.md. По умолчанию — `backlog` из PATH; значение
   * `off` отключает доску, и это штатный режим: стадия тогда выводится только
   * из артефактов самого репозитория.
   */
  backlogBin?: string
  /** Тип задач Backlog.md, который считается требованием БФТ. */
  taskType: string
  /**
   * Ветки контекстного чата entire.io. Раздел без него не поднимается: работа
   * над требованием обязана продолжаться с последнего контекста, а не начинаться
   * заново, и «не настроено» здесь означает молчаливую потерю этой истории.
   *
   * `undefined` бывает ровно в одном случае: требование снято ключом
   * `BFT_ENTIRE_REQUIRED=0`, то есть отказ от истории сделан осознанно.
   */
  entire?: EntireAccess
}

export interface EntireAccess {
  /** Базовый адрес рабочего пространства entire.io. */
  baseUrl: string
  /** Как из ветки собрать ссылку. `{branch}` подставляется. */
  branchUrlTemplate: string
}

/**
 * Форма ссылки на ветку. Вынесена отдельным ключом, а не зашита в код: точный
 * вид адреса entire.io задаёт установка, и угаданный шаблон дал бы битые
 * ссылки, которые выглядят рабочими.
 */
export const DEFAULT_ENTIRE_BRANCH_URL = '{baseUrl}/b/{branch}'

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
    backlogBin: backlogBin(env),
    taskType: value(env, 'BFT_TASK_TYPE') ?? 'bft',
    entire: entireAccess(env),
  }
}

/**
 * Доска включена, пока её не выключили явным словом.
 *
 * Пустое значение здесь не выключатель: `value` уже сводит пустую строку к
 * `undefined`, и трактовать её как отказ значило бы гасить доску от случайной
 * пустой настройки в профиле. Отказ пишется словом — как и в `BFT_ENTIRE_REQUIRED`.
 */
function backlogBin(env: Record<string, string | undefined>): string | undefined {
  const raw = value(env, 'BFT_BACKLOG_BIN')
  if (raw === undefined) return DEFAULT_BACKLOG_BIN
  return ['off', '0', 'false'].includes(raw.toLowerCase()) ? undefined : raw
}

/** Выключается только явным «0»/«false»: опечатка в значении не должна тихо снимать требование. */
function required(env: Record<string, string | undefined>): boolean {
  const raw = value(env, 'BFT_ENTIRE_REQUIRED')?.toLowerCase()
  return raw !== '0' && raw !== 'false'
}

function entireAccess(env: Record<string, string | undefined>): EntireAccess | undefined {
  const baseUrl = value(env, 'BFT_ENTIRE_BASE_URL')
  if (!baseUrl && !required(env)) return undefined
  if (!baseUrl) {
    throw new ConfigError(
      'BFT_ENTIRE_BASE_URL не задан. entire.io хранит контекстные чаты по требованиям; ' +
        'без него работа над БФТ каждый раз начинается с нуля, а прошлый контекст теряется молча. ' +
        'Задайте адрес рабочего пространства entire.io — или снимите требование ключом ' +
        'BFT_ENTIRE_REQUIRED=0, приняв, что истории работы не будет.',
    )
  }
  return {
    baseUrl: baseUrl!.replace(/\/+$/, ''),
    branchUrlTemplate: value(env, 'BFT_ENTIRE_BRANCH_URL') ?? DEFAULT_ENTIRE_BRANCH_URL,
  }
}

/** Ссылка на ветку контекстного чата. Ветки нет — ссылки нет, а не адрес в никуда. */
export function branchUrl(access: EntireAccess, branch: string | undefined): string | undefined {
  const trimmed = branch?.trim()
  if (!trimmed) return undefined
  return access.branchUrlTemplate
    .replace('{baseUrl}', access.baseUrl)
    .replace('{branch}', encodeURIComponent(trimmed))
}

/** Человекочитаемый разбор конфига — для диагностики при старте. */
export function describeConfig(config: BftPluginConfig): string[] {
  return [
    `воркспейс:      ${config.workspaceRoot}`,
    `документы:      ${config.docsPath}${config.docsPathFallbacks.length ? ` (запасные: ${config.docsPathFallbacks.join(', ')})` : ''}`,
    `индекс:         ${config.indexPath}`,
    `Backlog.md:     ${config.backlogBin || 'отключён — стадия выводится из артефактов'}`,
    `тип задач:      ${config.taskType}`,
    `entire.io:      ${config.entire?.baseUrl ?? 'требование снято — истории работы не будет'}`,
  ]
}
