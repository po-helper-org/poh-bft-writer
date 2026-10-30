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
import type { FastInput, FastRequirement } from './bft-fast.js'

export const KINDS = ['зачем', 'пользователю', 'на экране', 'система', 'качество'] as const
export type Kind = typeof KINDS[number]
const PREFIX: Record<Kind, string> = { зачем: 'БТ', пользователю: 'ПТ', 'на экране': 'ИТ', система: 'ФТ', качество: 'НФТ' }

export interface PrimaryArgs {
  title: string
  want: { what: string; why?: string; quote: string }
  requirements: { kind: Kind; text: string; quote: string }[]
  outOfScope?: string[]
  people?: { name: string; role?: string; about?: string }[]
  openQuestions?: string[]
  /** SMART A (rev22): видение решения заказчика → краткий план реализации. */
  achievable?: Achievable
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

/** Поля модели → вход канонического bft-fast. Нумерация ID — внутри типа, по порядку. */
export function toFastInput(args: PrimaryArgs, checklist: string[]): FastInput {
  const counters = new Map<string, number>()
  const requirements: FastRequirement[] = (args.requirements ?? []).map((r) => {
    const prefix = PREFIX[kindOf(r.kind)]
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    return { id: `${prefix}-${n}`, tobe: r.text, source: r.quote }
  })
  return {
    title: args.title,
    smart: {
      s: args.want?.what ?? '',
      ...(checklist.length ? { m: checklist.join('; ') } : {}),
      ...(achievableText(args.achievable) ? { a: achievableText(args.achievable) } : {}),
      ...(args.want?.why ? { r: args.want.why } : {}),
    },
    boundaries: (args.outOfScope ?? []).map((b) => (/^не входит/i.test(b.trim()) ? b : `Не входит: ${b}`)),
    personas: (args.people ?? []).map((p) => ({ name: p.name, ...(p.role ? { role: p.role } : {}), ...(p.about ? { influence: p.about } : {}) })),
    requirements,
    ...(args.openQuestions?.length ? { openQuestions: args.openQuestions } : {}),
  }
}

/** Текст для Кортекса: о чём запрос и как его проверяют. */
export function cortexQuery(args: PrimaryArgs, howToDemo: string[]): string {
  return [args.title, args.want?.what, args.want?.why, ...(args.requirements ?? []).map((r) => r.text), ...howToDemo]
    .filter(Boolean).join('\n')
}
