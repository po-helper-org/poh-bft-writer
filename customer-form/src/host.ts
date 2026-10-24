/**
 * Узловая половина customer-form (ADR-0007): заявка в Vikunja + микродиалог
 * на glm-5-turbo. Порт логики портала (portal/app.py) в контейнер харнесса:
 * никакого своего сервиса — плагин ходит в трекер и модель сам, состоянием
 * живёт в DSH_HOME (том контейнера). Компоненты UI — канон dsh (клиент).
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface Cfg {
  trackerUrl: string
  trackerPublicUrl: string
  trackerUser: string
  trackerPassword: string
  zaiKey: string
  model: string
  dataDir: string
}

export function cfgFromEnv(env: NodeJS.ProcessEnv): Cfg {
  return {
    trackerUrl: (env.TRACKER_URL ?? 'http://tracker:3456/api/v1').replace(/\/$/, ''),
    trackerPublicUrl: (env.TRACKER_PUBLIC_URL ?? 'http://127.0.0.1:3456').replace(/\/$/, ''),
    trackerUser: env.TRACKER_USER ?? 'bft-admin',
    trackerPassword: env.TRACKER_PASSWORD ?? '',
    zaiKey: env.ZAI_API_KEY ?? '',
    model: env.PORTAL_MODEL ?? 'glm-5-turbo',
    dataDir: join(env.CUSTOMER_FORM_DATA ?? join(env.DSH_HOME ?? '/data', 'customer-form'), 'requests'),
  }
}

/** Канон постановки БФТ — что собирает диалог (задание владельца). */
export const FIELDS = ['customer', 'summary', 'asis', 'gap', 'tobe', 'howtodemo', 'glossary'] as const
export type FieldKey = (typeof FIELDS)[number]
export const FIELD_TITLES: Record<FieldKey, string> = {
  customer: 'Заказчик (ФИО + email)',
  summary: 'Суть инициативы',
  asis: 'ASIS — как работает сейчас',
  gap: 'GAP — почему не устраивает',
  tobe: 'TOBE — как должно работать',
  howtodemo: 'HowToDemo — сценарий приёмки',
  glossary: 'Глоссарий сокращений',
}

const SYSTEM_PROMPT = `Ты — ассистент сбора постановки БФТ. Заказчик уже описал инициативу.
Твоя задача — ДОБРАТЬ контекст по полям и НЕ мучить лишними вопросами.

Поля: customer (ФИО+email), summary (суть), asis (как сейчас), gap (почему не устраивает),
tobe (как должно), howtodemo (пошаговый сценарий приёмки: где и как заказчик проверит работу),
glossary (расшифровка всех сокращений/аббревиатур из текста).

Правила:
- Отвечай КОРОТКО (1-3 предложения), по-русски, живо, без канцелярита.
- За один ход спрашивай ТОЛЬКО о самых важных пробелах (максимум 2-3 вопроса, можно списком).
- Сокращение без расшифровки — спроси расшифровку, добавь в glossary.
- Когда все поля заполнены достаточно — попрощайся одним предложением, questions=[].
- howtodemo: если заказчик не описал, спроси «как и где вы будете проверять результат? по шагам».

Ответ СТРОГО JSON:
{"reply": "текст заказчику",
 "fields": {"customer": "...|null", "summary": "...|null", "asis": "...|null", "gap": "...|null", "tobe": "...|null", "howtodemo": "...|null", "glossary": [{"term": "...", "expansion": "..."}]},
 "questions": ["вопрос1", ...]}`

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface RequestState {
  messages: { role: string; content: string }[]
  fields: Partial<Record<FieldKey, string>>
  glossary: { term: string; expansion: string }[]
  email: string
  name: string
  initial?: { text: string; links: string[]; files: string[] }
}

export class CustomerForm {
  private vkToken = ''
  private vkProject = 0

  constructor(private readonly cfg: Cfg, private readonly fetchImpl: FetchLike = ((u, i) => fetch(u, i))) {}

  async health(): Promise<{ model: boolean; tracker: boolean }> {
    return { model: Boolean(this.cfg.zaiKey), tracker: Boolean(this.cfg.trackerPassword) }
  }

  // ── Vikunja ──────────────────────────────────────────────────────────────
  private async vkHeaders(): Promise<Record<string, string>> {
    if (!this.vkToken) {
      const res = await this.fetchImpl(`${this.cfg.trackerUrl}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: this.cfg.trackerUser, password: this.cfg.trackerPassword }),
      })
      if (!res.ok) throw new Error(`трекер: вход ${res.status}`)
      this.vkToken = (await res.json() as { token: string }).token
    }
    return { authorization: `Bearer ${this.vkToken}`, 'content-type': 'application/json' }
  }

  private async projectId(): Promise<number> {
    if (this.vkProject) return this.vkProject
    const res = await this.fetchImpl(`${this.cfg.trackerUrl}/projects`, { headers: await this.vkHeaders() })
    const projects = (await res.json()) as { id: number; title: string }[]
    const found = projects.find((p) => p.title.startsWith('БФТ'))
    if (!found) throw new Error('проект БФТ не найден')
    this.vkProject = found.id
    return found.id
  }

  // ── состояние диалога (файлы в DSH_HOME) ────────────────────────────────
  private stateFile(taskId: number): string {
    return join(this.cfg.dataDir, String(taskId), 'state.json')
  }

  async loadState(taskId: number): Promise<RequestState> {
    try {
      return JSON.parse(await readFile(this.stateFile(taskId), 'utf8')) as RequestState
    } catch {
      return { messages: [], fields: {}, glossary: [], email: '', name: '' }
    }
  }

  private async saveState(taskId: number, st: RequestState): Promise<void> {
    const file = this.stateFile(taskId)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(file, '..'), { recursive: true })
    await writeFile(file, JSON.stringify(st, undefined, 1), 'utf8')
  }

  private mergeFields(st: RequestState, fields: Record<string, unknown> | undefined,
                      glossary: { term?: string; expansion?: string }[] | undefined): void {
    for (const k of FIELDS) {
      if (k === 'glossary') continue
      const v = fields?.[k]
      if (typeof v === 'string' && v.trim() && !st.fields[k]) st.fields[k] = v.trim()
    }
    const seen = new Set(st.glossary.map((g) => g.term.toLowerCase()))
    for (const g of glossary ?? []) {
      const term = (g.term ?? '').trim()
      const expansion = (g.expansion ?? '').trim()
      if (term && expansion && !seen.has(term.toLowerCase())) {
        st.glossary.push({ term, expansion })
        seen.add(term.toLowerCase())
      }
    }
  }

  scorecard(st: RequestState): { rows: { key: FieldKey; title: string; filled: boolean }[]; done: number; total: number } {
    const rows = FIELDS.map((k) => ({
      key: k, title: FIELD_TITLES[k],
      filled: Boolean(st.fields[k]) || (k === 'glossary' && st.glossary.length > 0),
    }))
    return { rows, done: rows.filter((r) => r.filled).length, total: rows.length }
  }

  // ── заявка ──────────────────────────────────────────────────────────────
  async upload(name: string, bytes: Uint8Array): Promise<{ ref: string; name: string }> {
    const rid = Math.random().toString(16).slice(2, 12)
    const dir = join(this.cfg.dataDir, 'inbox', rid)
    await mkdir(dir, { recursive: true })
    const safe = name.split('/').pop() ?? 'file'
    await writeFile(join(dir, safe), bytes)
    return { ref: `inbox/${rid}/${safe}`, name: safe }
  }

  async submit(input: { name: string; email: string; text: string; links: string[]; files: string[] }):
      Promise<{ taskId: number; url: string }> {
    if (!input.text.trim() && input.files.length === 0 && input.links.length === 0) {
      throw new Error('пустой запрос: нужен текст, файлы или ссылки')
    }
    const pid = await this.projectId()
    const desc = [
      '# Запрос инициативы (портал заказчика)', '',
      input.name || input.email ? `**Заказчик:** ${input.name} ${input.email ? `<${input.email}>` : ''}`.trim() : '',
      '', input.text.trim() || '(текст будет добавлен в диалоге)', '',
      input.links.length ? `**Ссылки:**\n- ${input.links.join('\n- ')}` : '',
      input.files.length ? `**Вложения:**\n- ${input.files.join('\n- ')}` : '',
    ].filter((x) => x !== '').join('\n')

    const res = await this.fetchImpl(`${this.cfg.trackerUrl}/projects/${pid}/tasks`, {
      method: 'PUT', headers: await this.vkHeaders(),
      body: JSON.stringify({ title: input.text.trim().slice(0, 80) || 'Запрос заказчика', description: desc }),
    })
    if (res.status !== 201) throw new Error(`трекер: ${res.status}`)
    const task = (await res.json()) as { id: number }
    const taskId = task.id

    // лейбл «запрос» и вложения (грабли Vikunja: только отдельными PUT)
    const labels = await this.fetchImpl(`${this.cfg.trackerUrl}/labels`, { headers: await this.vkHeaders() })
    if (labels.ok) {
      const lab = ((await labels.json()) as { id: number; title: string }[]).find((l) => l.title === 'запрос')
      if (lab) {
        await this.fetchImpl(`${this.cfg.trackerUrl}/tasks/${taskId}/labels`, {
          method: 'PUT', headers: await this.vkHeaders(), body: JSON.stringify({ label_id: lab.id }),
        })
      }
    }
    for (const ref of input.files) await this.attach(taskId, ref)

    const st = await this.loadState(taskId)
    st.name = input.name; st.email = input.email
    st.fields.customer = `${input.name} ${input.email}`.trim() || undefined
    st.initial = { text: input.text, links: input.links, files: input.files }
    st.messages.push({ role: 'user', content: `Инициатива заказчика (может быть сырая):\n${input.text}\nСсылки: ${input.links.join(', ')}\nВложения: ${input.files.join(', ')}` })
    await this.saveState(taskId, st)
    return { taskId, url: `${this.cfg.trackerPublicUrl}/tasks/${taskId}` }
  }

  private async attach(taskId: number, ref: string): Promise<void> {
    try {
      const bytes = await readFile(join(this.cfg.dataDir, ref))
      const form = new FormData()
      form.append('files', new Blob([bytes]), ref.split('/').pop() ?? 'file')
      await this.fetchImpl(`${this.cfg.trackerUrl}/tasks/${taskId}/attachments`, {
        method: 'PUT', headers: { authorization: `Bearer ${this.vkToken}` }, body: form,
      })
      await rename(join(this.cfg.dataDir, ref), join(this.cfg.dataDir, String(taskId), ref.split('/').pop() ?? 'file')).catch(() => undefined)
    } catch { /* вложение не должно ронять заявку */ }
  }

  // ── микродиалог ─────────────────────────────────────────────────────────
  async chat(taskId: number, message: string):
      Promise<{ reply: string; questions: string[]; scorecard: ReturnType<CustomerForm['scorecard']>; glossary: RequestState['glossary'] }> {
    const st = await this.loadState(taskId)
    st.messages.push({ role: 'user', content: message })
    let reply = ''
    let questions: string[] = []
    if (!this.cfg.zaiKey) {
      reply = 'Ключ модели не настроен: запрос сохранён, ассистент недоступен — PO заберёт контекст.'
    } else {
      const res = await this.fetchImpl('https://api.z.ai/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.zaiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.cfg.model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...st.messages.slice(-14)],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        }),
      })
      if (!res.ok) throw new Error(`модель: ${res.status}`)
      const out = JSON.parse(((await res.json()) as { choices: { message: { content: string } }[] }).choices[0].message.content) as {
        reply?: string; fields?: Record<string, unknown>
        glossary?: { term?: string; expansion?: string }[]; questions?: string[],
      }
      reply = out.reply ?? ''
      questions = out.questions ?? []
      this.mergeFields(st, out.fields, out.glossary ?? (out.fields?.glossary as { term?: string; expansion?: string }[] | undefined) ?? [])
    }
    st.messages.push({ role: 'assistant', content: reply })
    if (!st.email) {
      const word = message.split(/\s+/).find((w) => w.includes('@'))
      if (word) st.email = word.replace(/[<>,.]/g, '')
    }
    await this.saveState(taskId, st)
    return { reply, questions, scorecard: this.scorecard(st), glossary: st.glossary }
  }

  /** Summary-комментарий + файл полного контекста в задачу. */
  async finalize(taskId: number): Promise<{ url: string; board: string }> {
    const st = await this.loadState(taskId)
    const lines = ['**Summary (собрано ассистентом):**', '']
    for (const k of FIELDS) {
      if (k === 'glossary') continue
      lines.push(`- **${FIELD_TITLES[k]}:** ${st.fields[k] ?? '— не заполнено, спросит PO —'}`)
    }
    if (st.glossary.length) {
      lines.push(`- **Глоссарий:** ${st.glossary.map((g) => `${g.term} — ${g.expansion}`).join('; ')}`)
    }
    await this.fetchImpl(`${this.cfg.trackerUrl}/tasks/${taskId}/comments`, {
      method: 'PUT', headers: await this.vkHeaders(), body: JSON.stringify({ comment: lines.join('\n') }),
    })
    const full = [`# Полный контекст запроса #${taskId}`, '',
      `**Заказчик:** ${st.name} ${st.email}`, '', st.initial?.text ?? '', '',
      '## Диалог ассистента', '',
      ...st.messages.map((m) => `**${m.role === 'user' ? 'Заказчик' : 'Ассистент'}:** ${m.content}`)]
    const dir = join(this.cfg.dataDir, String(taskId))
    await mkdir(dir, { recursive: true })
    const file = join(dir, `context-${taskId}.md`)
    await writeFile(file, full.join('\n'), 'utf8')
    await this.attach(taskId, file)
    return { url: `${this.cfg.trackerPublicUrl}/tasks/${taskId}`, board: this.cfg.trackerPublicUrl }
  }
}
