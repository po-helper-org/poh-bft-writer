/**
 * Передача БФТ в OKR: разбор формы «Добавить в OKR» и запись на доску.
 *
 * Готовый БФТ (`DEEP-DONE`) уходит в квартальное планирование одной кнопкой с
 * доски. Что PO заполнил в окне — квартал, плановые спринты по фазам, команды,
 * ответственных, комментарий — пишется в саму задачу Backlog.md: своего
 * хранилища у раздела нет, а задача и так единственный источник правды по
 * требованию (см. `backlog-writer.ts`).
 *
 * Формат блока плана — тот же, что у карточки KR в плагине OKR
 * (`poh-okr-plugin/src/plan-block.ts`): строки `ключ: значение`, фаза —
 * `research: спринт 3 / SA`. Совпадение не косметическое: задача, переведённая
 * в KR, читается тем плагином без конвертации, а неизвестная ему строка
 * (`quarter:`) им молча пропускается — так устроен его разбор.
 *
 * Ссылки на Confluence и эпик дописываются в `references` задачи по конвенции
 * `bft-needed-list`, и только те, которых там ещё нет: `--add-ref` не
 * заменяет список, повторный вызов ничего не дублирует.
 */
import { OKR_ADDED_STAGE } from './model.js'
import { missingRefs } from './refs.js'

/** Фазы работы над KR — в порядке, в каком их планирует PO. Те же, что у плагина OKR. */
export const OKR_PHASES = ['research', 'analyze', 'dev', 'qa', 'release'] as const
export type OkrPhase = (typeof OKR_PHASES)[number]

/** Спринтов в квартале — столько же колонок, сколько у доски OKR. */
export const OKR_SPRINT_COUNT = 6

/** Квартал в виде `2026-Q3`: год и номер, другой формы окно не подставляет. */
const QUARTER_RE = /^\d{4}-Q[1-4]$/

export interface OkrPhasePlan {
  /** Номер спринта с нуля, как в плагине OKR. `null` — фаза не запланирована. */
  sprint: number | null
  /** Плановые ресурсы фазы свободным текстом: «SA», «2 BE». */
  resources: string
}

export interface OkrHandoff {
  confluence: string
  epic: string
  quarter: string
  stages: Record<OkrPhase, OkrPhasePlan>
  teams: string
  techLeads: string
  executors: string
  comment: string
}

export type OkrHandoffParse = { ok: true; value: OkrHandoff } | { ok: false; error: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Разбор тела запроса с клиента. Обязательны ссылки и квартал: без них в OKR
 * передавать нечего, и это говорится словами, а не кодом. План и комментарий
 * необязательны — БФТ может уйти в квартал до раскладки по спринтам.
 */
export function parseOkrHandoff(payload: unknown): OkrHandoffParse {
  if (typeof payload !== 'object' || payload === null) return { ok: false, error: 'не передана форма OKR' }
  const body = payload as Record<string, unknown>

  const confluence = text(body.confluence)
  const epic = text(body.epic)
  const quarter = text(body.quarter)
  if (!/^https?:\/\//.test(confluence)) return { ok: false, error: 'нужна ссылка на страницу Confluence' }
  if (!/^https?:\/\//.test(epic)) return { ok: false, error: 'нужна ссылка на эпик JIRA' }
  if (!QUARTER_RE.test(quarter)) return { ok: false, error: 'квартал задаётся в виде 2026-Q3' }

  const rawStages = typeof body.stages === 'object' && body.stages !== null
    ? body.stages as Record<string, unknown>
    : {}
  const stages = {} as Record<OkrPhase, OkrPhasePlan>
  for (const phase of OKR_PHASES) {
    const row = typeof rawStages[phase] === 'object' && rawStages[phase] !== null
      ? rawStages[phase] as Record<string, unknown>
      : {}
    const sprint = row.sprint
    const valid = typeof sprint === 'number' && Number.isInteger(sprint) && sprint >= 0 && sprint < OKR_SPRINT_COUNT
    if (sprint !== null && sprint !== undefined && !valid) {
      return { ok: false, error: `спринт фазы ${phase} вне диапазона 1–${OKR_SPRINT_COUNT}` }
    }
    stages[phase] = { sprint: valid ? sprint : null, resources: text(row.resources) }
  }

  return {
    ok: true,
    value: {
      confluence,
      epic,
      quarter,
      stages,
      teams: text(body.teams),
      techLeads: text(body.techLeads),
      executors: text(body.executors),
      comment: text(body.comment),
    },
  }
}

/** Блок плана в поле «План реализации» — формат карточки KR плагина OKR плюс строка квартала. */
export function formatOkrPlan(handoff: OkrHandoff): string {
  const lines = [`quarter: ${handoff.quarter}`]
  for (const phase of OKR_PHASES) {
    const row = handoff.stages[phase]
    if (row.sprint === null && row.resources === '') continue
    const sprint = row.sprint === null ? '—' : `спринт ${row.sprint + 1}`
    lines.push(row.resources === '' ? `${phase}: ${sprint}` : `${phase}: ${sprint} / ${row.resources}`)
  }
  if (handoff.teams !== '') lines.push(`teams: ${handoff.teams}`)
  if (handoff.techLeads !== '') lines.push(`techLeads: ${handoff.techLeads}`)
  if (handoff.executors !== '') lines.push(`executors: ${handoff.executors}`)
  return lines.join('\n')
}

/**
 * Одна команда `task edit`: стадия, план, комментарий и недостающие ссылки.
 * Комментарий дописывается к заметкам, а не заменяет их: в `--notes` у задачи
 * могло быть что-то до нас, и терять это из-за формы нельзя.
 */
export function okrHandoffArgs(id: string, handoff: OkrHandoff, knownRefs: readonly string[]): string[] {
  const args = ['task', 'edit', id, '-s', OKR_ADDED_STAGE, '--plan', formatOkrPlan(handoff)]
  if (handoff.comment !== '') args.push('--append-notes', `OKR: ${handoff.comment}`)
  for (const url of missingRefs(knownRefs, [handoff.confluence, handoff.epic])) args.push('--add-ref', url)
  args.push('--plain')
  return args
}

/**
 * Кварталы на выбор в окне: текущий и следующие, всего `count`. Прошлые не
 * предлагаются — в закрытый квартал БФТ не планируют, а ошибочный выбор из
 * длинного списка вероятнее, чем потребность в нём.
 */
export function quarterOptions(from: Date, count = 8): string[] {
  const options: string[] = []
  let year = from.getFullYear()
  let quarter = Math.floor(from.getMonth() / 3) + 1
  for (let i = 0; i < count; i++) {
    options.push(`${year}-Q${quarter}`)
    quarter += 1
    if (quarter > 4) { quarter = 1; year += 1 }
  }
  return options
}
