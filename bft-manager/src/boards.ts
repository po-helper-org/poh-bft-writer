/**
 * Две воронки PO поверх Vikunja (ADR-0009).
 *
 * Обе живут в квартальном проекте «БФТ …» (ADR-0004: проекты по кварталам,
 * задача = инициатива) отдельными канбан-видами с фильтром по лейблу:
 *
 *  - «Запросы» — `labels in <запрос>`: корневые задачи портала заказчика;
 *  - «БФТ-требования» — `labels in <бфт>`: задачи «Проработка БФТ».
 *
 * Статус = колонка вида. Запрос связан со своей проработкой отношением
 * `subtask` (у проработки он — `parenttask`), поэтому к одному БФТ можно
 * прикрепить несколько запросов. Виды и колонки создаются здесь при первом
 * обращении (идемпотентно) — сотрудники видят те же доски в UI Vikunja.
 */
import {
  BFT_STATUSES, escapeHtml, REQUEST_STATUSES, STATUS_NEEDS_ASSIGNEE, statusComment, statusOfComment,
  type Board, type BoardKind, type Card, type Column, type LinkRef, type MoveRequest, type MoveResult, type Overview, type Person,
} from './model.js'
import type { Tracker } from './tracker.js'

interface VkUser { id: number; username: string; name: string }
interface VkLabel { id: number; title: string }
interface VkRelated { id: number; title: string; labels?: VkLabel[] | null }
interface VkTask {
  id: number
  title: string
  created: string
  updated: string
  done: boolean
  assignees: VkUser[] | null
  labels: VkLabel[] | null
  attachments: { file: { name: string } }[] | null
  related_tasks: Record<string, VkRelated[] | null> | null
}
interface VkBucket { id: number; title: string; position: number; count?: number; tasks?: VkTask[] | null }
interface VkView { id: number; title: string; view_kind: string; default_bucket_id: number; done_bucket_id: number }
interface VkProject { id: number; title: string; owner?: VkUser; views?: VkView[] }
interface VkComment { comment: string; created: string }

const BOARDS: Record<BoardKind, { view: string; label: string; color: string; statuses: readonly string[] }> = {
  requests: { view: 'Запросы', label: 'запрос', color: '69758a', statuses: REQUEST_STATUSES },
  bft: { view: 'БФТ-требования', label: 'бфт', color: '1d4ed8', statuses: BFT_STATUSES },
}

/** Ограничение Vikunja на страницу (max_items_per_page в /info). */
const PAGE = 50

/** Ошибка запроса PO (неверный статус, нет ответственного) — уходит на страницу текстом. */
export class BadRequest extends Error {}

interface Ready {
  projectId: number
  owner?: VkUser
  labels: Record<BoardKind, number>
  views: Record<BoardKind, VkView>
}

interface Since { bucketId: number; since: string; exact: boolean }

interface Loaded { board: Board; tasks: Map<number, VkTask> }

export class BftBoards {
  private ready?: Promise<Ready>
  /** Момент входа в текущий статус: задача → колонка и время (сбрасывается, если колонка другая). */
  private readonly since = new Map<number, Since>()

  constructor(private readonly tracker: Tracker) {}

  async overview(): Promise<Overview> {
    const ready = await this.setup()
    const [requests, bft, people] = await Promise.all([this.load(ready, 'requests'), this.load(ready, 'bft'), this.people(ready)])
    // Перекрёстные ссылки: у запроса — его БФТ, у БФТ — прикреплённые запросы.
    link(requests, bft, 'subtask')
    link(bft, requests, 'parenttask')
    return { requests: requests.board, bft: bft.board, people, trackerUrl: this.tracker.cfg.publicUrl, loadedAt: new Date().toISOString() }
  }

  async move(req: MoveRequest): Promise<MoveResult> {
    const ready = await this.setup()
    const spec = BOARDS[req.kind]
    if (!spec) throw new BadRequest(`неизвестная доска: ${String(req.kind)}`)
    const view = ready.views[req.kind]
    const buckets = await this.tracker.get<VkBucket[]>(`/projects/${ready.projectId}/views/${view.id}/buckets`)
    const target = buckets.find((b) => b.title === req.status)
    if (!target) throw new BadRequest(`статуса «${req.status}» нет на доске «${spec.view}»`)
    let task = await this.tracker.get<VkTask>(`/tasks/${req.taskId}`)
    if (!task.labels?.some((l) => l.id === ready.labels[req.kind])) throw new BadRequest(`задача #${req.taskId} не с доски «${spec.view}»`)

    const known = this.since.get(task.id)
    const from = buckets.find((b) => b.id === known?.bucketId)?.title ?? '—'

    if (req.assigneeId && req.assigneeId !== task.assignees?.[0]?.id) task = await this.assign(task, req.assigneeId)
    let bft: MoveResult['bft']
    let extra = ''
    if (req.kind === 'requests' && req.status === STATUS_NEEDS_ASSIGNEE) {
      const owner = task.assignees?.[0]
      if (!owner) throw new BadRequest('Для статуса «Ожидает PO» назначьте ответственного за инициативу')
      bft = await this.attachBft(ready, task, owner, req.attachTo)
      extra = `<p>Ответственный: ${escapeHtml(personOf(owner).name)}. ${bft.created ? 'Заведена' : 'Прикреплён к'} проработка БФТ <a href="${this.taskUrl(bft.id)}">#${bft.id}</a>.</p>`
    }

    await this.tracker.post(`/projects/${ready.projectId}/views/${view.id}/buckets/${target.id}/tasks`, { task_id: task.id })
    await this.tracker.put(`/tasks/${task.id}/comments`, { comment: statusComment(from, target.title, extra) })
    const entry = { bucketId: target.id, since: new Date().toISOString(), exact: true }
    this.since.set(task.id, entry)
    return { card: this.card(task, target, entry), bft }
  }

  /** Виды, колонки и лейблы — создаются один раз; при сбое следующий вызов пробует снова. */
  private setup(): Promise<Ready> {
    if (!this.ready) {
      this.ready = this.prepare()
      this.ready.catch(() => { this.ready = undefined })
    }
    return this.ready
  }

  private async prepare(): Promise<Ready> {
    const projects = await this.tracker.get<VkProject[]>('/projects')
    // Тот же квартальный проект, куда портал заказчика кладёт запросы (customer-form/host.ts).
    const project = projects.find((p) => p.title.startsWith('БФТ'))
    if (!project) throw new Error('трекер: проект «БФТ …» не найден (посейте: harness/start.sh)')
    const labels = await this.tracker.get<VkLabel[]>('/labels?per_page=50')
    const labelIds = {} as Record<BoardKind, number>
    const views = {} as Record<BoardKind, VkView>
    for (const kind of Object.keys(BOARDS) as BoardKind[]) {
      const spec = BOARDS[kind]
      labelIds[kind] = labels.find((l) => l.title === spec.label)?.id
        ?? (await this.tracker.put<VkLabel>('/labels', { title: spec.label, hex_color: spec.color })).id
      const existing = project.views?.find((v) => v.view_kind === 'kanban' && v.title === spec.view)
      views[kind] = existing ?? await this.createView(project.id, spec.view, labelIds[kind], spec.statuses)
      await this.ensureBuckets(project.id, views[kind], spec.statuses)
    }
    return { projectId: project.id, owner: project.owner, labels: labelIds, views }
  }

  /**
   * Новый канбан-вид Vikunja приходит с колонками To-Do/Doing/Done и Done как
   * «колонкой выполнено». Ставим колонками статусы воронки, первую — колонкой
   * по умолчанию (туда попадают новые задачи с лейблом), «выполнено» снимаем:
   * «Отменено» и «Утвержден» не должны закрывать задачу.
   */
  private async createView(projectId: number, title: string, labelId: number, statuses: readonly string[]): Promise<VkView> {
    const base = `/projects/${projectId}/views`
    const view = await this.tracker.put<VkView>(base, { title, view_kind: 'kanban', bucket_configuration_mode: 'manual', filter: { filter: `labels in ${labelId}` } })
    const stock = await this.tracker.get<VkBucket[]>(`${base}/${view.id}/buckets`)
    const first = await this.ensureBuckets(projectId, view, statuses)
    const updated = await this.tracker.post<VkView>(`${base}/${view.id}`, { ...view, default_bucket_id: first, done_bucket_id: 0 })
    for (const bucket of stock) {
      if (!statuses.includes(bucket.title)) await this.tracker.delete(`${base}/${view.id}/buckets/${bucket.id}`)
    }
    return updated
  }

  /** Недостающие колонки статусов (PO мог удалить колонку в Vikunja). Возвращает id первой. */
  private async ensureBuckets(projectId: number, view: VkView, statuses: readonly string[]): Promise<number> {
    const path = `/projects/${projectId}/views/${view.id}/buckets`
    const buckets = await this.tracker.get<VkBucket[]>(path)
    let first = 0
    for (const [i, title] of statuses.entries()) {
      const id = buckets.find((b) => b.title === title)?.id
        ?? (await this.tracker.put<VkBucket>(path, { title, position: (i + 1) * 1000 })).id
      if (i === 0) first = id
    }
    return first
  }

  private async load(ready: Ready, kind: BoardKind): Promise<Loaded> {
    const view = ready.views[kind]
    const base = `/projects/${ready.projectId}/views/${view.id}/tasks`
    const buckets = await this.tracker.get<VkBucket[]>(`${base}?per_page=${PAGE}`)
    // Вид отдаёт по странице на колонку; хвост длинной колонки — фильтром по ней.
    await Promise.all(buckets.map(async (bucket) => {
      const tasks = bucket.tasks ?? []
      for (let page = 2; tasks.length < (bucket.count ?? 0) && tasks.length === (page - 1) * PAGE; page++) {
        const filter = encodeURIComponent(`bucket_id = ${bucket.id}`)
        tasks.push(...await this.tracker.get<VkTask[]>(`${base}?per_page=${PAGE}&page=${page}&filter=${filter}`))
      }
      bucket.tasks = tasks
    }))

    const tasks = new Map<number, VkTask>()
    const jobs: (() => Promise<void>)[] = []
    const columns: Column[] = order(buckets, BOARDS[kind].statuses).map((bucket) => {
      const column: Column = { bucketId: bucket.id, title: bucket.title, count: bucket.tasks?.length ?? 0, cards: [] }
      for (const task of bucket.tasks ?? []) {
        tasks.set(task.id, task)
        const index = column.cards.length
        column.cards.push(this.card(task, bucket, { bucketId: bucket.id, since: task.created, exact: true }))
        jobs.push(async () => { column.cards[index] = this.card(task, bucket, await this.sinceOf(task, bucket, view)) })
      }
      return column
    })
    await pool(jobs, 8)
    for (const column of columns) column.cards.sort((a, b) => Date.parse(a.since) - Date.parse(b.since)) // дольше всех висящие — сверху
    const viewUrl = `${this.tracker.cfg.publicUrl}/projects/${ready.projectId}/${view.id}`
    return { board: { kind, viewId: view.id, viewUrl, columns }, tasks }
  }

  /**
   * С какого момента задача в колонке. Перемещение в Vikunja не трогает даже
   * `updated`, поэтому источник — комментарий-отметка «Статус: … → …», который
   * пишет move(). В первой колонке без отметки — дата создания. Если задачу
   * двигали в UI Vikunja (отметки нет) — последнее изменение, неточно.
   */
  private async sinceOf(task: VkTask, bucket: VkBucket, view: VkView): Promise<Since> {
    const known = this.since.get(task.id)
    if (known?.bucketId === bucket.id) return known
    let entry: Since
    const comments = await this.tracker.get<VkComment[]>(`/tasks/${task.id}/comments`).catch(() => [] as VkComment[])
    const mark = comments.filter((c) => statusOfComment(c.comment) === bucket.title).sort((a, b) => Date.parse(b.created) - Date.parse(a.created))[0]
    if (mark) entry = { bucketId: bucket.id, since: mark.created, exact: true }
    else if (bucket.id === view.default_bucket_id) entry = { bucketId: bucket.id, since: task.created, exact: true }
    else entry = { bucketId: bucket.id, since: task.updated, exact: false }
    this.since.set(task.id, entry)
    return entry
  }

  /** Кого можно назначить: все, у кого есть доступ к проекту (как поиск исполнителя в Vikunja). */
  private async people(ready: Ready): Promise<Person[]> {
    const users = await this.tracker.get<VkUser[]>(`/projects/${ready.projectId}/projectusers`).catch(() => [] as VkUser[])
    const all = new Map<number, Person>()
    for (const user of [...(ready.owner ? [ready.owner] : []), ...users]) all.set(user.id, personOf(user))
    return [...all.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }

  /** Ответственный — один: прежних исполнителей снимаем. */
  private async assign(task: VkTask, userId: number): Promise<VkTask> {
    await this.tracker.put(`/tasks/${task.id}/assignees`, { user_id: userId })
    for (const user of task.assignees ?? []) {
      if (user.id !== userId) await this.tracker.delete(`/tasks/${task.id}/assignees/${user.id}`)
    }
    return this.tracker.get<VkTask>(`/tasks/${task.id}`)
  }

  /**
   * Проработка БФТ для запроса: существующая (выбрал PO или уже прикреплена)
   * или новая — в Backlog доски БФТ с тем же ответственным.
   */
  private async attachBft(ready: Ready, request: VkTask, owner: VkUser, attachTo: MoveRequest['attachTo']): Promise<NonNullable<MoveResult['bft']>> {
    const isBft = (t: { labels?: VkLabel[] | null }) => !!t.labels?.some((l) => l.id === ready.labels.bft)
    const linked: VkTask[] = []
    for (const rel of request.related_tasks?.subtask ?? []) {
      const full = isBft(rel) ? rel as VkTask : await this.tracker.get<VkTask>(`/tasks/${rel.id}`)
      if (isBft(full)) linked.push(full)
    }

    if (typeof attachTo === 'number') {
      const target = await this.tracker.get<VkTask>(`/tasks/${attachTo}`)
      if (!isBft(target)) throw new BadRequest(`задача #${attachTo} — не проработка БФТ`)
      if (!linked.some((t) => t.id === target.id)) {
        await this.tracker.put(`/tasks/${request.id}/relations`, { other_task_id: target.id, relation_kind: 'subtask' })
        await this.tracker.put(`/tasks/${target.id}/comments`, {
          comment: `<p>📎 Прикреплён запрос <a href="${this.taskUrl(request.id)}">#${request.id}</a> «${escapeHtml(request.title)}».</p>`,
        })
      }
      return { id: target.id, title: target.title, created: false }
    }
    if (attachTo !== 'new' && linked[0]) return { id: linked[0].id, title: linked[0].title, created: false }

    const title = `Проработка БФТ: ${request.title}`.slice(0, 250)
    const description = [
      `<p>Проработка БФТ-требований по запросу <a href="${this.taskUrl(request.id)}">#${request.id}</a> «${escapeHtml(request.title)}».</p>`,
      `<p>Цикл: ${BFT_STATUSES.join(' → ')}. БФТ-требованием задача становится, когда собраны первичные требования и приложен .html-шаблон.</p>`,
    ].join('')
    const created = await this.tracker.put<VkTask>(`/projects/${ready.projectId}/tasks`, { title, description })
    await this.tracker.put(`/tasks/${created.id}/labels`, { label_id: ready.labels.bft })
    await this.tracker.put(`/tasks/${created.id}/assignees`, { user_id: owner.id })
    await this.tracker.put(`/tasks/${request.id}/relations`, { other_task_id: created.id, relation_kind: 'subtask' })
    return { id: created.id, title, created: true }
  }

  private card(task: VkTask, bucket: VkBucket, since: Since): Card {
    const owner = task.assignees?.[0]
    return {
      id: task.id,
      title: task.title,
      status: bucket.title,
      bucketId: bucket.id,
      since: since.since,
      sinceExact: since.exact,
      created: task.created,
      assignee: owner ? personOf(owner) : null,
      links: [],
      hasHtml: !!task.attachments?.some((a) => /\.html?$/i.test(a.file.name)),
      url: this.taskUrl(task.id),
    }
  }

  private taskUrl(id: number): string {
    return `${this.tracker.cfg.publicUrl}/tasks/${id}`
  }
}

function personOf(user: VkUser): Person {
  return { id: user.id, username: user.username, name: user.name || user.username }
}

/** Колонки в порядке воронки; колонки, которые PO добавил в Vikunja сам, — следом. */
function order(buckets: VkBucket[], statuses: readonly string[]): VkBucket[] {
  const rank = (b: VkBucket) => { const i = statuses.indexOf(b.title); return i < 0 ? statuses.length : i }
  return [...buckets].sort((a, b) => rank(a) - rank(b) || a.position - b.position)
}

/** Ссылки карточек `from` на задачи доски `to` по виду связи Vikunja. */
function link(from: Loaded, to: Loaded, kind: 'subtask' | 'parenttask'): void {
  const status = new Map<number, string>()
  for (const column of to.board.columns) for (const card of column.cards) status.set(card.id, card.status)
  for (const column of from.board.columns) {
    for (const card of column.cards) {
      const related = from.tasks.get(card.id)?.related_tasks?.[kind] ?? []
      card.links = related.filter((r) => to.tasks.has(r.id)).map((r): LinkRef => ({ id: r.id, title: r.title, status: status.get(r.id) }))
    }
  }
}

async function pool(jobs: (() => Promise<void>)[], size: number): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (next < jobs.length) await jobs[next++]()
  }))
}
