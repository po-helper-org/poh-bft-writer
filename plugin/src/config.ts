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

/** Умолчание Claude Code CLI: `claude` из PATH. У launchd свой PATH — профиль задаёт абсолютный путь. */
export const DEFAULT_CLAUDE_BIN = 'claude'

/**
 * Права CLI по умолчанию: правки файлов без вопросов (`acceptEdits`), скрипты
 * навыков (`python3 …/bft-lint.py`, `bft-html-export.py`), доска (`backlog`) и
 * пауза до подключения MCP (`sleep`, см. MCP_ENVIRONMENT в handoff.ts). Спросить
 * PO из неинтерактивного прогона некому, поэтому всё, что навык делает штатно,
 * разрешено заранее; остальное CLI откажет сам, и отказ виден в чате. Инструменты
 * Jira/Confluence (`mcp__<сервер>`) сюда не входят: имя сервера своё у каждой
 * установки — его добавляет профиль через `claudeArgs`.
 */
export const DEFAULT_CLAUDE_ARGS: readonly string[] = [
  '--permission-mode', 'acceptEdits',
  '--allowedTools', 'Bash(python3:*)', 'Bash(backlog:*)', 'Bash(sleep:*)',
]

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
   * Каталог рабочего пространства чатов по требованиям, относительно корня
   * воркспейса. Все чаты, которые раздел открывает по требованию, привязываются
   * к нему: агент стартует там, где лежат документы, а сессии собираются
   * отдельной группой. `undefined` — умолчание: родитель каталога документов
   * (`bft` при `bft/documentation`). Пустая строка — «не привязывать», чат в
   * текущем рабочем пространстве.
   */
  sessionPath?: string
  /**
   * Skill-root воркспейса относительно его корня — только чтобы записать
   * `skills_path` в `bft-config.md` рабочего пространства чатов. Не задан —
   * секция не пишется, навык ищет корень сам. Умолчания нет намеренно:
   * раскладку IDE-агента плагин не угадывает.
   */
  skillsPath?: string
  /**
   * Claude Code CLI для чата по требованию с детальной страницы (issue #41):
   * бинарь и аргументы прав/модели. `claudeBin: 'off'` выключает чат. Умолчания
   * живут в claude-chat.ts — по той же причине, что и `DEFAULT_BACKLOG_BIN`:
   * слой профиля заменяет конфиг пакета целиком.
   */
  claudeBin?: string
  claudeArgs: readonly string[]
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
    sessionPath: sessionPath(env),
    skillsPath: relativeInside(env, 'BFT_SKILLS_PATH'),
    claudeBin: claudeBin(env),
    claudeArgs: claudeArgs(env),
    entire: entireAccess(env),
  }
}

/** Как `backlogBin`: включён, пока не выключен словом; умолчание — `claude` из PATH. */
function claudeBin(env: Record<string, string | undefined>): string | undefined {
  const raw = value(env, 'BFT_CLAUDE_BIN')
  if (raw === undefined) return DEFAULT_CLAUDE_BIN
  return ['off', '0', 'false'].includes(raw.toLowerCase()) ? undefined : raw
}

/**
 * Аргументы CLI — через пробел, как в командной строке; кавычек и экранирования
 * нет намеренно: значения вроде `Bash(python3:*)` пробелов не содержат, а
 * разбор кавычек здесь стал бы второй оболочкой. Не задано — права по умолчанию.
 */
function claudeArgs(env: Record<string, string | undefined>): readonly string[] {
  const raw = value(env, 'BFT_CLAUDE_ARGS')
  if (raw === undefined) return DEFAULT_CLAUDE_ARGS
  return raw.split(/\s+/).filter(Boolean)
}

/**
 * Пустая строка здесь — единственный случай, когда она значит не «не задано», а
 * «выключено»: чаты по требованиям идут в текущее рабочее пространство. Путь
 * обязан лежать внутри воркспейса — иначе чаты по требованиям привязались бы к
 * чужому каталогу.
 */
function sessionPath(env: Record<string, string | undefined>): string | undefined {
  if (env.BFT_SESSION_PATH === undefined) return undefined
  if (env.BFT_SESSION_PATH.trim() === '') return ''
  return relativeInside(env, 'BFT_SESSION_PATH')
}

/** Путь относительно корня воркспейса: без ведущего `./`, хвостового `/`, абсолютных и `..`. */
function relativeInside(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = value(env, key)
  if (raw === undefined) return undefined
  const trimmed = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (trimmed === '' || trimmed.startsWith('/') || /^[A-Za-z]:/.test(trimmed) || trimmed.split('/').includes('..')) {
    throw new ConfigError(
      `${key}=«${raw}» ведёт за пределы воркспейса. Путь задаётся относительно корня воркспейса ` +
        'и не может быть абсолютным или содержать «..».',
    )
  }
  return trimmed
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
    `чаты:           ${config.sessionPath === '' ? 'в текущем рабочем пространстве' : config.sessionPath ?? 'рабочее пространство каталога документов'}`,
    `entire.io:      ${config.entire?.baseUrl ?? 'требование снято — истории работы не будет'}`,
  ]
}
