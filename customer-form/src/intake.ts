/**
 * Данные приёма рядом с документом (план качества, C1/C11): intake.json и блок
 * «Слова заказчика» для модели полного БФТ.
 *
 * intake.json пишут инструменты чата: submit_customer_request (asis, gap, tobe,
 * глоссарий, ссылки, открытые вопросы) и сценарий приёмки (черновик по
 * материалам и список допущений ассистента — unclear). Свободный текст asis/gap/
 * tobe писала модель: в «Слова заказчика (R3)» он не идёт. Дословное — только
 * поля-цитаты primary.json.
 *
 * Старые заявки без intake.json: глоссарий и открытые вопросы — из primary.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Intake } from './canon-check.js'
import type { AcceptanceDemo } from './demo.js'
import { itemOf, splitScope, validQuote, quotesOf, type PrimaryDoc } from './primary.js'
import { baselineOf, presentState } from './present.js'

/** Что лежит в intake.json: поля Intake (canon-check) плюс черновик сценария. */
export interface IntakeFile extends Intake {
  /** Название заявки из submit_customer_request: им названа папка заявки в workspace. */
  title?: string
  summary?: string
  /** Черновик по материалам из сценария приёмки (писал ассистент). */
  demo?: { asis?: string; gap?: string; tobe?: string }
  updatedAt?: string
}

const clean = (values: readonly unknown[] | undefined): string[] =>
  (values ?? []).map((v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')).filter(Boolean)

/** Глоссарий в форме {term, meaning}: submit_customer_request пишет expansion. */
export function glossaryOf(items: readonly unknown[] | undefined): { term: string; meaning: string }[] {
  return (items ?? []).flatMap((g) => {
    const item = (g ?? {}) as { term?: unknown; meaning?: unknown; expansion?: unknown }
    const term = typeof item.term === 'string' ? item.term.trim() : ''
    const meaning = typeof item.meaning === 'string' ? item.meaning.trim() : typeof item.expansion === 'string' ? item.expansion.trim() : ''
    return term && meaning ? [{ term, meaning }] : []
  })
}

/** Поля сценария приёмки для intake.json: черновик и допущения ассистента. */
export function demoIntake(demo: Pick<AcceptanceDemo, 'asis' | 'gap' | 'tobe' | 'unclear'>): IntakeFile {
  const draft = Object.fromEntries((['asis', 'gap', 'tobe'] as const).filter((k) => demo[k]?.trim()).map((k) => [k, demo[k]!.trim()]))
  const unclear = clean(demo.unclear)
  return { ...(Object.keys(draft).length ? { demo: draft } : {}), ...(unclear.length ? { unclear } : {}) }
}

/** Дописать в intake.json: новые поля заменяют старые, остальное остаётся. */
export async function mergeIntake(dir: string, patch: IntakeFile): Promise<IntakeFile> {
  const path = join(dir, 'intake.json')
  const current = await readFile(path, 'utf8').then((t) => JSON.parse(t) as IntakeFile, () => ({} as IntakeFile))
  const next: IntakeFile = { ...current, ...patch, updatedAt: new Date().toISOString() }
  await mkdir(dir, { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

const bullet = (s: string) => `- ${s.replace(/\s+/g, ' ').trim()}`

/**
 * Первый блок контекста deep (план C1, C11): дословные слова заказчика (R3),
 * акторы, эффект и срок, границы, глоссарий, затем — отдельно — то, что не
 * R3: план реализации, допущения ассистента и открытые вопросы. Пусто — ''.
 */
export function customerWordsContext(primary: Pick<PrimaryDoc, 'args'> | undefined, intake: IntakeFile | undefined): string {
  const args = primary?.args
  const out: string[] = []
  if (args) {
    const quotes = quotesOf(args)
    const words = [
      args.want?.quote ? `Что хочет и зачем: ${args.want.quote}` : '',
      args.want?.asis && validQuote(args.want.asis, quotes) ? `Как сейчас (ASIS): «${args.want.asis.trim()}»` : presentState(args.want?.quote) ? `Как сейчас (ASIS, из той же реплики): «${presentState(args.want?.quote)}»` : '',
      ...(args.requirements ?? []).filter((r) => r.quote?.trim()).map((r) => {
        const asis = r.asis && validQuote(r.asis, [r.quote, args.want?.quote]) ? ` · как сейчас: «${r.asis.trim()}»` : ''
        return `${r.text}: ${r.quote}${asis}`
      }),
      args.achievable?.vision?.trim() ? `Каким видит решение (гипотеза для SA, не ФТ): «${args.achievable.vision.trim().replace(/^«|»$/g, '')}»` : '',
      !args.metric?.now && baselineOf(presentState(args.want?.quote)) ? `Эффект: сейчас — ${baselineOf(presentState(args.want?.quote))} (базовое значение со слов заказчика; целевое — [УТОЧНИТЬ])` : '',
      args.metric ? `Эффект: ${[args.metric.now ? `сейчас — ${args.metric.now}` : '', args.metric.target ? `хотим — ${args.metric.target}` : ''].filter(Boolean).join('; ') || 'не назван'} · ${args.metric.quote}` : '',
      args.deadline?.when ? `Срок: ${args.deadline.when}${args.deadline.why ? ` (почему тогда: ${args.deadline.why})` : ''} · ${args.deadline.quote}` : '',
      ...splitScope(args).exclusions.filter((b) => b.quote?.trim()).map((b) => `Не входит: ${b.text} · ${b.quote}`),
      ...(args.agreements ?? []).map(itemOf).filter((b) => b.text.trim()).map((b) => `Договорённость: ${b.text}${b.quote ? ` · ${b.quote}` : ''}`),
    ].filter(Boolean)
    if (words.length) {
      out.push('Слова заказчика (дословно, R3) — единственный источник ASIS, «Было (As-Is)» и решений заказчика:', ...words.map(bullet))
    }
    const actors = (args.actors ?? []).filter((a) => a.role?.trim())
    if (actors.length) {
      out.push('', 'Акторы (со слов заказчика) — кто будет пользоваться результатом:',
        ...actors.map((a) => bullet(`${a.role}${a.count ? ` — ${a.count}` : ''}${a.quote ? ` · ${a.quote}` : ''}`)))
    }
  }
  const glossary = glossaryOf(intake?.glossary?.length ? intake.glossary : args?.glossary)
  if (glossary.length) out.push('', 'Глоссарий (расшифровки со слов заказчика):', ...glossary.map((g) => bullet(`${g.term} — ${g.meaning}`)))
  const plan = args?.achievable
  const planLines = [
    plan?.approvals?.length ? `Согласования: ${clean(plan.approvals).join('; ')}` : '',
    plan?.questions?.length ? `Проработать: ${clean(plan.questions).join('; ')}` : '',
  ].filter(Boolean)
  if (planLines.length) out.push('', 'План реализации (составил ассистент по видению заказчика — не R3; пункты — строки «Зависимостей»):', ...planLines.map(bullet))
  const unclear = clean(intake?.unclear)
  if (unclear.length) {
    out.push('', 'Допущения ассистента в сценарии и чего нет в материалах — не R3: такая деталь сценария в To-Be — [УТОЧНИТЬ]:', ...unclear.map(bullet))
  }
  const questions = [...new Set(clean([...(intake?.openQuestions?.length ? intake.openQuestions : args?.openQuestions ?? []), ...(args ? splitScope(args).unknowns : [])]))]
  if (questions.length) out.push('', 'Открытые вопросы приёма (не решения заказчика; в документе — [УТОЧНИТЬ] в ячейке, которую блокируют):', ...questions.map(bullet))
  return out.join('\n').trim()
}
