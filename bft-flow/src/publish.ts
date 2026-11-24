/**
 * ConfluencePublish — отправка собранного БФТ в Confluence (ADR-0028).
 *
 * Отдельный короткий workflow на каждую отправку: `bft-<taskId>-confluence-<n>`. Четыре
 * активности исполнителя публикации (очередь bft-confluence — у него ключ записи и сеть
 * до Confluence, файлы заявки — общий том с порталом), итог в трекер — активность портала:
 * преобразование → страница (создать / обновить) → вложения → итог. У каждой свои
 * таймауты и повторы; отказ Confluence, который повтором не лечится (нет прав, нет
 * родителя, чужая страница с тем же названием), приходит типом `ConfluenceRejected` и не
 * повторяется. Ход — query `progress`: его показывает портал и видно в Temporal UI.
 * Без модели: всё детерминированно, повтор истории безопасен.
 */
import { ApplicationFailure, type RetryPolicy, defineQuery, proxyActivities, setHandler, upsertSearchAttributes } from '@temporalio/workflow'
import { PORTAL_TASK_QUEUE } from './events.js'
import { BFT_TASK_ID } from './search-attributes.js'

export const PUBLISH_WORKFLOW_TYPE = 'ConfluencePublish'
/** Очередь исполнителя публикации (`confluence-publisher`): ключ записи и сеть до Confluence — только у него. */
export const CONFLUENCE_TASK_QUEUE = 'bft-confluence'
export const publishWorkflowId = (taskId: number, run: number): string => `bft-${taskId}-confluence-${run}`

export interface ParentRef { id: string; title: string; space?: string; url?: string }
export interface PublishRequest { taskId: number; slug: string; sessionId: string; parent: ParentRef; by?: string; run: number }
export interface FileRef { path: string; sha256: string; name: string; contentType: string; size: number }
export interface RenderResult { title: string; labels: string[]; body: FileRef; attachments: FileRef[]; warnings: string[] }
export interface PageResult { pageId: string; url: string; version: number; mode: 'create' | 'update'; title: string }
export interface AttachResult { uploaded: string[]; skipped: string[]; names: Record<string, string> }
export interface FinishResult { url: string; pageId: string }
export interface AncestorInfo { id: string; space?: string; parent?: { id: string; title: string } }

/** Активности портала (копия — customer-form/src/confluence-publish.ts). */
export interface PublishActivities {
  confluenceRender(req: PublishRequest): Promise<RenderResult>
  confluenceUpsertPage(req: PublishRequest, render: RenderResult): Promise<PageResult>
  confluenceAttach(req: PublishRequest, render: RenderResult, page: PageResult): Promise<AttachResult>
  confluenceFinish(req: PublishRequest, render: RenderResult, page: PageResult, attach: AttachResult): Promise<FinishResult>
  confluenceAncestors(ids: string[]): Promise<AncestorInfo[]>
}

/** Активность портала (bft-portal): итог — комментарием в задачу трекера и записью в хронику цикла. */
export interface AnnounceActivities {
  confluenceAnnounce(req: PublishRequest, page: { pageId: string; url: string; mode: 'create' | 'update' }): Promise<void>
}

export type StepKey = 'render' | 'page' | 'attachments' | 'done'
export type StepStatus = 'pending' | 'running' | 'done' | 'failed'
export interface PublishStep { key: StepKey; label: string; status: StepStatus; detail?: string; attempt?: number }
export interface PublishProgress {
  taskId: number
  run: number
  parent: ParentRef
  steps: PublishStep[]
  status: 'running' | 'done' | 'failed'
  url?: string
  pageId?: string
  error?: string
  warnings: string[]
  startedAt: string
  finishedAt?: string
}

export const progressQuery = defineQuery<PublishProgress>('progress')

const REJECTED = 'ConfluenceRejected'
const retry: RetryPolicy = { initialInterval: '10 seconds', backoffCoefficient: 2, maximumInterval: '2 minutes', maximumAttempts: 5, nonRetryableErrorTypes: [REJECTED] }

const render = proxyActivities<PublishActivities>({ taskQueue: CONFLUENCE_TASK_QUEUE, startToCloseTimeout: '5 minutes', scheduleToCloseTimeout: '30 minutes', retry: { ...retry, maximumAttempts: 3 } })
const page = proxyActivities<PublishActivities>({ taskQueue: CONFLUENCE_TASK_QUEUE, startToCloseTimeout: '2 minutes', scheduleToCloseTimeout: '30 minutes', retry })
const attach = proxyActivities<PublishActivities>({ taskQueue: CONFLUENCE_TASK_QUEUE, startToCloseTimeout: '10 minutes', scheduleToCloseTimeout: '1 hour', retry })

// Итог в трекер и хронику — портал; не дошло (портал на выкладке) — отправка всё равно удалась.
const portal = proxyActivities<AnnounceActivities>({ taskQueue: PORTAL_TASK_QUEUE, startToCloseTimeout: '1 minute', scheduleToCloseTimeout: '10 minutes', retry: { initialInterval: '30 seconds', backoffCoefficient: 2, maximumAttempts: 5 } })
const lookup = proxyActivities<PublishActivities>({ taskQueue: CONFLUENCE_TASK_QUEUE, startToCloseTimeout: '20 seconds', scheduleToCloseTimeout: '30 seconds', retry: { maximumAttempts: 1 } })

/** Родители страниц для ТОП-5 (портал до Confluence на запись не дотягивается — спрашивает исполнителя). */
export async function ConfluenceLookup(ids: string[]): Promise<AncestorInfo[]> {
  return lookup.confluenceAncestors(ids)
}

const causeOf = (e: unknown): string => {
  let cur = e as { cause?: unknown; message?: string } | undefined
  while (cur?.cause) cur = cur.cause as typeof cur
  return cur?.message ?? String(e)
}

export async function ConfluencePublish(req: PublishRequest): Promise<PublishProgress> {
  const progress: PublishProgress = {
    taskId: req.taskId, run: req.run, parent: req.parent, status: 'running', warnings: [], startedAt: new Date().toISOString(),
    steps: [
      { key: 'render', label: 'Преобразование в формат Confluence', status: 'pending' },
      { key: 'page', label: 'Создание или обновление страницы', status: 'pending' },
      { key: 'attachments', label: 'Вложения: схемы, .docx, .pdf', status: 'pending' },
      { key: 'done', label: 'Готово', status: 'pending' },
    ],
  }
  setHandler(progressQuery, () => progress)
  upsertSearchAttributes([{ key: BFT_TASK_ID, value: req.taskId }])

  const step = (key: StepKey) => progress.steps.find((s) => s.key === key)!
  const run = async <T>(key: StepKey, fn: () => Promise<T>, detail: (r: T) => string | undefined): Promise<T> => {
    const s = step(key)
    s.status = 'running'
    try {
      const result = await fn()
      s.status = 'done'
      const d = detail(result)
      if (d) s.detail = d
      return result
    } catch (e) {
      s.status = 'failed'
      s.detail = causeOf(e)
      progress.status = 'failed'
      progress.error = s.detail
      progress.finishedAt = new Date().toISOString()
      // Workflow — «Failed» в Temporal UI, причина — та же строка, что видит пользователь.
      throw ApplicationFailure.nonRetryable(s.detail, key === 'render' ? 'RenderFailed' : REJECTED)
    }
  }

  const rendered = await run('render', () => render.confluenceRender(req), (r) => {
    progress.warnings.push(...r.warnings)
    return `«${r.title}», вложений: ${r.attachments.length}`
  })
  const pageResult = await run('page', () => page.confluenceUpsertPage(req, rendered), (r) => {
    progress.pageId = r.pageId
    progress.url = r.url
    return r.mode === 'create' ? 'страница создана' : `страница обновлена (версия ${r.version})`
  })
  const attached = await run('attachments', () => attach.confluenceAttach(req, rendered, pageResult), (r) =>
    r.uploaded.length || r.skipped.length ? `загружено ${r.uploaded.length}${r.skipped.length ? `, без изменений ${r.skipped.length}` : ''}` : 'вложений нет')
  const finished = await run('done', () => page.confluenceFinish(req, rendered, pageResult, attached), (r) => {
    progress.url = r.url
    return undefined
  })
  progress.status = 'done'
  progress.url = finished.url
  progress.finishedAt = new Date().toISOString()
  // Ход уже «готово» (query) — комментарий в трекер дописывается следом.
  await portal.confluenceAnnounce(req, { pageId: finished.pageId, url: finished.url, mode: pageResult.mode }).catch(() => {
    progress.warnings.push('Комментарий в задачу трекера не записан — портал был недоступен')
  })
  return progress
}
