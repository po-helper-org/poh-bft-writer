/**
 * Передача требования в чат.
 *
 * Кнопка «Работать в чате» подставляет черновик, отправляет всегда человек.
 * Смысл этого модуля — чтобы черновик не начинался с нуля: если по требованию
 * уже был закрытый отрезок работы, модель обязана продолжить с него, а не
 * разбирать всё заново. Ссылка на ветку контекстного чата entire.io идёт в
 * черновик прямым текстом — по ней модель поднимает прошлый разговор.
 */
import { branchUrl, type BftPluginConfig } from './config.js'
import type { BftTask } from './model.js'
import type { WorkEntry } from './worklog.js'

export interface Handoff {
  /** Текст, который подставляется в поле ввода чата. */
  prompt: string
  /** Ссылка на ветку контекстного чата, если отрезок с ней уже был. */
  contextUrl?: string
  /** Продолжение прошлого отрезка, а не первый заход. */
  continued: boolean
}

export function buildHandoff(
  task: BftTask,
  last: WorkEntry | null,
  config: BftPluginConfig,
): Handoff {
  const contextUrl = config.entire ? branchUrl(config.entire, last?.contextRef) : undefined
  const lines = [`Продолжи работу над БФТ ${task.id} «${task.title}».`, `Стадия: ${task.stage}.`]

  if (task.missing.length) {
    // Стадия сама по себе не говорит, что делать. Нехватка — говорит.
    lines.push(`До следующей стадии не хватает: ${task.missing.join(', ')}.`)
  }

  if (last?.summary) {
    lines.push('', `Прошлый заход (${shortDate(last.finishedAt)}) закончился так: ${last.summary}`)
  }
  if (contextUrl) {
    lines.push(
      `Контекст того захода — ветка entire.io: ${contextUrl}`,
      'Подними её и продолжи оттуда, а не с нуля: то, что там уже разобрано, заново не разбирай.',
    )
  } else if (config.entire) {
    lines.push('', 'Закрытых отрезков работы по этому требованию ещё нет — это первый заход.')
  }

  if (task.links.html) lines.push('', `Документ и страница ревью: ${task.links.html}`)

  return { prompt: lines.join('\n'), contextUrl, continued: !!contextUrl }
}

function shortDate(iso: string | undefined): string {
  if (!iso) return 'дата неизвестна'
  const date = new Date(iso)
  if (isNaN(date.getTime())) return 'дата неизвестна'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`
}
