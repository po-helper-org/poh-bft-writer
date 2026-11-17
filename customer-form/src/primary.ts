/**
 * Первичные требования (ADR-0007 rev18) — bft-fast заказчика.
 *
 * Документ пишется со слов: модель заполняет только то, что сказал заказчик
 * (что и зачем, требования с цитатой, что не входит, кого назвал, открытые
 * вопросы). Всё остальное считает код:
 *  - как примет работу — согласованный сценарий приёмки и чек-лист;
 *  - контуры проверки и зоны влияния — Кортекс (cortex.ts), с якорями;
 *  - канонический -fast.md для PO и /bft-deep — из тех же полей (toFastInput):
 *    SMART, ID требований, персоны, граница шапки; линтер навыка проходит.
 */
import type { CortexBrief } from './cortex.js'
import { buildFast, SKILLS_PATH, type FastInput, type FastRequirement } from './bft-fast.js'
import { baselineOf, presentState } from './present.js'

export const KINDS = ['зачем', 'пользователю', 'на экране', 'система', 'качество'] as const
export type Kind = typeof KINDS[number]
const PREFIX: Record<Kind, string> = { зачем: 'БТ', пользователю: 'ПТ', 'на экране': 'ИТ', система: 'ФТ', качество: 'НФТ' }

/** Пункт границы со словами заказчика (план C11): исключение или договорённость. */
export interface QuotedItem { text: string; quote?: string }

export interface PrimaryArgs {
  title: string
  /** asis — «как сейчас» дословно (план C1): подстрока цитаты, иначе отбрасывается. */
  want: { what: string; why?: string; quote: string; asis?: string }
  requirements: { kind: Kind; text: string; quote: string; asis?: string }[]
  /** Явно исключённое заказчиком; строки — формат старых заявок. */
  outOfScope?: (QuotedItem | string)[]
  /** Договорённости и обязательные условия со слов заказчика (не «Не входит»). */
  agreements?: QuotedItem[]
  people?: { name: string; role?: string; about?: string; contact?: string }[]
  openQuestions?: string[]
  /** SMART A (rev22): видение решения заказчика → краткий план реализации. */
  achievable?: Achievable
  /** Расшифровки сокращений со слов заказчика. */
  glossary?: { term: string; meaning: string }[]
  /** Эффект (SMART M): сейчас → хотим, со словами заказчика. */
  metric?: { now?: string; target?: string; quote: string }
  /** Срок (SMART T): к чему и почему тогда. */
  deadline?: { when: string; why?: string; quote: string }
  /** Кто будет пользоваться результатом: роли и примерное число. */
  actors?: { role: string; count?: string; quote: string }[]
}

export const SPECIALISTS = ['PO', 'SA', 'BA', 'BE', 'FE', 'DevOps'] as const

export interface Achievable {
  /** Ответ на «Каким вы видите решение» — дословно, если был. */
  vision?: string
  teams?: string[]
  approvals?: string[]
  questions?: string[]
  specialists?: string[]
}

/** План в ячейку SMART A: одна строка, части через « · ». */
export function achievableText(a: Achievable | undefined): string | undefined {
  if (!a) return undefined
  const part = (head: string, items: string[] | undefined) => (items ?? []).filter((x) => x?.trim()).length ? `${head}: ${items!.filter((x) => x?.trim()).join(', ')}` : ''
  const text = [
    a.vision?.trim() ? `Видение заказчика: «${a.vision.trim().replace(/^«|»$/g, '')}»` : '',
    part('Команды', a.teams),
    part('Специалисты', a.specialists),
    part('Согласования', a.approvals),
    part('Проработать', a.questions),
  ].filter(Boolean).join(' · ')
  return text || undefined
}

/** Что лежит у документа (primary.json): поля модели + сценарий + ответ Кортекса. */
export interface PrimaryDoc {
  args: PrimaryArgs
  howToDemo: string[]
  checklist: string[]
  where?: string
  brief?: CortexBrief
}

const kindOf = (k: string): Kind => (KINDS as readonly string[]).includes(k) ? k as Kind : 'система'

/** Нормализация для сверки цитат: регистр, ё, кавычки, пробелы, тире. */
const norm = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'`]/g, '').replace(/[—–]/g, '-')
  .replace(/\s+/g, ' ').trim().replace(/^[\s.,;:!?-]+|[\s.,;:!?-]+$/g, '')

/**
 * Слова заказчика — дословно (план C1): значение — подстрока одной из цитат
 * после нормализации пробелов, регистра и кавычек. Пересказ и додуманное
 * не проходят — ASIS остаётся плейсхолдером.
 */
export function validQuote(value: string | undefined, quotes: readonly (string | undefined)[]): boolean {
  const v = norm(value ?? '')
  if (v.length < 4) return false
  return quotes.some((q) => !!q && norm(q).includes(v))
}

/** Контакт (email или телефон) вместо зоны влияния (план C11). */
export const CONTACT = /@|\+?\d[\d\s()-]{6,}/

/** Строка-пункт границы: текст и цитата, старый формат — строка. */
export const itemOf = (b: QuotedItem | string): QuotedItem => (typeof b === 'string' ? { text: b } : { text: b?.text ?? '', ...(b?.quote ? { quote: b.quote } : {}) })

/** Все дословные цитаты документа: против них сверяются asis. */
export function quotesOf(args: PrimaryArgs): string[] {
  return [args.want?.quote, ...(args.requirements ?? []).map((r) => r.quote), args.metric?.quote, args.deadline?.quote,
    ...(args.actors ?? []).map((a) => a.quote), args.achievable?.vision].filter((q): q is string => !!q?.trim())
}

/**
 * SMART M (план C11): эффект «сейчас → хотим»; чек-лист приёмки сюда не
 * кладётся — он в How to demo. Базовое значение, которое заказчик назвал в
 * словах о текущем состоянии (want.quote: «уходит до недели»), — «сейчас»,
 * если отдельной метрики нет (раунд 4).
 */
export function measurable(metric: PrimaryArgs['metric'], quote?: string): string {
  const now = metric?.now?.trim() || (() => { const b = baselineOf(presentState(quote)); return b ? `сейчас ${b} (со слов заказчика)` : undefined })()
  const target = metric?.target?.trim()
  if (now && target) return `${now} → ${target}`
  if (now) return `${now} → [УТОЧНИТЬ: целевое значение]`
  if (target) return `[УТОЧНИТЬ: базовое значение] → ${target}`
  return '[УТОЧНИТЬ: показатель эффекта]; приёмка — см. How to demo'
}

/** Похоже на открытый вопрос, а не на границу объёма. */
const UNKNOWN_WORDS = /не\s+согласован|уточня|уточнит|не\s+указан|неизвестн|не\s+решен|не\s+определ|не\s+понятн|\[УТОЧНИТЬ/i

/**
 * outOfScope → исключения и нерешённое (план C11). Новые вызовы такое
 * отклоняет primaryErrors; старые primary.json (и прогон качества по ним)
 * нерешённое в «Не входит» больше не выводят — оно уходит в открытые вопросы.
 */
export function splitScope(args: Pick<PrimaryArgs, 'outOfScope'>): { exclusions: QuotedItem[]; unknowns: string[] } {
  const items = (args.outOfScope ?? []).map(itemOf).filter((b) => b.text.trim())
  return {
    exclusions: items.filter((b) => !UNKNOWN_WORDS.test(b.text)),
    unknowns: items.filter((b) => UNKNOWN_WORDS.test(b.text)).map((b) => b.text.trim()),
  }
}

/** Цитата в ячейку: «Заказчик: «…»» как есть, голый текст — в кавычках. */
const quoted = (q: string) => (/[«"]/.test(q) ? q.trim() : `«${q.trim()}»`)

/** Поля модели → вход канонического bft-fast. Нумерация ID — внутри типа, по порядку. */
export function toFastInput(args: PrimaryArgs): FastInput {
  const counters = new Map<string, number>()
  const quotes = quotesOf(args)
  const words = args.want?.quote?.trim()
  const why = args.want?.why?.trim()
  // C2: ценность заказчика — всегда строка БТ. Нет строки «зачем», а «зачем» звучало — БТ-1 из want.why на цитате want.quote.
  const rows = [...(args.requirements ?? [])]
  if (!rows.some((r) => kindOf(r.kind) === 'зачем') && why && words) rows.unshift({ kind: 'зачем', text: why, quote: words })
  // Как сейчас — словами заказчика: want.asis, иначе предложение реплики want.quote о текущем состоянии.
  const saidNow = validQuote(args.want?.asis, quotes) ? args.want!.asis!.trim() : presentState(words)
  const requirements: FastRequirement[] = rows.map((r) => {
    const prefix = PREFIX[kindOf(r.kind)]
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    // Нет своего asis, а цитата строки — из той же реплики, где заказчик описал «как сейчас», — ASIS из неё (раунд 4),
    // но только если слова о текущем процессе — про эту строку (раунд 6): цитата строки — часть них или у них общие
    // слова с формулировкой строки. Иначе — плейсхолдер: процесс целиком в каждую строку скелета не копируется.
    const inner = (r.quote ?? '').replace(/^[^«"]*[«"]/, '').replace(/[»"]\s*$/, '')
    const sameUtterance = !!saidNow && !!words && (validQuote(saidNow, [r.quote]) || validQuote(inner, [words]))
    const asis = validQuote(r.asis, [r.quote, args.want?.quote]) ? r.asis!.trim() : sameUtterance && asisAbout(saidNow!, r.text, inner, args.title) ? saidNow : undefined
    return { id: `${prefix}-${n}`, ...(asis ? { asis } : {}), tobe: r.text, source: r.quote }
  })
  // Связи вверх (каскад к БТ): при единственном БТ все остальные строки ссылаются на него.
  const bts = requirements.filter((r) => r.id.startsWith('БТ-'))
  if (bts.length === 1) for (const r of requirements) if (r !== bts[0]) r.related = [bts[0]!.id]
  const r = [why, words ? `Слова заказчика (R3): ${quoted(words)}` : ''].filter(Boolean).join(' · ')
  const deadline = args.deadline?.when?.trim()
  const asis = saidNow
  const scope = splitScope(args)
  const questions = [...(args.openQuestions ?? []), ...scope.unknowns]
  return {
    title: args.title,
    smart: {
      s: args.want?.what ?? '',
      m: measurable(args.metric, args.want?.quote),
      ...(achievableText(args.achievable) ? { a: achievableText(args.achievable) } : {}),
      ...(r ? { r } : {}),
      ...(deadline ? { t: args.deadline?.why?.trim() ? `${deadline} — ${args.deadline.why.trim()}` : deadline } : {}),
    },
    ...(asis ? { asis } : {}),
    boundaries: [
      ...scope.exclusions.map((b) => (/^не входит/i.test(b.text.trim()) ? b.text : `Не входит: ${b.text}`)),
      ...(args.agreements ?? []).map(itemOf).filter((b) => b.text.trim()).map((b) => (/^договор[её]нност/i.test(b.text.trim()) ? b.text : `Договорённость: ${b.text}`)),
    ],
    personas: (args.people ?? []).map((p) => {
      // Зона влияния — не контакты: email/телефон в about в шапку не идут.
      const about = p.about?.trim() && !CONTACT.test(p.about) ? p.about : undefined
      return { name: p.name, ...(p.role ? { role: p.role } : {}), ...(about ? { influence: about } : {}) }
    }),
    requirements,
    ...(questions.length ? { openQuestions: questions } : {}),
  }
}

/**
 * Слова заказчика о текущем процессе — про эту строку скелета: цитата строки
 * — их часть, или у них с формулировкой строки общая основа (без слов
 * названия заявки — они есть в любой строке): две, или одна при трети основ
 * формулировки.
 */
export function asisAbout(asis: string, text: string, quote: string, title = ''): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const q = norm(quote)
  if (q.length >= 8 && norm(asis).includes(q)) return true
  const subject = stems(title)
  const own = new Set([...stems(text)].filter((x) => !subject.has(x)))
  const said = stems(asis)
  const shared = [...own].filter((x) => said.has(x)).length
  return shared >= 2 || (shared >= 1 && shared / Math.max(1, own.size) >= 1 / 3)
}

/** Основы слов (от 4 букв, первые 5) — для сравнения пункта с открытыми вопросами. */
const stems = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)))

/**
 * Ошибки полей для повторного вызова create_bft_fast (план C11): «Не входит»
 * без цитаты, нерешённое вместо исключения, пересечение с открытыми вопросами.
 * Старые primary.json сюда не идут — только вызов модели.
 */
export function primaryErrors(args: PrimaryArgs): string[] {
  const errors: string[] = []
  const questions = (args.openQuestions ?? []).map(stems)
  for (const raw of args.outOfScope ?? []) {
    const item = itemOf(raw)
    if (!item.text.trim()) continue
    if (!item.quote?.trim()) {
      errors.push(`outOfScope «${item.text}»: нет цитаты заказчика. «Не входит» — только явно исключённое им; иначе убери пункт или перенеси в openQuestions.`)
      continue
    }
    const own = stems(item.text)
    const overlap = own.size ? Math.max(0, ...questions.map((q) => [...own].filter((w) => q.has(w)).length / own.size)) : 0
    if (UNKNOWN_WORDS.test(item.text) || overlap >= 0.6) {
      errors.push(`outOfScope «${item.text}»: это открытый вопрос, а не граница объёма — оставь его только в openQuestions.`)
    }
  }
  for (const raw of args.agreements ?? []) {
    const item = itemOf(raw)
    if (item.text.trim() && !item.quote?.trim()) errors.push(`agreements «${item.text}»: нет цитаты заказчика — договорённость пишется только с его словами.`)
  }
  return errors
}

/** Текст для Кортекса: о чём запрос и как его проверяют. */
export function cortexQuery(args: PrimaryArgs, howToDemo: string[]): string {
  return [args.title, args.want?.what, args.want?.why, ...(args.requirements ?? []).map((r) => r.text), ...howToDemo]
    .filter(Boolean).join('\n')
}

/**
 * bft-fast из полей документа — тот же путь, что у create_bft_fast в чате:
 * прогон качества (qualityRun) пересобирает fast из primary.json этой функцией,
 * детерминированно, без модели.
 */
export function buildFastFromPrimary(doc: Pick<PrimaryDoc, 'args' | 'howToDemo' | 'checklist'>, ctx: { slug: string; source: string; date?: string }, root: string): ReturnType<typeof buildFast> {
  return buildFast(toFastInput(doc.args), {
    slug: ctx.slug, howToDemo: doc.howToDemo ?? [], source: ctx.source, skillsPath: SKILLS_PATH, ...(ctx.date ? { date: ctx.date } : {}),
  }, root)
}
