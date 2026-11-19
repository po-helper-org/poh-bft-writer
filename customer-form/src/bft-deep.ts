/**
 * bft-deep в портале (ADR-0012): полный БФТ по согласованному bft-fast.
 *
 * Стадия deep навыка рассчитана на Claude Code — подагенты, Confluence/JIRA/git
 * через MCP. В портале этих источников нет, поэтому deep здесь — фоновый прогон
 * модели портала (`ctx.llm`, тот же провайдер и ключ, что у чата):
 *  - шапка — из bft-fast байт-в-байт, минус строка-граница и «Критичные
 *    требования» (ЗМ-022, ЗМ-027); во frontmatter `stage: deep`;
 *  - канон из 11 разделов пишет модель по эталону навыка
 *    (bft-deep-swarm/examples/golden_deep_document.md); факт без источника —
 *    `[УТОЧНИТЬ]`, ID скелета сохраняются;
 *  - блок «Продолжить / уточнить БФТ» — свой шаблон портала (continueBlock):
 *    без промта Claude Code, путей навыка и адресов на 127.0.0.1 (план C8);
 *  - сводный список вопросов «Что нужно для согласования» — кодом из ячеек
 *    канона и приёма заявки (questions.ts), в deep.json, вне документа;
 *  - автоправки канона кодом (canon-check.ts autoFix), затем гейт — штатный
 *    bft-lint.py и проверки портала (canon-check.ts check): ERROR уходят модели
 *    на исправление (до трёх попыток), документ с ошибками готовым не считается;
 *    WARN и метрики — в отчёт о качестве (deep.json quality);
 *  - страница ревью — bft-html-export.py (`<slug>.html` рядом с `-fast.html`).
 */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BORDER, isoToday, type FastFiles } from './bft-fast.js'
import { anchorLine, autoFix, check, checkContext, coverageChecklist, formatFinding, REPORT_ONLY, type CheckFinding, type Intake } from './canon-check.js'
import { collectQuestions, listItems, QUESTIONS_HEAD, type OpenQuestion } from './questions.js'
import { qualityMetrics, type MetricValue } from './quality-metrics.js'
import { contentTerms, hasTerm, PROPER, subjectNoun, titleNouns, words } from './stems.js'

export { subjectNoun, titleNouns } from './stems.js'

export interface DeepFiles { md: string; html: string; state: string }

export function deepFiles(fast: FastFiles, slug: string): DeepFiles {
  return { md: join(fast.dir, `${slug}.md`), html: join(fast.dir, `${slug}.html`), state: join(fast.dir, 'deep.json') }
}

export type DeepStage = 'building' | 'ready' | 'failed'
/** Замечание линтера или проверки портала в отчёте о качестве. */
export interface QualityFinding { code: string; level: string; message: string; line?: number }
/** Отчёт о качестве сборки (план качества, C0): попытки, ошибки по попыткам, WARN, метрики. */
export interface DeepQuality {
  attempts: number
  /** ERROR bft-lint.py по попыткам. */
  lintErrorsByAttempt: number[]
  /** ERROR проверок портала (canon-check) по попыткам. */
  checkErrorsByAttempt: number[]
  /** WARN линтера и проверок портала последней попытки. */
  warnings: QualityFinding[]
  /** Что поправили автоправки последней попытки. */
  fixes: string[]
  metrics: Record<string, MetricValue>
}
export interface DeepState {
  stage: DeepStage; startedAt: string; finishedAt?: string; attempts?: number; error?: string; quality?: DeepQuality
  /** «Что нужно для согласования» (план C8): вопросы готового документа, вне канона. */
  questions?: OpenQuestion[]
}

export async function readDeepState(files: DeepFiles): Promise<DeepState | undefined> {
  return readFile(files.state, 'utf8').then((s) => JSON.parse(s) as DeepState, () => undefined)
}

export async function saveDeepState(files: DeepFiles, state: DeepState): Promise<void> {
  await writeFile(files.state, JSON.stringify(state), 'utf8')
}

/** Маршрут модели и потоковый вызов — структурно, как их отдаёт dsh-llm. */
export interface DeepRoute { provider: string; model: string }
type Chunk = { type: string; text?: string; reason?: unknown }
export interface LlmLike {
  prepareCall(config: DeepRoute & { maxTokens?: number; reasoningEffort?: string }, signal?: AbortSignal): Promise<{
    config: DeepRoute & Record<string, unknown>
    stream(options: Record<string, unknown>): AsyncIterable<Chunk>
  }>
}

const CANON_HEAD = '## Проблема которую решаем'
const CONTINUE_HEAD = '## Продолжить / уточнить БФТ'
const CRITICAL_HEAD = '### Критичные требования (скелет на цитатах)'

/**
 * Что дала разведка по корпоративным источникам (план C8) — для строки status:
 *  - fresh — свежая карта находок; previous — источник лёг, взята прошлая карта;
 *  - none — источник опрошен, находок нет; unavailable — не подключён или упал.
 */
export interface SourcesStatus { mode: 'fresh' | 'previous' | 'none' | 'unavailable'; source: string; count: number }

/** Строка status во frontmatter deep — по факту разведки, не одной фразой на все случаи. */
export function statusLine(sources?: SourcesStatus): string {
  const base = 'Черновик 0.2 (deep — собран в портале'
  switch (sources?.mode) {
    case 'fresh': return `${base}; источники: ${sources.source}, находок ${sources.count} — указатель, не фактбаза; git не подключался)`
    case 'previous': return `${base}; источники: прошлая карта находок (${sources.count}), ${sources.source} в этот раз недоступен — указатель, не фактбаза; git не подключался)`
    case 'none': return `${base}; источники: ${sources.source} опрошены, находок нет; git не подключался)`
    default: return `${base}; Confluence, JIRA и git не подключались)`
  }
}

/** Шапка deep: frontmatter со `stage: deep`, без границы и «Критичных требований». */
export function deepHead(fastMd: string, today: string, sources?: SourcesStatus): string {
  const border = fastMd.indexOf(BORDER)
  let head = (border < 0 ? fastMd : fastMd.slice(0, border)).trimEnd()
  head = head
    .replace(/^stage: .*$/m, 'stage: deep')
    .replace(/^version: .*$/m, 'version: 0.2')
    .replace(/^synced: .*$/m, `synced: ${today}`)
    .replace(/^status: .*$/m, `status: ${statusLine(sources)}`)
  const start = head.indexOf(CRITICAL_HEAD)
  if (start >= 0) {
    const next = head.indexOf('\n### ', start + CRITICAL_HEAD.length)
    head = head.slice(0, start) + (next < 0 ? '' : head.slice(next + 1))
  }
  return head.trimEnd()
}

/** Канон из ответа модели: от «Проблемы которую решаем» до блока «Продолжить». */
/** Адреса Jira и Confluence из контекста (карта находок): ими заменяем примеры линтера. */
export function linkBases(context: string): { jira?: string; confluence?: string; keys?: string[] } {
  const jira = context.match(/(https?:\/\/[^\s()]+\/browse\/)[A-Z][A-Z0-9_]+-\d+/)?.[1]
  const confluence = context.match(/(https?:\/\/[^\s()/]+)\/(?:pages|display|spaces)\//)?.[1]
  // Ключи задач, которые есть в карте находок: только им канон даёт ссылку.
  const keys = jira ? [...new Set(context.match(/\b[A-Z][A-Z0-9_]{1,15}-\d{1,7}\b/g) ?? [])] : []
  return { ...(jira ? { jira } : {}), ...(confluence ? { confluence } : {}), ...(keys.length ? { keys } : {}) }
}

/** Колонки строки markdown-таблицы (экранированный «\|» — не разделитель). */
const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).length

/**
 * Разделитель таблицы (`| --- | --- |`) с другим числом колонок, чем заголовок, —
 * модель так ошибается («Функциональные требования»: 6 в заголовке, 5 в разделителе),
 * и pandoc/marked показывают таблицу сплошным текстом. Разделитель — по заголовку.
 */
export function fixTableSeparators(text: string): string {
  const lines = text.split('\n')
  for (let i = 1; i < lines.length; i++) {
    const separator = lines[i]!
    const header = lines[i - 1]!
    if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(separator) || !header.trim().startsWith('|')) continue
    const want = tableCells(header)
    if (tableCells(separator) !== want) lines[i] = `| ${Array(want).fill('---').join(' | ')} |`
  }
  return lines.join('\n')
}

/** Канон без обёрток и хвостов (см. splitCanon). */
export function cleanCanon(text: string, bases: { jira?: string; confluence?: string; keys?: string[] } = {}): string {
  return splitCanon(text, bases).canon
}

/**
 * Канон из ответа модели и вырезанный хвост «Открытые вопросы» (план C8):
 * в документ он не идёт (RULES), но вопросы не теряются — они уходят в список
 * «Что нужно для согласования».
 */
export function splitCanon(text: string, bases: { jira?: string; confluence?: string; keys?: string[] } = {}): { canon: string; extraQuestions: string[] } {
  // Обёртка ```markdown … ``` — только вокруг всего ответа. Ленивый поиск по строкам (/m) снимал
  // закрывающую ``` у plantuml внутри канона — сценарий ломался, линтер не видел разделов (CN002).
  let body = text.replace(/^\s*```(?:markdown|md)?[ \t]*\n([\s\S]*)\n```\s*$/, '$1')
  const start = body.indexOf(CANON_HEAD)
  if (start >= 0) body = body.slice(start)
  const tail = body.indexOf(CONTINUE_HEAD)
  if (tail >= 0) body = body.slice(0, tail)
  // Правило RULES «открытые вопросы в документ не пиши» модель нарушает блоком «Открытые вопросы…»
  // (заголовок любого уровня, жирный, абзац с двоеточием и пояснением) — вопросы и так стоят [УТОЧНИТЬ] в ячейках.
  const stripped = stripOpenQuestions(body)
  body = stripped.text
  const extraQuestions = stripped.items
  // Подсказка линтера показывает ссылку на jira.example.com — модель её копирует.
  if (bases.jira) body = body.replace(/https?:\/\/jira\.example\.com\/browse\//g, bases.jira)
  if (bases.confluence) body = body.replace(/https?:\/\/confluence\.example\.com(?=\/)/g, bases.confluence)
  // Карта Кортекса ссылается на файлы памяти организации относительными путями
  // («../../DECIDE/…md»): у заказчика такая ссылка битая и раскрывает внутреннюю
  // структуру — оставляем подпись без ссылки.
  body = body.replace(/\[([^\]\n]+)\]\((?!https?:|mailto:|#)[^)\s]*\)/g, '$1')
  body = fixTableSeparators(body)
  // Голый ключ из карты находок → ссылка (bft-lint LN001). Ключ, которого в карте нет, не трогаем:
  // выдуманному ключу правдоподобная ссылка не нужна — его поймает линтер.
  if (bases.jira && bases.keys?.length) {
    const known = new Set(bases.keys)
    // Готовые markdown-ссылки пропускаем целиком: ключ в их подписи уже оформлен.
    body = body.replace(/(\[[^\]\n]*\]\([^)\s]*\))|(^|[^\w[\/-])([A-Z][A-Z0-9_]{1,15}-\d{1,7})(?![\w\]-])/g,
      (match, link: string | undefined, lead: string, key: string) => (link || !known.has(key) ? match : `${lead}[${key}](${bases.jira}${key})`))
  }
  return { canon: body.trim(), extraQuestions }
}

const OPEN_QUESTIONS = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*Открытые\s+вопросы(?![\p{L}])/iu
const RULE_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/

/**
 * Блок «Открытые вопросы…» модели (раунд 4): заголовок любого уровня, жирная
 * строка или абзац («Открытые вопросы для согласования (…):»), где бы он ни
 * стоял до хвоста, — вырезается вместе со списком и линией «---» перед ним;
 * пункты возвращаются списком. Заголовок — до следующего заголовка того же
 * или более высокого уровня; абзац — до пустой строки, за которой не пункт списка.
 */
export function stripOpenQuestions(text: string): { text: string; items: string[] } {
  const lines = text.split('\n')
  const out: string[] = []
  const block: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (!OPEN_QUESTIONS.test(line)) { out.push(line); continue }
    while (out.length && (!out.at(-1)!.trim() || RULE_LINE.test(out.at(-1)!))) out.pop()
    const level = /^\s*(#{1,6})\s/.exec(line)?.[1]!.length ?? 0
    const inline = line.replace(/\*\*|__/g, '').split(':').slice(1).join(':').trim()
    if (inline) block.push(inline)
    let j = i + 1
    if (level) {
      while (j < lines.length && !new RegExp(`^\\s*#{1,${level}}\\s`).test(lines[j]!)) block.push(lines[j++]!)
    } else {
      let list = false
      while (j < lines.length) {
        const l = lines[j]!
        if (!l.trim()) {
          const next = lines.slice(j + 1).find((x) => x.trim())
          if (next !== undefined && LIST_ITEM.test(next)) { j++; continue }
          break
        }
        if (/^\s*(?:#{1,6}\s|\||```)/.test(l) || (list && !LIST_ITEM.test(l) && !/^\s{2,}\S/.test(l))) break
        if (LIST_ITEM.test(l)) list = true
        block.push(l)
        j++
      }
    }
    while (j < lines.length && (!lines[j]!.trim() || RULE_LINE.test(lines[j]!)) && (j + 1 >= lines.length || !lines.slice(j).some((x) => x.trim() && !RULE_LINE.test(x)))) j++
    if (out.length && j < lines.length) out.push('')
    i = j - 1
  }
  return { text: out.join('\n'), items: listItems(block.join('\n')) }
}

/** Разделы канона по порядку — один список для RULES и хвоста «Продолжить». */
export const CANON_SECTIONS = [
  'Проблема которую решаем',
  'Изменение в UJM',
  'План демонстрации',
  'Бизнес-Требования',
  'Ценность разрабатываемого функционала для бизнес-заказчиков*',
  'Пользовательские требования*',
  'Требования к интерфейсам*',
  'Макеты интерфейса*',
  'Функциональные требования*',
  'Нефункциональные требования*',
  'Зависимости',
  'Риски',
  'Якоря истины',
] as const

/**
 * Блок «Продолжить / уточнить БФТ» для документа портала (план C8) — свой
 * шаблон, не срез эталона навыка: в портале нет чата с PO, куда «ушли бы»
 * вопросы, а промт Claude Code с путями навыка и командой /bft-deep читателю
 * документа (заказчику, заявке) не нужен. `request` — «заявка #N», ссылкой
 * только на публичную страницу портала (requestRef).
 */
export function continueBlock(request: string, today: string): string {
  return [
    CONTINUE_HEAD,
    '',
    `Корпоративный канон собран в портале ${today} по заявке: ${request}.`,
    `Открытые точки помечены \`[УТОЧНИТЬ]\` в ячейках; сводный список — в блоке «${QUESTIONS_HEAD}» на странице заявки.`,
    '',
    `Разделы канона по порядку: ${CANON_SECTIONS.map((t) => t.replace(/\*$/, '')).join(' → ')}.`,
    'Уточнение — ответ в ячейке с [УТОЧНИТЬ]: новые ID добавляются в конец своей таблицы, существующие не перенумеровываются, шапка не переписывается.',
  ].join('\n')
}

/** Канон эталона — образец формы для модели (без шапки и блока «Продолжить»). */
export function goldenCanon(golden: string): string {
  return cleanCanon(golden)
}

const RULES = `Ты — аналитик, который доводит первичные требования (bft-fast) до полного БФТ по корпоративному канону.

Напиши ТОЛЬКО канон — markdown, начиная строкой «${CANON_HEAD}». Шапку, frontmatter и блок «Продолжить / уточнить БФТ» не пиши: их добавит система.

Разделы канона — ровно эти, в этом порядке, заголовки второго уровня дословно:
${CANON_SECTIONS.map((t) => `## ${t}`).join('\n')}

Правила:
- Корпоративные находки (Jira/Confluence) — указатель, не фактбаза. «Ссылку для БФТ» находки (дословно, markdown) ставь только рядом с утверждением, которое в этой находке прямо написано про тот же объект и то же действие. Общее слово (система, команда, согласование) — не основание. Нет такой находки — без ссылки, [УТОЧНИТЬ у {адресат}: …]. Ключи и адреса без markdown-ссылки не пиши; адреса — только из контекста, домены example.com не используй.
- Каждая находка карты несёт вердикт триажа («Отношение к заявке»), тип, статус и строку «→» — её место в БФТ. Сверяй по сути: тот же актор, тот же объект, та же система — а не общие слова. По вердикту: решение того же действия («та же функция», страница или закрытая задача) — сверь с ASIS: слова заказчика не меняй, в «Было» шага UJM, который оно описывает, после них — «По {ссылка}: {кратко}»; если оно уже работает и пересекается с заявкой — строка «Рисков» «Пересечение с решением {ссылка}: расширяем, заменяем или строим отдельно» с [УТОЧНИТЬ у PO] в оценках; требование, которое оно уже покрывает, не пиши как новое — только отличие. Предпосылка («та же система», другое действие, на которое заявка опирается) — строка «Зависимостей» «Опирается на {ссылка}: {факт}». Открытые эпик/история/задача того же объекта — «Зависимости»: «Параллельная работа: сверить объём — {ссылка}», не риск. Открытая «Ошибка» той же функции — строка «Рисков» со ссылкой; слово «дефект» — только для неё; закрытая «Ошибка» — только «Якоря» R2. «Смежное» — не больше строки «Якорей» R2, в текст БФТ не переносится. «Не относится» — не упоминай. Находка без факта про объект заявки ничего не доказывает — не ставь её ради ссылки.
- Одна находка — одна ссылка: при первом упоминании и в «Якорях»; дальше — её ключ или название без ссылки и без пересказа. Находку называй только её «Ссылкой для БФТ», не словами («корпоративная находка», её название в кавычках). Число или ограничение из факта находки (период, лимит, формат) пиши в «Параметрах» со ссылкой, а не [УТОЧНИТЬ]. Строка «что если», на которую прямо отвечает факт находки, — «Есть источник?»: «Частично — {ссылка}», а не «Нет». Ветку alt/else сценария пиши только с тем, что видит актор по словам заказчика, How to demo или находке; иначе её результат — [УТОЧНИТЬ у {адресат}: что видит {актор}?]; свой сценарий источником «что если» не называй. ФТ, который закрывает такую ветку, называется «Поведение при …», а его описание без источника — только [УТОЧНИТЬ у {адресат}: что видит {актор} и что происходит с данными?]: статусы, причины отказа и обходные пути не придумывай. Зрелость решения («работает», «внедрено», «существующее») пиши, только если так сказано в находке (её статус или текст); иначе — «описано в {ссылка} (статус в источнике: …)».
- Находка с пометкой о давности — основание для утверждения о текущем процессе только с оговоркой «по состоянию на {год}, актуальность [УТОЧНИТЬ]»; есть более свежая о том же — опирайся на неё.
- Карта контекста (Кортекс) — память организации: что уже известно об окружении заявки (системы и интеграции, процессы, домены и контрагенты, владельцы, термины, прошлые БФТ). Опирайся на неё, а не начинай с чистого листа, — только на узлы про объект заявки, остальные игнорируй: (1) система или интеграция из карты, которой касается заявка, — строка «Зависимостей» «Затрагивает {система} (по памяти организации): {что о ней известно из карты}; где проверить: {из карты или [УТОЧНИТЬ у владельца]}»; (2) адресат [УТОЧНИТЬ у …] — владелец, команда или человек из карты, отвечающий за этот предмет; (3) сокращения и термины — расшифровка из раздела «Термины» карты; (4) прошлый БФТ по теме, пересекающийся с заявкой, — строка «Зависимостей» «Связано с прошлым БФТ «{название}» (по памяти организации): {в чём пересечение}». Факты карты — не слова заказчика и не находки: в ASIS и «Было» не переноси, требований из них не заводи, ссылок к ним не ставь, в «Якоря» не выноси. Идентификаторы узлов (sys-…, team-…) и файлы памяти не упоминай.
- Источник фактов — только документ bft-fast и контекст заявки ниже. Факт без источника — \`[УТОЧНИТЬ у {кого}: …]\` в ячейке, не выдумывай. Цифр, систем, сроков и метрик, которых нет в источнике, не добавляй. Слова заказчика о том, как сейчас («уходит до недели»), — не целевой порог НФТ. Приём заявки — переписка с заказчиком, не встреча: не пиши «на встрече», «PO подтвердил», «в работе», «согласовано», если этого нет в источнике. Образец формы ниже — чужой проект: его фразы не переноси.
- ASIS и «Было (As-Is)» — только дословные слова из блока «Слова заказчика» (в «Было» шага UJM — только та часть, которая про этот шаг, без новых фактов) или находка по правилу о решении того же действия («По {ссылка}: …»). Иначе ячейка — ровно \`[ASIS не озвучен]\`, без пояснений.
- «Ограничения и договоренности» шапки — исключения и договорённости заказчика; источником неизвестного их не называй. Открытые вопросы приёма — не решения заказчика: [УТОЧНИТЬ] в ячейке, которую они блокируют.
- Деталь сценария, которая есть в списке допущений ассистента, — не R3: в To-Be и требованиях — [УТОЧНИТЬ]. Акторы «Плана демонстрации» — из блока «Акторы (со слов заказчика)», если он есть; сокращения расшифровывай по глоссарию. «ДЛЯ КОГО» — конечные пользователи результата; заказчик, подавший заявку, — не персона: не пиши его туда, если он сам не пользуется результатом.
- Покрытие. ID из «Критичных требований» сохраняй (БТ-1 там = БТ-1 здесь); смысл ID сохраняется, формулировку подними до наблюдаемого результата. Номера ID — с 1 в каждом типе, без нулей и повторов. ID скелета не переиспользуй под другое требование: новое — под следующим свободным номером своего типа. Новое требование заводи следующим номером только из одного из четырёх оснований: результат шага How to demo (после «→»), ветка-отклонение сценария приёмки, ID скелета, находка со ссылкой. Видимое поведение системы (статус, уведомление, маршрут, отказ) — ФТ; то, что пользователь видит на экране, — ИТ; у каждого человеческого актора есть ПТ. Новое требование повторяет только сказанное в шаге или источнике; детали — [УТОЧНИТЬ у {адресат}: …] в «Параметрах», приоритет с пометкой «(предварительно)».
- Строка «что если» — гипотеза, не требование. С «Нет» она оставляет [УТОЧНИТЬ у {адресат}: …?] в «Результате» и ФТ под себя не заводит (вопрос попадёт в список «Что нужно для согласования»); ссылается «(см. ФТ-N)» только на ФТ, который уже есть по одному из четырёх оснований, или «(см. «Зависимости»)», если там есть строка про тот же предмет. Пункт, озвученный заказчиком, не называй в других разделах «не подтверждённым заказчиком» — пиши, кто и что должен подтвердить.
- «Связанные требования» указывают вверх: ПТ и ФТ → БТ; ИТ → ПТ того же актора, который он обслуживает (нет такого ПТ — БТ); ФТ → ПТ/ИТ, которые реализует; НФТ → ФТ/ПТ, которые ограничивает. Только ID, которые есть в документе. Ссылка «(см. ФТ-N)» — только на строку, где этот предмет действительно описан.
- TOBE в «Проблеме» — одна фраза итога и список ID. «Стало» в UJM — что меняется для пользователя в этой точке и ID в скобках, без пересказа демо.
- «План демонстрации»: подраздел «### Акторы» — таблица с колонкой «Актор»; подраздел «### Сценарий приёмки (happy path + alt)» — непустой блок \`\`\`plantuml с веткой alt (что видит заказчик, если что-то пошло не так). Сценарий — по How to demo из шапки: все шаги How to demo — на основной линии или в первой ветке alt; else и следующие ветки — только отклонения. Системы, которые заказчик назвал в видении (SMART A), остаются участниками своих шагов.
- Высота БФТ. Участники plantuml — акторы из «Акторов», то, что они видят (сайт, приложение, письмо, раздел портала), и внешние системы, на которые действует ФТ (учётная система, внешний источник данных, система партнёра), — каждая целиком, названием продукта, со своим шагом сценария, результат которого видит актор. Не убирай такую систему со схемы ради «высоты»: убираются только внутренние сервисы, потоки, очереди, топики. Внутренние сервисы, потоки, очереди и вызовы между ними не рисуй — сверни в участника с названием продукта; стрелка между двумя не-акторами — только если её результат виден актору. ФТ — наблюдаемое поведение для актора или бизнеса; имена сервисов, потоков, топиков и хранилищ — только в «Зависимостях». Видение заказчика (SMART A) — гипотеза для SA: в ФТ — результат, механизм — в «Зависимости». Без API-контрактов, схем БД и кода.
- «Функциональные требования*»: третья колонка — «Приоритет»; описание — наблюдаемый результат (что меняется, для кого, как проверить на демо), не пересказ слов заказчика; «Параметры, ограничения» — условие приёмки и граничные случаи (со ссылкой на строку «что если»); неизвестный порог — [УТОЧНИТЬ у {адресат}: …], числа не придумывай. Приоритет без пометки — только если его назвал заказчик; иначе «Высокий (предварительно)» для ФТ, без которого не проходит How to demo, «Средний (предварительно)» для остальных, или [УТОЧНИТЬ у PO].
- «Риски» — только таблица: риск, который назвал заказчик, открытая «Ошибка» той же функции и пересечение с работающим решением того же действия — со ссылкой; находка «та же система», эпик, история или задача — не риск, а строка «Зависимостей»; прозу в раздел не пиши, свои гипотезы рисков и митигации не пиши (митигация без источника — [УТОЧНИТЬ у PO: …?]). Вероятность и Влияние — только если их назвал источник, иначе [УТОЧНИТЬ у PO]. Пункты «Проработать»/«Согласования» шапки — строки «Зависимостей»; неизвестный бизнес-параметр — [УТОЧНИТЬ] в ячейке требования, которое он блокирует. Рисков нет — одна строка «Риски заказчиком не названы.» без таблицы.
- Маркер — [УТОЧНИТЬ у {адресат}: {что именно нужно}?]. Адресат — кто может ответить: бизнес-параметры (размеры, сроки, метрики, правила для пользователя) — заказчик или PO; работа системы и интеграций (доступ, сбои, форматы) — команда из «Команд» шапки или владелец из списка «Владельцы систем»; юридическое — юристы. Одна открытая точка — один маркер в самой профильной строке, в остальных — ссылка на её ID.
- «Якоря истины»: строки R3 по ID «Критичных требований» добавит система — их не пиши. Ты пишешь: R2 — по строке на каждую находку, которую процитировал ссылкой в тексте (факт | {ссылка}: «дословная цитата факта» | R2 | Jira или Confluence); R3 для требования, которое описывает шаг How to demo, — источник «{R3-якорь}: сценарий приёмки, шаг N — «{результат шага}»»; требование без источника — строка с рангом «—» и [УТОЧНИТЬ у …] в «Типе». Тип — из словаря: «Решение заказчика», «Jira», «Confluence», «[УТОЧНИТЬ у …]». Не ссылайся на «Критичные требования», «Summary», шапку bft-fast, карту контекста. Нерелевантные находки не упоминай.
- В ячейках таблиц — одна короткая формулировка, без HTML (<br>, <ul>, <li>), без пустых строк-заглушек. Эмодзи в каноне не используй.
- Разделы «Бизнес описание», «Общая информация», «Заинтересованные стороны», «История изменений», «Критерии успеха», «Ключевые решения», «Вводные для разрабатываемого функционала» не заводи. Открытые вопросы в документ не пиши — только [УТОЧНИТЬ] в ячейках.
- Пиши по-русски, коротко и проверяемо.`

/** Прошлая попытка для повтора: канон, ошибки (ERROR) и замечания (WARN, не больше 10 строк). */
export interface PreviousAttempt { canon: string; errors: string; warnings?: string }

/**
 * Промт сборки канона. `anchor` — R3-якорь, который код собрал из primary.json
 * и approval.json (план C6): модель видит, кем и когда согласовано; строки R3
 * по ID скелета в «Якоря истины» вставляет autoFix, R3 по шагам How to demo,
 * R2 и вопросы пишет модель.
 */
export function deepPrompt(golden: string, fastMd: string, context: string, lintErrors?: PreviousAttempt, anchor?: string): { system: string; user: string } {
  const system = `${RULES}\n\nОбразец формы канона (другой проект — бери структуру таблиц и стиль, не факты):\n\n${goldenCanon(golden)}`
  const parts = [
    'Документ bft-fast (первичные требования, согласованы заказчиком). Таблица «Критичные требования» — только вход: в итоговом документе её не будет; не ссылайся на неё.',
    fastMd,
    anchor ? `R3-якорь: ${anchor}` : '',
    context.trim() ? `Контекст заявки:\n${context.trim()}` : '',
  ]
  // Чек-лист покрытия (раунд 4) — только в первой попытке: на повторе пробелы приходят строками CV001/CV005.
  const checklist = lintErrors ? [] : coverageChecklist(fastMd)
  if (checklist.length) parts.push(`Чек-лист покрытия (из How to demo; каждый пункт закрой требованием, которое пишешь сам — своими словами, наблюдаемым результатом, без пересказа пункта):\n${checklist.map((c) => `- ${c}`).join('\n')}`)
  if (lintErrors) {
    const warnings = lintErrors.warnings?.trim() ? `\n\nЗамечания (исправь, если это не противоречит правилам):\n${lintErrors.warnings.trim()}` : ''
    parts.push(`Прошлая версия канона не прошла проверку шаблона (bft-lint.py). Исправь ошибки и выдай канон целиком заново.\n\nОшибки:\n${lintErrors.errors}${warnings}\n\nПрошлая версия:\n${lintErrors.canon}`)
  }
  return { system, user: parts.filter(Boolean).join('\n\n') }
}

const QUERIES_PROMPT = `Ты помогаешь найти в корпоративных Jira и Confluence материалы, связанные с заявкой: эпики, задачи, страницы требований и интеграций.
Дай от 3 до 5 поисковых запросов по-русски, каждый 1–4 слова.
Каждый запрос содержит предмет заявки (главное существительное названия: объект или процесс) или имя системы/продукта, названного в заявке. Запрос только из процессных слов (согласование, маршрут, руководитель, интеграция, заказ, портал) запрещён.
Один запрос — о том, как предмет заявки оформляется сейчас.
Ответ — JSON-массив строк.`

/**
 * Предмет заявки для разведки: название, системы из строки «Команды:» шапки
 * fast и объект — главное существительное названия (subjectNoun): то, что
 * заявка меняет, а не платформа, на которой она работает.
 */
export interface ReconSubject { title: string; systems: string[]; object?: string }

export function reconSubject(fastMd: string): ReconSubject {
  const head = fastMd.split(BORDER)[0]!
  const title = head.match(/^# \[БФТ\][^:]*:\s*(.+)$/m)?.[1]?.trim() ?? ''
  const teams = head.match(/Команды:\s*([^·|\n]+)/)?.[1] ?? ''
  const systems = [...new Set(teams.split(/[,;]/).map((t) => t.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()).filter((t) => t.length >= 2 && !/^\[?УТОЧНИТЬ/i.test(t)))]
  const object = subjectNoun(title)
  return { title, systems, ...(object ? { object } : {}) }
}

const PREPOSITION = /^(?:в|во|на|за|по|через|для|из|от|до|при|без|с|со|к|о|об|и|или)$/i

/**
 * Короткие запросы по именам из названия (раунд 4): «слово + имя» («{объект}
 * {Продукт}») для каждого имени, перед которым стоит содержательное слово, и
 * пара имён, если их два. Длинное название целиком в JQL ищет все слова
 * сразу и теряет эпики про тот же поток, где этих слов нет.
 */
export function nameQueries(title: string): string[] {
  const tokens = title.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean)
  const names = tokens.filter((w) => PROPER.test(w))
  const out: string[] = []
  tokens.forEach((w, i) => {
    if (!PROPER.test(w) || i === 0) return
    const prev = tokens[i - 1]!
    if (!PROPER.test(prev) && !PREPOSITION.test(prev) && prev.length >= 4 && contentTerms([prev]).length) out.push(`${prev} ${w}`)
  })
  if (names.length >= 2) out.push(`${names[0]} ${names[1]}`)
  return [...new Set(out)]
}

/** Имена продуктов/систем: из названия, затем из «Команд» (латиница, аббревиатуры, «1С:ЗУП»), без повторов. */
export function systemNames(subject: ReconSubject): string[] {
  const tokens = [subject.title, ...subject.systems].flatMap((t) => t.split(/\s+/)).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
  const out: string[] = []
  for (const w of tokens) {
    if (!w || !PROPER.test(w) || contentTerms([w]).length === 0) continue
    if (!out.some((o) => o.toLowerCase() === w.toLowerCase())) out.push(w)
  }
  return out
}

/**
 * Ядро запросов разведки (раунд 5) — детерминированно, без модели: «объект
 * + система» по два слова для каждой названной системы (до трёх); систем
 * одна или нет — ещё «второе существительное + система». Объект — то, что
 * заявка меняет: запросы только по платформе тонут в её страницах и
 * вытесняют находки о самом действии.
 */
export function coreQueries(subject: ReconSubject): string[] {
  const nouns = titleNouns(subject.title)
  const object = subject.object ?? nouns[0]
  if (!object) return []
  const systems = systemNames(subject)
  const out = systems.slice(0, 3).map((s) => `${object} ${s}`)
  const second = nouns.find((n) => n.toLowerCase() !== object.toLowerCase())
  if (second && systems.length === 1) out.push(`${second} ${systems[0]}`)
  return out
}

/**
 * Запросы модели → запросы разведки: первым — голое название, за ним — ядро
 * (coreQueries), затем запросы модели. Запрос модели без якоря (термина
 * названия или системы) получает предмет; запрос только о платформе (есть
 * имя системы, нет объекта) — не больше одного; дубли — вон, не больше шести.
 * Ядро модель не вытесняет: оно стоит до её запросов.
 */
export function fixQueries(raw: string[], subject: ReconSubject): string[] {
  const anchors = contentTerms([subject.title, ...subject.systems])
  const noun = subject.object ?? subjectNoun(subject.title)
  const objectTerms = noun ? contentTerms([noun]) : []
  const names = contentTerms(systemNames(subject))
  const out: string[] = []
  let platformOnly = 0
  const add = (query: string, fromModel = false) => {
    const q = query.replace(/\s+/g, ' ').trim()
    if (q.length < 2 || out.some((o) => o.toLowerCase() === q.toLowerCase()) || out.length >= 6) return
    if (fromModel && objectTerms.length) {
      const set = words(q)
      const platform = !objectTerms.some((t) => hasTerm(set, t)) && names.some((t) => hasTerm(set, t))
      if (platform && platformOnly++ >= 1) return
    }
    out.push(q)
  }
  if (subject.title) add(subject.title)
  for (const q of coreQueries({ ...subject, ...(noun ? { object: noun } : {}) })) add(q)
  // Пары из названия — только с объектом: «{признак} {Платформа}» — запрос о платформе, не о заявке.
  for (const q of nameQueries(subject.title).filter((q) => !objectTerms.length || objectTerms.some((t) => hasTerm(words(q), t))).slice(0, 2)) add(q)
  for (const query of raw) {
    const set = words(query)
    const anchored = anchors.length === 0 || anchors.some((term) => hasTerm(set, term))
    add(anchored || !noun ? query : `${query} ${noun}`, true)
  }
  return out
}

/** Поисковые запросы по заявке для источников данных; модель не ответила — название заявки. */
export async function searchQueries(llm: LlmLike, route: DeepRoute, fastMd: string, signal: AbortSignal): Promise<string[]> {
  const subject = reconSubject(fastMd)
  let raw: string[] = []
  try {
    const text = await generate(llm, route, { system: QUERIES_PROMPT, user: fastMd.split(BORDER)[0]!.slice(0, 12_000) }, signal, 400)
    const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as unknown
    raw = Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string' && q.trim().length > 1).map((q) => q.trim()).slice(0, 6) : []
  } catch (e) {
    console.error('[customer-form] запросы к источникам не составились:', e)
  }
  return fixQueries(raw, subject)
}

/** Находка для триажа — структурно, как её отдаёт data-sources (TriageItem). */
export interface TriageItem { ref: string; kind: 'jira' | 'confluence'; title: string; type: string; status?: string; text: string }
export type Relevance = 'same_system' | 'same_function' | 'adjacent' | 'unrelated'
export interface TriageVerdict { ref: string; relevance: Relevance; facts?: { fact: string; quote: string }[] }

const TRIAGE_PROMPT = `Ты сверяешь находки из корпоративных Jira и Confluence с заявкой. Для каждой находки реши, чем она приходится заявке:
- same_system — про ту же систему или продукт, который меняет заявка;
- same_function — про то же действие пользователя или ту же функцию (в той же или другой системе);
- adjacent — соседняя тема: та же область, но другое действие или другой продукт;
- unrelated — совпали только слова, к заявке не относится.
same_function — только про то, что заявка меняет (её цель S, новое в TO-BE): то же действие с тем же объектом. Ошибка или задача про это действие — same_function, даже если причина в другом месте.
Шаг, через который заявка только проходит и который она не меняет (платформа, существующая покупка, вход, каталог — то, на что заявка опирается), — same_system, не same_function, даже если в How to demo есть такой шаг: это предпосылка, а не другое решение той же задачи.
Эпик или задача (в работе или в плане), которые меняют тот же поток данных или тот же объект заявки (те же заказы, заявления, документы того же продукта) другим способом, — same_system, не adjacent: это параллельная работа, её сверяют. Страница требований или описание процесса того же действия (из цели заявки) — same_function, даже если решение там только описано.
Для same_system, same_function и adjacent выпиши до четырёх фактов, полезных для требований: как устроено сейчас, что уже сделано или ломалось, какие ограничения, кто отвечает. Каждый факт — с дословной цитатой из текста находки: копируй символ в символ, 5–25 слов. Нет цитаты — нет факта. Ничего не додумывай; тип и статус задачи бери из её строки, а не из текста.
Ответ — только JSON-массив, по элементу на находку: [{"ref": "<ref находки>", "relevance": "same_system|same_function|adjacent|unrelated", "facts": [{"fact": "...", "quote": "..."}]}].`

/** Шапка fast до скелета — суть заявки для триажа. */
function fastSummary(fastMd: string): string {
  const head = fastMd.split(BORDER)[0]!
  const cut = head.indexOf('### Критичные требования')
  return (cut < 0 ? head : head.slice(0, cut)).replace(/^---[\s\S]*?\n---\n/, '').trim().slice(0, 3000)
}

/** Триаж находок разведки одним дешёвым вызовом модели; ответ не разобрался — ошибка (карта без вердиктов). */
export async function triageFindings(llm: LlmLike, route: DeepRoute, fastMd: string, items: TriageItem[], signal: AbortSignal): Promise<TriageVerdict[]> {
  if (!items.length) return []
  const user = [
    `Заявка:\n${fastSummary(fastMd)}`,
    'Находки:',
    ...items.map((item) => `### ref: ${item.ref}\n${item.kind === 'jira' ? 'Jira' : 'Confluence'} · ${item.title}\nТип: ${item.type}${item.status ? ` · Статус: ${item.status}` : ''}\n${item.text || '(текста нет)'}`),
  ].join('\n\n')
  const text = await generate(llm, route, { system: TRIAGE_PROMPT, user }, signal, 6000)
  const parsed = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? 'null') as unknown
  if (!Array.isArray(parsed)) throw new Error('триаж: ответ модели — не JSON-массив')
  return parsed.filter((v): v is TriageVerdict => !!v && typeof v === 'object' && typeof (v as TriageVerdict).ref === 'string' && typeof (v as TriageVerdict).relevance === 'string')
}

/**
 * Карта находок для модели: без хвоста «Отсеяно триажем» (его видят PO и
 * проверки, не модель) и без «Ссылки для БФТ» у находок без вердикта и
 * найденных вторым шагом — они не основание утверждений, копировать модели
 * нечего. Смежная (вердикт триажа) ссылку сохраняет: её место — строка R2
 * «Якорей» (раунд 6). В sources.md (для PO и проверок) строки остаются.
 */
export function sourcesForModel(sourcesMd: string): string {
  const cut = sourcesMd.indexOf('\n## Отсеяно триажем')
  const head = cut < 0 ? sourcesMd : `${sourcesMd.slice(0, cut).trimEnd()}\n`
  if (!/\n## (?:Смежные и без вердикта|Связанные \(через )/.test(head)) return head
  let pointer = false
  let related = false
  return head.split(/\n(?=## )/).map((block) => {
    if (/^## Про ту же систему/.test(block)) { pointer = false; related = false }
    if (/^## Смежные и без вердикта/.test(block)) { pointer = true; related = false }
    if (/^## Связанные \(через /.test(block)) { pointer = true; related = true }
    const adjacent = !related && /^Отношение к заявке:\s*смежное\s*$/m.test(block)
    return pointer && !adjacent ? block.split('\n').filter((l) => !l.startsWith('Ссылка для БФТ:')).join('\n') : block
  }).join('\n')
}

/**
 * Уровень рассуждений при сборке документа: PORTAL_DEEP_REASONING, иначе off для
 * Z.AI Coding Plan — GLM-5 с рассуждениями тратит весь лимит вывода на них и
 * не успевает написать документ (живой E2E, ADR-0016). Другим моделям — их умолчание:
 * уровень, которого модель не объявила, pi-ai отклоняет.
 */
export function deepReasoning(route: DeepRoute, env = process.env): string | undefined {
  if (env.PORTAL_DEEP_REASONING) return env.PORTAL_DEEP_REASONING
  return route.provider === 'zai-coding' ? 'off' : undefined
}

/**
 * Один вызов модели: текст ответа целиком. Пустой ответ (модель ушла в
 * рассуждения до лимита, поток оборвался) переспрашивается один раз; ошибка
 * говорит, почему пусто: причина завершения, объём рассуждений, расход токенов.
 */
export async function generate(llm: LlmLike, route: DeepRoute, prompt: { system: string; user: string }, signal: AbortSignal, maxTokens = 32_000): Promise<string> {
  let why = ''
  const effort = deepReasoning(route)
  for (let attempt = 1; attempt <= 2; attempt++) {
    const call = await llm.prepareCall({ ...route, maxTokens, ...(effort ? { reasoningEffort: effort } : {}) }, signal)
    let text = ''
    let reasoning = 0
    let finish: unknown
    let usage: unknown
    for await (const chunk of call.stream({
      ...call.config,
      system: prompt.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
      signal,
    })) {
      if (chunk.type === 'text-delta' && chunk.text) text += chunk.text
      else if (chunk.type === 'reasoning-delta' && chunk.text) reasoning += chunk.text.length
      else if (chunk.type === 'finish') finish = chunk.reason
      else if (chunk.type === 'usage') usage = (chunk as { usage?: unknown }).usage
    }
    if (text.trim()) return text
    why = `finish: ${JSON.stringify(finish ?? null)}, рассуждений ${reasoning} знаков, токены ${JSON.stringify(usage ?? null)}`
    console.error(`[customer-form] ${route.provider}/${route.model}: пустой ответ (попытка ${attempt}; ${why})`)
  }
  throw new Error(`модель вернула пустой ответ (${why})`)
}

function python(script: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('python3', [script, ...args], { timeout: 60_000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 127) : 0
      resolve({ code, out: `${stdout}${stderr}`.trim() || (error?.message ?? '') })
    })
  })
}

export interface DeepInput {
  /** Начало сборки, если портал отметил его раньше (разведка по источникам — до сборки). */
  startedAt?: string
  llm: LlmLike
  route: DeepRoute
  skillsPath: string
  fast: FastFiles
  slug: string
  /** «заявка #N» для хвоста «Продолжить»: ссылкой только на публичную страницу портала (requestRef). */
  request: string
  /** Что дала разведка — строка status во frontmatter. */
  sources?: SourcesStatus
  /** Описание заявки и прочий контекст для модели (не попадает в документ). */
  context: string
  /** Карта находок разведки (sources.md) — для проверок портала и метрик. */
  sourcesMd?: string
  /** Карта контекста (Кортекс) — только для метрик (источник токенов). */
  contextMd?: string
  /** Сколько шла разведка по источникам — в метрики. */
  reconMs?: number
  attempts?: number
  timeoutMs?: number
}


/** Замечания bft-lint.py (--format json); не разобрался вывод — одна ошибка с текстом. */
async function lintDoc(script: string, path: string): Promise<{ findings: QualityFinding[]; raw: string }> {
  const lint = await python(script, ['--format', 'json', path])
  try {
    const report = JSON.parse(lint.out) as Record<string, QualityFinding[]>
    return { findings: Object.values(report).flat(), raw: lint.out }
  } catch {
    return { findings: lint.code === 0 ? [] : [{ code: 'LINT', level: 'ERROR', message: lint.out.slice(0, 2000) }], raw: lint.out }
  }
}

/** ERROR проверок портала, которые на последней попытке не валят сборку, а остаются замечанием в отчёте. */
export const SOFT_ON_LAST: ReadonlySet<string> = new Set(['CV001', 'CV005', 'CT003', 'UML001', 'SK002'])

/** Не больше 10 строк замечаний в промт повтора. */
const warningLines = (warnings: QualityFinding[]) => warnings.filter((w) => !REPORT_ONLY.has(w.code)).slice(0, 10).map(formatFinding).join('\n')

/**
 * Собрать deep: шапка + канон модели + «Продолжить», автоправки, линтер и
 * проверки портала с повторами, страница ревью. Повтор — только на ERROR
 * (линтера или canon-check); WARN — в отчёт о качестве и в промт повтора.
 * Состояние и отчёт о качестве — в deep.json (переживает рестарт).
 */
export async function buildDeep(input: DeepInput): Promise<DeepState> {
  const files = deepFiles(input.fast, input.slug)
  const startedAt = input.startedAt ?? new Date().toISOString()
  await saveDeepState(files, { stage: 'building', startedAt })
  const signal = AbortSignal.timeout(input.timeoutMs ?? 15 * 60_000)
  const lintErrorsByAttempt: number[] = []
  const checkErrorsByAttempt: number[] = []
  let warnings: QualityFinding[] = []
  let fixes: string[] = []
  let fastMd = ''
  let questions: OpenQuestion[] | undefined
  const quality = async (attempts: number, stage: DeepStage): Promise<DeepQuality> => {
    const doc = await readFile(files.md, 'utf8').catch(() => '')
    const primary = await readFile(input.fast.primary, 'utf8').then((t) => JSON.parse(t) as unknown, () => undefined)
    const intake = await readIntake(input.fast)
    const golden = await readFile(join(input.skillsPath, 'bft-deep-swarm/examples/golden_deep_document.md'), 'utf8').then(goldenCanon, () => undefined)
    const report = qualityMetrics({
      doc, fastMd, sourcesMd: input.sourcesMd ?? '', contextMd: input.contextMd ?? '', primary, ...(intake ? { intake } : {}), ...(golden ? { golden } : {}),
      quality: { attempts, lintErrorsByAttempt, checkErrorsByAttempt, warnings, ...(questions ? { questions } : {}) }, stage,
      ...(input.reconMs !== undefined ? { reconMs: input.reconMs } : {}),
    })
    return { attempts, lintErrorsByAttempt, checkErrorsByAttempt, warnings, fixes, metrics: report.metrics }
  }
  let attempt = 0
  try {
    fastMd = await readFile(input.fast.md, 'utf8')
    const golden = await readFile(join(input.skillsPath, 'bft-deep-swarm/examples/golden_deep_document.md'), 'utf8')
    const date = isoToday()
    const head = deepHead(fastMd, date, input.sources)
    const tail = continueBlock(input.request, date)
    const lintScript = join(input.skillsPath, 'bft-writer/scripts/bft-lint.py')
    const intake = await readIntake(input.fast)
    const anchor = await anchorOf(input.fast, input.slug)
    const primary = await readFile(input.fast.primary, 'utf8').then((t) => JSON.parse(t) as unknown, () => undefined)
    const ctx = checkContext({ fastMd, sourcesMd: input.sourcesMd ?? '', anchor, golden: goldenCanon(golden), ...(intake ? { intake } : {}), ...(primary ? { primary } : {}) })
    const max = input.attempts ?? 3
    let previous: PreviousAttempt | undefined
    for (attempt = 1; attempt <= max; attempt++) {
      const split = splitCanon(await generate(input.llm, input.route, deepPrompt(golden, fastMd, input.context, previous, anchor), signal), linkBases(input.context))
      const fixed = autoFix(split.canon, ctx)
      fixes = fixed.log
      if (fixed.log.length) console.error(`[customer-form] bft-deep ${input.slug}: автоправки — ${fixed.log.length}:\n${fixed.log.slice(0, 20).join('\n')}`)
      const canon = fixed.canon
      const doc = `${head}\n\n${canon}\n\n${tail}\n`
      await writeFile(files.md, doc, 'utf8')
      const lint = await lintDoc(lintScript, files.md)
      const checked = check(doc, ctx)
      const toQuality = (f: CheckFinding): QualityFinding => ({ code: f.code, level: f.level, message: f.message, ...(f.line ? { line: f.line } : {}) })
      let errors = [...lint.findings.filter((f) => f.level === 'ERROR'), ...checked.errors.map(toQuality)]
      warnings = [...lint.findings.filter((f) => f.level !== 'ERROR'), ...checked.warnings.map(toQuality)]
      // Последняя попытка: пробел покрытия и строка plantuml — повод для повтора, но не причина остаться без документа (раунд 4).
      if (attempt === max) {
        const soft = errors.filter((f) => SOFT_ON_LAST.has(f.code))
        if (soft.length) { errors = errors.filter((f) => !SOFT_ON_LAST.has(f.code)); warnings = [...warnings, ...soft] }
      }
      lintErrorsByAttempt.push(lint.findings.filter((f) => f.level === 'ERROR').length)
      checkErrorsByAttempt.push(checked.errors.length)
      if (!errors.length) {
        const html = await python(join(input.skillsPath, 'bft-writer/scripts/bft-html-export.py'), [files.md])
        if (html.code !== 0) throw new Error(`страница ревью не собрана: ${html.out}`)
        questions = openQuestions(canon)
        const state: DeepState = { stage: 'ready', startedAt, finishedAt: new Date().toISOString(), attempts: attempt, quality: await quality(attempt, 'ready'), questions }
        await saveDeepState(files, state)
        return state
      }
      previous = { canon, errors: errors.map(formatFinding).join('\n'), warnings: warningLines(warnings) }
      console.error(`[customer-form] bft-deep ${input.slug}: попытка ${attempt} — ошибок ${errors.length}:\n${previous.errors}`)
    }
    throw new Error(`канон не прошёл проверку (bft-lint.py и проверки портала) за ${max} попытки:\n${previous?.errors ?? ''}`)
  } catch (e) {
    const tried = Math.min(attempt, lintErrorsByAttempt.length)
    const state: DeepState = {
      stage: 'failed', startedAt, finishedAt: new Date().toISOString(), error: (e as Error).message.slice(0, 2000),
      ...(tried ? { attempts: tried, quality: await quality(tried, 'failed').catch(() => undefined) } : {}),
    }
    if (!state.quality) delete state.quality
    await saveDeepState(files, state)
    return state
  }
}

/** «Что нужно для согласования» (план C8, раунд 4): только адресные вопросы маркеров канона. */
function openQuestions(canon: string): OpenQuestion[] {
  return collectQuestions({ canon })
}

/** Что заказчик сказал при приёме (intake.json рядом с документом, план C1); нет файла — undefined. */
export async function readIntake(fast: FastFiles): Promise<Intake | undefined> {
  return readFile(join(fast.dir, 'intake.json'), 'utf8').then((t) => JSON.parse(t) as Intake, () => undefined)
}

/**
 * R3-якорь заявки (план C6): заказчик из primary.json (роль «Заказчик», иначе
 * первый названный), дата согласования fast из approval.json, номер заявки из
 * slug (zayavka-N), иначе из approval.json (taskId — фикстуры качества). Чего
 * нет — [УТОЧНИТЬ] на месте значения: дату код не придумывает.
 */
export async function anchorOf(fast: FastFiles, slug: string): Promise<string> {
  const primary = await readFile(fast.primary, 'utf8').then((t) => JSON.parse(t) as { args?: { people?: { name?: string; role?: string }[] } }, () => undefined)
  const approval = await readFile(fast.approval, 'utf8').then((t) => JSON.parse(t) as { approvedAt?: string; taskId?: string | number }, () => undefined)
  const taskId = /^zayavka-(\d+)$/.exec(slug)?.[1] ?? (approval?.taskId !== undefined ? String(approval.taskId) : undefined)
  return anchorLine({
    ...(primary?.args?.people ? { people: primary.args.people } : {}),
    ...(approval?.approvedAt ? { approvedAt: approval.approvedAt } : {}),
    ...(taskId ? { taskId } : {}),
  })
}
