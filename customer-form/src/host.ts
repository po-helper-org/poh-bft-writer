/**
 * Узловая половина customer-form: заявка в беклоге Vikunja (ADR-0007).
 *
 * Чат заказчика — обычная сессия dsh; здесь только то, чего у dsh нет:
 * фиксация обращения задачей с лейблом «запрос» и связь «сессия → задача»
 * (файл в DSH_HOME — том контейнера переживает рестарты).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface Cfg {
  trackerUrl: string
  trackerPublicUrl: string
  trackerUser: string
  trackerPassword: string
  ticketsFile: string
}

export function cfgFromEnv(env: NodeJS.ProcessEnv): Cfg {
  return {
    trackerUrl: (env.TRACKER_URL ?? 'http://tracker:3456/api/v1').replace(/\/$/, ''),
    trackerPublicUrl: (env.TRACKER_PUBLIC_URL ?? 'http://127.0.0.1:3456').replace(/\/$/, ''),
    trackerUser: env.TRACKER_USER ?? 'bft-admin',
    trackerPassword: env.TRACKER_PASSWORD ?? '',
    ticketsFile: join(env.DSH_HOME ?? '/data', 'customer-form', 'tickets.json'),
  }
}

export interface Ticket {
  taskId: number
  url: string
  /** Когда заказчик нажал «Согласую» на сценарии приёмки (ISO). */
  demoApprovedAt?: string
}

/** Дата для людей: заказчик и PO — в Москве. */
function when(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' })
}

/** Постановка, собранная микродиалогом (задание владельца: 7 пунктов). */
export interface Intake {
  title: string
  customerName: string
  customerEmail: string
  summary: string
  asis: string
  gap: string
  tobe: string
  howToDemo: string[]
  glossary: { term: string; expansion: string }[]
  links: string[]
  openQuestions: string[]
}

/** Текст в HTML описания/комментария Vikunja (редактор tiptap хранит HTML). */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function paragraphs(text: string): string {
  return text.split(/\n+/).filter(Boolean).map((line) => `<p>${esc(line)}</p>`).join('')
}

function items(tag: 'ul' | 'ol', values: string[], empty: string): string {
  return values.length ? `<${tag}>${values.map((v) => `<li>${v}</li>`).join('')}</${tag}>` : `<p>${empty}</p>`
}

/** Описание задачи в согласованном формате первичной постановки БФТ. */
export function intakeHtml(intake: Intake, taskId: number, demoApprovedAt?: string): string {
  return [
    `<h1>Запрос инициативы #${taskId}</h1>`,
    `<p><strong>Заказчик:</strong> ${esc(intake.customerName)} &lt;${esc(intake.customerEmail)}&gt;</p>`,
    '<h2>Суть</h2>', paragraphs(intake.summary),
    '<h2>ASIS — как работает сейчас</h2>', paragraphs(intake.asis),
    '<h2>GAP — почему не устраивает</h2>', paragraphs(intake.gap),
    '<h2>TOBE — как должно работать</h2>', paragraphs(intake.tobe),
    `<h2>HowToDemo — сценарий приёмки${demoApprovedAt ? ` (согласован заказчиком ${when(demoApprovedAt)})` : ''}</h2>`, items('ol', intake.howToDemo.map(esc), '— уточнит PO —'),
    '<h2>Глоссарий</h2>',
    items('ul', intake.glossary.map((g) => `<strong>${esc(g.term)}</strong> — ${esc(g.expansion)}`), '— сокращений нет —'),
    '<h2>Ссылки</h2>', items('ul', intake.links.map((l) => `<a href="${esc(l)}">${esc(l)}</a>`), '— нет —'),
    '<h2>Открытые вопросы</h2>', items('ul', intake.openQuestions.map(esc), '— нет —'),
  ].join('')
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/

export class Backlog {
  private vkToken = ''
  private vkProject = 0
  private tickets: Promise<Record<string, Ticket>>
  /** Одна заявка на сессию даже при гонке «первое сообщение ↔ /request». */
  private pending = new Map<string, Promise<Ticket>>()

  constructor(private readonly cfg: Cfg, private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {
    this.tickets = readFile(cfg.ticketsFile, 'utf8')
      .then((s) => JSON.parse(s) as Record<string, Ticket>)
      .catch(() => ({}))
  }

  async find(sessionId: string): Promise<Ticket | undefined> {
    return (await this.tickets)[sessionId]
  }

  /** Заявка сессии: существующая или новая из текста первого обращения. */
  ensure(sessionId: string, text: string): Promise<Ticket> {
    const inFlight = this.pending.get(sessionId)
    if (inFlight) return inFlight
    const job = (async () => {
      const known = await this.find(sessionId)
      if (known) return known
      const ticket = await this.submit(text)
      await this.save(sessionId, ticket)
      return ticket
    })()
    this.pending.set(sessionId, job)
    job.catch(() => undefined).finally(() => this.pending.delete(sessionId))
    return job
  }

  private async save(sessionId: string, ticket: Ticket): Promise<void> {
    const all = await this.tickets
    all[sessionId] = ticket
    await mkdir(dirname(this.cfg.ticketsFile), { recursive: true })
    await writeFile(this.cfg.ticketsFile, JSON.stringify(all, undefined, 1), 'utf8')
  }

  /**
   * Заказчик сам согласовал сценарий приёмки: отметка в заявке (переживает
   * рестарт), комментарий с шагами и раскадровка файлом — PO видит, на что
   * именно заказчик сказал «да».
   */
  async approveDemo(sessionId: string, ticket: Ticket, steps: string[], done: string, storyboard: string): Promise<Ticket> {
    const approved = { ...ticket, demoApprovedAt: new Date().toISOString() }
    await this.save(sessionId, approved)
    const comment = [
      `<p><strong>✅ Заказчик согласовал сценарий приёмки</strong> — ${esc(when(approved.demoApprovedAt))}</p>`,
      items('ol', steps.map(esc), ''),
      `<p><strong>Работа принята, если:</strong> ${esc(done)}</p>`,
      '<p>Раскадровка по экранам — во вложении.</p>',
    ].join('')
    const headers = await this.vkHeaders()
    await this.fetchImpl(`${this.cfg.trackerUrl}/tasks/${ticket.taskId}/comments`, {
      method: 'PUT', headers, body: JSON.stringify({ comment }),
    })
    await this.attach(ticket, `howtodemo-${ticket.taskId}.md`, new TextEncoder().encode(storyboard))
    return approved
  }

  /** Вложение заказчика → файл задачи (грабля Vikunja: multipart PUT, поле files). */
  async attach(ticket: Ticket, name: string, bytes: Uint8Array): Promise<void> {
    const headers = await this.vkHeaders()
    const form = new FormData()
    form.append('files', new Blob([new Uint8Array(bytes)]), name)
    const res = await this.fetchImpl(`${this.cfg.trackerUrl}/tasks/${ticket.taskId}/attachments`, {
      method: 'PUT', headers: { authorization: headers.authorization }, body: form,
    })
    if (!res.ok) throw new Error(`трекер: вложение ${name} ${res.status}`)
  }

  /**
   * Итог микродиалога: описание задачи — постановка в формате БФТ, комментарий —
   * краткая сводка, вложение — файл полного контекста (HowToDemo п.10).
   */
  async finalize(ticket: Ticket, intake: Intake, transcript: string): Promise<void> {
    const headers = await this.vkHeaders()
    const task = `${this.cfg.trackerUrl}/tasks/${ticket.taskId}`
    // POST в Vikunja перезаписывает задачу целиком: меняем два поля у текущей.
    const current = (await (await this.fetchImpl(task, { headers })).json()) as Record<string, unknown>
    const res = await this.fetchImpl(task, {
      method: 'POST', headers,
      body: JSON.stringify({
        ...current,
        title: (intake.title || intake.summary).split('\n')[0].slice(0, 120),
        description: intakeHtml(intake, ticket.taskId, ticket.demoApprovedAt),
      }),
    })
    if (!res.ok) throw new Error(`трекер: обновление задачи ${res.status}`)
    const summary = [
      '<p><strong>Сводка ассистента портала</strong></p>',
      items('ul', [
        `Заказчик: ${esc(intake.customerName)} &lt;${esc(intake.customerEmail)}&gt;`,
        `Суть: ${esc(intake.summary)}`,
        `HowToDemo: шагов — ${intake.howToDemo.length}${ticket.demoApprovedAt ? ', согласован заказчиком' : ', НЕ согласован'}; глоссарий — ${intake.glossary.length}`,
        `Открытых вопросов: ${intake.openQuestions.length}`,
      ], ''),
      '<p>Полный контекст диалога — во вложении.</p>',
    ].join('')
    await this.fetchImpl(`${task}/comments`, { method: 'PUT', headers, body: JSON.stringify({ comment: summary }) })
    await this.attach(ticket, `context-${ticket.taskId}.md`, new TextEncoder().encode(transcript))
  }

  private async vkHeaders(): Promise<Record<string, string>> {
    if (!this.vkToken) {
      const res = await this.fetchImpl(`${this.cfg.trackerUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: this.cfg.trackerUser, password: this.cfg.trackerPassword }),
      })
      if (!res.ok) throw new Error(`трекер: вход ${res.status}`)
      this.vkToken = ((await res.json()) as { token: string }).token
    }
    return { authorization: `Bearer ${this.vkToken}`, 'content-type': 'application/json' }
  }

  private async projectId(): Promise<number> {
    if (this.vkProject) return this.vkProject
    const res = await this.fetchImpl(`${this.cfg.trackerUrl}/projects`, { headers: await this.vkHeaders() })
    const projects = (await res.json()) as { id: number; title: string }[]
    const found = projects.find((p) => p.title.startsWith('БФТ'))
    if (!found) throw new Error('трекер: проект БФТ не найден (посейте: start.sh)')
    this.vkProject = found.id
    return found.id
  }

  private async submit(text: string): Promise<Ticket> {
    const body = text.trim()
    const email = EMAIL.exec(body)?.[0]
    const description = [
      '<h1>Запрос инициативы (портал заказчика)</h1>',
      `<p><strong>Заказчик:</strong> ${email ? `&lt;${esc(email)}&gt;` : 'уточняется в диалоге'}</p>`,
      body ? paragraphs(body) : '<p>(текст будет добавлен в диалоге)</p>',
    ].join('')

    const pid = await this.projectId()
    const res = await this.fetchImpl(`${this.cfg.trackerUrl}/projects/${pid}/tasks`, {
      method: 'PUT',
      headers: await this.vkHeaders(),
      body: JSON.stringify({ title: body.split('\n')[0].slice(0, 80) || 'Запрос заказчика', description }),
    })
    if (res.status !== 201) throw new Error(`трекер: создание задачи ${res.status}`)
    const taskId = ((await res.json()) as { id: number }).id

    // Лейбл «запрос» (грабля Vikunja: только отдельным PUT). Не роняет заявку.
    try {
      const labels = await this.fetchImpl(`${this.cfg.trackerUrl}/labels`, { headers: await this.vkHeaders() })
      const label = ((await labels.json()) as { id: number; title: string }[]).find((l) => l.title === 'запрос')
      if (label) {
        await this.fetchImpl(`${this.cfg.trackerUrl}/tasks/${taskId}/labels`, {
          method: 'PUT', headers: await this.vkHeaders(), body: JSON.stringify({ label_id: label.id }),
        })
      }
    } catch { /* лейбл — косметика */ }

    return { taskId, url: `${this.cfg.trackerPublicUrl}/tasks/${taskId}` }
  }
}

let shared: Backlog | undefined

/**
 * Один Backlog на процесс: им пользуются и узел customer-form (заявка по первому
 * сообщению), и инструмент сдачи внутри пресета агента (customer-form/tool).
 */
export function sharedBacklog(): Backlog {
  shared ??= new Backlog(cfgFromEnv(process.env))
  return shared
}
