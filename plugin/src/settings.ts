/**
 * Настройки раздела «Требования», которые PO правит из интерфейса харнесса, а не из строки
 * профиля: адрес формы сбора инициативы, адрес таблицы требований и промт работы с ней.
 *
 * Модуль общий для обеих половин и потому нарочно пустой на зависимости: node-половина
 * регистрирует по этим константам пространство имён настроек (`src/plugin.ts`), браузерная —
 * читает его через `ctx.settingsScope` и рисует карточку. Схема schemastery живёт в
 * `plugin-config.ts`, а не здесь: она нужна только узлу, а браузерный бандл инлайнит всё, что
 * импортирует, и потянул бы schemastery за собой без всякой пользы.
 *
 * Секретов здесь нет и быть не может: документ настроек хоста (`$DSH_HOME/settings.yaml`)
 * лежит файлом и синхронизируется между поверхностями. Токены JIRA и Confluence остаются в
 * окружении процесса — см. `toBftConfig` в plugin-config.ts.
 */

/**
 * Пространство имён настроек. Совпадает с ключом карточки в слоте `settings.plugin.item`:
 * вкладка «Плагины» сводит две ведомости — какие пространства отдаёт хост и какие карточки
 * зарегистрированы в браузере — именно по этой строке.
 */
export const BFT_SETTINGS_NS = 'bft'

/**
 * Плейсхолдер адреса таблицы внутри промта. Строкой, а не позицией в конце: PO может
 * захотеть адрес в середине фразы, и подстановка не должна зависеть от того, где он стоит.
 */
export const SHEET_PLACEHOLDER = '{sheet}'

/**
 * Промт по умолчанию. До появления настроек кнопка «Обновить» подставляла ровно
 * `/bft-needed-list` — с пустым адресом таблицы плейсхолдер вырезается и получается та же
 * строка, поэтому умолчание не меняет поведение уже настроенных воркспейсов.
 */
export const DEFAULT_SYNC_PROMPT = `/bft-needed-list ${SHEET_PLACEHOLDER}`

/** Что PO правит в разделе настроек. */
export interface BftSettings {
  /** Форма сбора требования, открывается кнопкой «+» в панели. Пусто — кнопка неактивна. */
  formUrl: string
  /** Таблица требований, подставляется в промт. Пусто — берётся BFT_INITIATIVES_SHEET_URL. */
  sheetUrl: string
  /** Промт кнопки «Обновить»; `{sheet}` заменяется адресом таблицы. */
  syncPrompt: string
}

/** Значения, с которыми раздел работает, пока PO ничего не менял. */
export const DEFAULT_SETTINGS: BftSettings = {
  formUrl: '',
  sheetUrl: '',
  syncPrompt: DEFAULT_SYNC_PROMPT,
}

/**
 * Приводит секцию настроек, пришедшую с провода, к рабочей форме.
 *
 * Секция уже проверена схемой на стороне хоста, но браузер получает её как `unknown` и
 * обязан пережить любую: документ настроек правится и руками, и с другой поверхности.
 * Неожиданный тип поля — это отсутствие значения, а не повод уронить панель.
 * @param section - секция пространства имён `bft`, как её отдал хост.
 * @returns значения с подставленными умолчаниями.
 */
export function resolveSettings(section: unknown): BftSettings {
  if (section === null || typeof section !== 'object') return DEFAULT_SETTINGS
  const raw = section as Partial<Record<keyof BftSettings, unknown>>
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' ? value.trim() : fallback
  return {
    formUrl: text(raw.formUrl, DEFAULT_SETTINGS.formUrl),
    sheetUrl: text(raw.sheetUrl, DEFAULT_SETTINGS.sheetUrl),
    // Промт не подрезается по краям целиком: многострочный текст PO может нарочно начинаться
    // с пустой строки. Пустая строка здесь означает «поле очищено» — возвращаем умолчание,
    // иначе кнопка «Обновить» открыла бы чат с пустым черновиком.
    syncPrompt: typeof raw.syncPrompt === 'string' && raw.syncPrompt.trim().length > 0
      ? raw.syncPrompt
      : DEFAULT_SETTINGS.syncPrompt,
  }
}

/**
 * Собирает черновик кнопки «Обновить».
 *
 * Три случая, и все три встречаются у живого PO: адрес известен — подставляем; адреса нет —
 * вырезаем плейсхолдер вместе с прилипшими к нему пробелами, чтобы в чат не уехала строка с
 * дырой или двойным пробелом (агент спросит адрес сам); плейсхолдера в промте нет вовсе —
 * отдаём промт как написан, ничего не дописывая от себя.
 * @param prompt - промт из настроек.
 * @param sheet - адрес таблицы: из настроек, из окружения или пустая строка.
 * @returns текст, который подставляется в композер без автоотправки.
 */
export function buildSyncDraft(prompt: string, sheet: string): string {
  const address = sheet.trim()
  if (address.length > 0) return prompt.split(SHEET_PLACEHOLDER).join(address).trim()
  // Съедаем горизонтальные пробелы по обе стороны плейсхолдера и возвращаем ровно один
  // обратно, только если он разделял два куска текста в одной строке. Переносы строк не
  // трогаем: они — разметка промта, а не отступ вокруг подстановки.
  return prompt
    .replace(/[^\S\r\n]*\{sheet\}[^\S\r\n]*/g, (match: string, offset: number, whole: string) => {
      const before = whole[offset - 1]
      const after = whole[offset + match.length]
      const textBefore = before !== undefined && !/\s/.test(before)
      const textAfter = after !== undefined && !/\s/.test(after)
      return textBefore && textAfter ? ' ' : ''
    })
    .trim()
}

/**
 * Проверяет адрес, который PO вводит в поле настроек.
 *
 * Проверяем ровно схему и разбираемость: живёт ли что-то по этому адресу и та ли это форма —
 * узнает тот, кто её откроет, а не поле ввода. Запрет на всё, кроме `http`/`https`, здесь не
 * формальность: адрес уезжает в `src` айфрейма и в `window.open`, и `javascript:` оттуда
 * выполнился бы в контексте страницы харнесса.
 * @param raw - то, что PO ввёл в поле.
 * @returns `''` — поле очищено (валидно), строка — валидный адрес, `undefined` — не адрес.
 */
export function normalizeUrl(raw: string): string | undefined {
  const value = raw.trim()
  if (value.length === 0) return ''
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return undefined
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined
}
