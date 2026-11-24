/**
 * Список БФТ для внешних витрин (ADR-0020): Инбокс PO показывает заявки портала,
 * их краткий статус и артефакты. Здесь — чистая сборка карточки из уже прочитанного
 * состояния заявки; чтение файлов и трекера — в маршруте customer-form.bftList.
 */
import type { RequestSummary } from './host.js'
import { STAGE_LABEL as LIFECYCLE_LABEL } from './lifecycle-page.js'

export type BftStage = 'dialog' | 'demo' | 'fast-review' | 'fast-approved' | 'deep-building' | 'deep-ready' | 'deep-failed'

export interface BftDownload { format: 'md' | 'docx' | 'pdf'; url: string }

export interface BftArtifact {
  kind: 'demo' | 'fast' | 'deep' | 'form' | 'ticket' | 'lifecycle'
  label: string
  url: string
  /** Короткая пометка рядом с артефактом: «согласованы», «ответов 3 из 12». */
  note?: string
  downloads?: BftDownload[]
}

export interface BftCard {
  sessionId: string
  taskId: number
  title: string
  created: string
  /** Колонка доски «Запросы» в трекере. */
  status?: string
  stage: BftStage
  /** Краткий статус документа для списка. */
  stageLabel: string
  /** Чат заявки в портале — открывается в браузере. */
  chatUrl: string
  /** Вопросы формы согласования: сколько всего и на сколько ответили. */
  questions?: { total: number; answered: number }
  /** Цикл заявки: его стадия, кого ждём, раунд согласования. */
  lifecycle?: { stage: string; waitingFor: string[]; round: number }
  updatedAt: string
  artifacts: BftArtifact[]
}

/** Что известно о заявке (прочитано маршрутом). */
export interface BftState {
  demo?: { approvedAt?: string | undefined }
  fast?: { approvedAt?: string | undefined; rev?: string | undefined }
  deep?: { stage: 'building' | 'ready' | 'failed'; startedAt?: string | undefined; finishedAt?: string | undefined }
  form?: { id: string; publishedAt?: string | undefined; revokedAt?: string | undefined; total: number; answered: number }
  /** Статус цикла заявки (ADR-0022, шаг 3): есть — стадия из него, а не из файлов. */
  lifecycle?: { stage: string; waitingFor: string[]; round: number }
}

export interface BftUrls {
  /** Полный адрес страницы портала по пути от его корня («/api/…»). */
  portal(path: string): string
  /** Открытая ссылка формы по ключу. */
  form(id: string): string
  /** Адрес задачи трекера, если он открывается снаружи. */
  ticket?: string | undefined
  /** Страница «Жизненный цикл» (ADR-0022), если цикл включён. */
  lifecycle?: string | undefined
}

const STAGE_LABEL: Record<BftStage, string> = {
  dialog: 'В диалоге с заказчиком',
  demo: 'Сценарий приёмки на согласовании',
  'fast-review': 'Первичные требования на проверке',
  'fast-approved': 'Первичные требования согласованы',
  'deep-building': 'Полный БФТ собирается',
  'deep-ready': 'Полный БФТ готов',
  'deep-failed': 'Полный БФТ не собран',
}

/** Стадия цикла → стадия списка (значения прежние: витрины их уже знают). */
function lifecycleStage(state: BftState): BftStage | undefined {
  switch (state.lifecycle?.stage) {
    case 'intake': return 'dialog'
    case 'scenario': return 'demo'
    case 'brief': case 'brief_review': return 'fast-review'
    case 'deep': return state.deep ? 'deep-building' : 'fast-approved'
    case 'rebuilding': return 'deep-building'
    case 'deep_failed': return 'deep-failed'
    case 'agreement': case 'validated': case 'handed_off': return 'deep-ready'
    default: return undefined
  }
}

const WAIT: Record<string, string> = { customer: 'заказчика', po: 'PO', model: 'модель' }
const waitLabel = (w: string) => WAIT[w] ?? (w.startsWith('team:') ? w.slice(5) : w)

export function bftStage(state: BftState): BftStage {
  const fromLifecycle = lifecycleStage(state)
  if (fromLifecycle) return fromLifecycle
  if (state.deep) return `deep-${state.deep.stage}` as BftStage
  if (state.fast) return state.fast.approvedAt ? 'fast-approved' : 'fast-review'
  if (state.demo) return 'demo'
  return 'dialog'
}

export function bftCard(item: RequestSummary, state: BftState, urls: BftUrls): BftCard {
  const session = encodeURIComponent(item.sessionId)
  const page = urls.portal(`/api/customer-form.bftFast?session=${session}`)
  const downloads = (doc: 'fast' | 'deep'): BftDownload[] => (['docx', 'pdf', 'md'] as const)
    .map((format) => ({ format, url: urls.portal(`/api/customer-form.bftDownload?session=${session}&doc=${doc}&format=${format}`) }))
  const stage = bftStage(state)
  const artifacts: BftArtifact[] = []
  if (state.deep) {
    artifacts.push({
      kind: 'deep', label: 'Полный БФТ', url: page, note: STAGE_LABEL[stage].replace(/^Полный БФТ /, ''),
      ...(state.deep.stage === 'ready' ? { downloads: downloads('deep') } : {}),
    })
  }
  if (state.fast) {
    artifacts.push({
      kind: 'fast', label: 'Первичные требования', url: state.deep ? `${page}&view=fast` : page,
      note: state.fast.approvedAt ? 'согласованы' : 'на проверке', downloads: downloads('fast'),
    })
  }
  if (state.demo) {
    artifacts.push({ kind: 'demo', label: 'Сценарий приёмки (HowToDemo)', url: urls.portal(`/api/customer-form.demo?session=${session}`), note: state.demo.approvedAt ? 'согласован' : 'на согласовании' })
  }
  const form = state.form?.publishedAt && !state.form.revokedAt ? state.form : undefined
  if (form) artifacts.push({ kind: 'form', label: 'Форма вопросов согласования', url: urls.form(form.id), note: `ответов ${form.answered} из ${form.total}` })
  if (urls.ticket) artifacts.push({ kind: 'ticket', label: `Заявка #${item.taskId} в трекере`, url: urls.ticket })
  if (urls.lifecycle) artifacts.push({ kind: 'lifecycle', label: 'Жизненный цикл заявки', url: urls.lifecycle, note: 'хроника событий' })
  const times = [item.created, state.deep?.finishedAt, state.deep?.startedAt, state.fast?.approvedAt, state.demo?.approvedAt].filter((t): t is string => !!t)
  return {
    sessionId: item.sessionId,
    taskId: item.taskId,
    title: item.title,
    created: item.created,
    ...(item.status ? { status: item.status } : {}),
    stage,
    stageLabel: state.lifecycle && lifecycleStage(state)
      ? `${LIFECYCLE_LABEL[state.lifecycle.stage] ?? STAGE_LABEL[stage]}${state.lifecycle.waitingFor.length && state.lifecycle.stage === 'agreement' ? ` — ждём ${state.lifecycle.waitingFor.map(waitLabel).join(', ')}` : ''}`
      : STAGE_LABEL[stage],
    ...(state.lifecycle ? { lifecycle: state.lifecycle } : {}),
    chatUrl: urls.portal(`/?session=${session}`),
    ...(form ? { questions: { total: form.total, answered: form.answered } } : {}),
    updatedAt: times.sort().at(-1) ?? item.created,
    artifacts,
  }
}
