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
 *  - блок «Продолжить / уточнить БФТ» — дословно из эталона;
 *  - гейт — штатный bft-lint.py: ошибки уходят модели на исправление (до трёх
 *    попыток), документ с ошибками готовым не считается;
 *  - страница ревью — bft-html-export.py (`<slug>.html` рядом с `-fast.html`).
 */
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BORDER, type FastFiles } from './bft-fast.js'

export interface DeepFiles { md: string; html: string; state: string }

export function deepFiles(fast: FastFiles, slug: string): DeepFiles {
  return { md: join(fast.dir, `${slug}.md`), html: join(fast.dir, `${slug}.html`), state: join(fast.dir, 'deep.json') }
}

export type DeepStage = 'building' | 'ready' | 'failed'
export interface DeepState { stage: DeepStage; startedAt: string; finishedAt?: string; attempts?: number; error?: string }

export async function readDeepState(files: DeepFiles): Promise<DeepState | undefined> {
  return readFile(files.state, 'utf8').then((s) => JSON.parse(s) as DeepState, () => undefined)
}

async function saveDeepState(files: DeepFiles, state: DeepState): Promise<void> {
  await writeFile(files.state, JSON.stringify(state), 'utf8')
}

/** Маршрут модели и потоковый вызов — структурно, как их отдаёт dsh-llm. */
export interface DeepRoute { provider: string; model: string }
type Chunk = { type: string; text?: string; reason?: unknown }
export interface LlmLike {
  prepareCall(config: DeepRoute & { maxTokens?: number }, signal?: AbortSignal): Promise<{
    config: DeepRoute & Record<string, unknown>
    stream(options: Record<string, unknown>): AsyncIterable<Chunk>
  }>
}

const CANON_HEAD = '## Проблема которую решаем'
const CONTINUE_HEAD = '## Продолжить / уточнить БФТ'
const CRITICAL_HEAD = '### Критичные требования (скелет на цитатах)'

/** Шапка deep: frontmatter со `stage: deep`, без границы и «Критичных требований». */
export function deepHead(fastMd: string, today: string): string {
  const border = fastMd.indexOf(BORDER)
  let head = (border < 0 ? fastMd : fastMd.slice(0, border)).trimEnd()
  head = head
    .replace(/^stage: .*$/m, 'stage: deep')
    .replace(/^version: .*$/m, 'version: 0.2')
    .replace(/^synced: .*$/m, `synced: ${today}`)
    .replace(/^status: .*$/m, 'status: Черновик 0.2 (deep — собран в портале; Confluence, JIRA и git не подключались)')
  const start = head.indexOf(CRITICAL_HEAD)
  if (start >= 0) {
    const next = head.indexOf('\n### ', start + CRITICAL_HEAD.length)
    head = head.slice(0, start) + (next < 0 ? '' : head.slice(next + 1))
  }
  return head.trimEnd()
}

/** Канон из ответа модели: от «Проблемы которую решаем» до блока «Продолжить». */
export function cleanCanon(text: string): string {
  let body = text.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/m, '$1')
  const start = body.indexOf(CANON_HEAD)
  if (start >= 0) body = body.slice(start)
  const tail = body.indexOf(CONTINUE_HEAD)
  if (tail >= 0) body = body.slice(0, tail)
  // Правило RULES «открытые вопросы в документ не пиши» модель нарушает хвостом
  // «**Открытые вопросы (в чат, не в документ):**» — вопросы и так стоят [УТОЧНИТЬ] в ячейках.
  body = body.replace(/\n(?:---\s*\n\s*)?\*\*Открытые вопросы[^\n]*\n[\s\S]*$/, '\n')
  return body.trim()
}

/** Блок «Продолжить / уточнить БФТ» — эталон навыка, с контекстом этой заявки. */
export function continueBlock(golden: string, slug: string, taskUrl: string, today: string): string {
  const start = golden.indexOf(CONTINUE_HEAD)
  if (start < 0) return `${CONTINUE_HEAD}\n\nКорпоративный канон собран (bft-deep, ${today}).`
  return golden.slice(start)
    .replace(/\(bft-deep, [0-9.]+\)/, `(bft-deep в портале, ${today})`)
    .replace(/- epic_slug: .*/, `- epic_slug: ${slug}`)
    .replace(/- Источник Summary: .*/, `- Источник Summary: заявка в трекере — ${taskUrl}`)
    .replace(/- pin_commit .*/, '- pin_commit (репо poh-bft-writer): [УТОЧНИТЬ]')
    .trimEnd()
}

/** Канон эталона — образец формы для модели (без шапки и блока «Продолжить»). */
function goldenCanon(golden: string): string {
  return cleanCanon(golden)
}

const RULES = `Ты — аналитик, который доводит первичные требования (bft-fast) до полного БФТ по корпоративному канону.

Напиши ТОЛЬКО канон — markdown, начиная строкой «${CANON_HEAD}». Шапку, frontmatter и блок «Продолжить / уточнить БФТ» не пиши: их добавит система.

Разделы канона — ровно эти, в этом порядке, заголовки второго уровня дословно:
## Проблема которую решаем
## Изменение в UJM
## План демонстрации
## Бизнес-Требования
## Ценность разрабатываемого функционала для бизнес-заказчиков*
## Пользовательские требования*
## Требования к интерфейсам*
## Макеты интерфейса*
## Функциональные требования*
## Нефункциональные требования*
## Зависимости
## Риски
## Якоря истины

Правила:
- Источник фактов — только документ bft-fast и контекст заявки ниже. Факт без источника — \`[УТОЧНИТЬ у {кого}]\` в ячейке, не выдумывай. Цифр, систем, сроков и метрик, которых нет в источнике, не добавляй.
- ID из «Критичных требований» bft-fast сохраняй (БТ-1 там = БТ-1 здесь), строки разверни в типизированные таблицы. Новые ID — только следующими номерами.
- «План демонстрации»: подраздел «### Акторы» — таблица с колонкой «Актор»; подраздел «### Сценарий приёмки (happy path + alt)» — непустой блок \`\`\`plantuml с веткой alt (что видит заказчик, если что-то пошло не так). Сценарий — по How to demo из шапки.
- «Функциональные требования*»: третья колонка — «Приоритет»: Высокий, Средний, Низкий (можно с пометкой «(предварительно)») или [УТОЧНИТЬ].
- Высота БФТ: результат и приёмка — без API-контрактов, схем БД и кода.
- В ячейках таблиц — одна короткая формулировка, без HTML (<br>, <ul>, <li>), без пустых строк-заглушек. Эмодзи в каноне не используй.
- Разделы «Бизнес описание», «Общая информация», «Заинтересованные стороны», «История изменений», «Критерии успеха», «Ключевые решения», «Вводные для разрабатываемого функционала» не заводи. Открытые вопросы в документ не пиши — только [УТОЧНИТЬ] в ячейках.
- Пиши по-русски, коротко и проверяемо.`

export function deepPrompt(golden: string, fastMd: string, context: string, lintErrors?: { canon: string; errors: string }): { system: string; user: string } {
  const system = `${RULES}\n\nОбразец формы канона (другой проект — бери структуру таблиц и стиль, не факты):\n\n${goldenCanon(golden)}`
  const parts = [
    'Документ bft-fast (первичные требования, согласованы заказчиком):',
    fastMd,
    context.trim() ? `Контекст заявки:\n${context.trim()}` : '',
  ]
  if (lintErrors) {
    parts.push(`Прошлая версия канона не прошла проверку шаблона (bft-lint.py). Исправь ошибки и выдай канон целиком заново.\n\nОшибки:\n${lintErrors.errors}\n\nПрошлая версия:\n${lintErrors.canon}`)
  }
  return { system, user: parts.filter(Boolean).join('\n\n') }
}

/** Один вызов модели: текст ответа целиком. */
export async function generate(llm: LlmLike, route: DeepRoute, prompt: { system: string; user: string }, signal: AbortSignal): Promise<string> {
  const call = await llm.prepareCall({ ...route, maxTokens: 32_000 }, signal)
  let text = ''
  for await (const chunk of call.stream({
    ...call.config,
    system: prompt.system,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt.user }] }],
    signal,
  })) {
    if (chunk.type === 'text-delta' && chunk.text) text += chunk.text
  }
  if (!text.trim()) throw new Error('модель вернула пустой ответ')
  return text
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
  llm: LlmLike
  route: DeepRoute
  skillsPath: string
  fast: FastFiles
  slug: string
  taskUrl: string
  /** Описание заявки и прочий контекст для модели (не попадает в документ). */
  context: string
  attempts?: number
  timeoutMs?: number
}

const today = () => new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })

/**
 * Собрать deep: шапка + канон модели + «Продолжить», линтер с повторами,
 * страница ревью. Состояние — в deep.json (переживает рестарт).
 */
export async function buildDeep(input: DeepInput): Promise<DeepState> {
  const files = deepFiles(input.fast, input.slug)
  const startedAt = new Date().toISOString()
  await saveDeepState(files, { stage: 'building', startedAt })
  const signal = AbortSignal.timeout(input.timeoutMs ?? 15 * 60_000)
  try {
    const fastMd = await readFile(input.fast.md, 'utf8')
    const golden = await readFile(join(input.skillsPath, 'bft-deep-swarm/examples/golden_deep_document.md'), 'utf8')
    const head = deepHead(fastMd, today())
    const tail = continueBlock(golden, input.slug, input.taskUrl, today())
    const lintScript = join(input.skillsPath, 'bft-writer/scripts/bft-lint.py')
    const max = input.attempts ?? 3
    let previous: { canon: string; errors: string } | undefined
    for (let attempt = 1; attempt <= max; attempt++) {
      const canon = cleanCanon(await generate(input.llm, input.route, deepPrompt(golden, fastMd, input.context, previous), signal))
      await writeFile(files.md, `${head}\n\n${canon}\n\n${tail}\n`, 'utf8')
      const lint = await python(lintScript, [files.md])
      if (lint.code === 0) {
        const html = await python(join(input.skillsPath, 'bft-writer/scripts/bft-html-export.py'), [files.md])
        if (html.code !== 0) throw new Error(`страница ревью не собрана: ${html.out}`)
        const state: DeepState = { stage: 'ready', startedAt, finishedAt: new Date().toISOString(), attempts: attempt }
        await saveDeepState(files, state)
        return state
      }
      previous = { canon, errors: lint.out }
      console.error(`[customer-form] bft-deep ${input.slug}: попытка ${attempt} — линтер:\n${lint.out}`)
    }
    throw new Error(`канон не прошёл bft-lint.py за ${max} попытки:\n${previous?.errors ?? ''}`)
  } catch (e) {
    const state: DeepState = { stage: 'failed', startedAt, finishedAt: new Date().toISOString(), error: (e as Error).message.slice(0, 2000) }
    await saveDeepState(files, state)
    return state
  }
}
