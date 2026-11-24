/**
 * Полный БФТ → страница Confluence в формате хранения (storage, XHTML) — ADR-0028.
 *
 * Детерминированно, без модели и без сети: один и тот же документ и одни и те же
 * имена вложений дают байт в байт одно и то же тело страницы (тест детерминизма).
 * Поэтому в теле нет ни времени публикации, ни случайных id — версия и дата берутся
 * из frontmatter документа (`version`, `synced`).
 *
 * Корпоративный стандарт отгрузки (`commands/bft-deliver.md`, `bft_standards.md`):
 * - заголовок страницы — H1 документа `[БФТ] <slug>: <Название>`; в теле H1 нет;
 * - frontmatter и служебные блоки PO («Продолжить / уточнить БФТ», «⏳ Полный БФТ — в
 *   проработке», граница BFT-HEAD-END) не публикуются; «Общая информация» остаётся —
 *   это блок корпоративного шаблона;
 * - разделы и таблицы канона — как в документе: заголовки решётками → h2…h6,
 *   таблица markdown → таблица Confluence с шапкой;
 * - PlantUML (ЗМ-015) — картинкой-вложением `<ac:image>`; нет картинки — код в
 *   свёрнутом блоке с пометкой [УТОЧНИТЬ], голым блоком кода не публикуется;
 * - ссылка на задачу Jira (`…/browse/KEY-1`) — макросом Jira (ЗМ-009), остальные — ссылками;
 * - `<details><summary>` — макрос Expand.
 */

/** Служебные разделы для PO: с них и до конца документа на страницу не идёт ничего. */
const SERVICE_HEADS = [/^##\s+⏳\s*Полный БФТ/m, /^##\s+Продолжить \/ уточнить БФТ/m]

export interface StorageOptions {
  /** Имена вложений-картинок схем PlantUML по порядку блоков; нет имени — схема кодом. */
  diagrams?: readonly (string | undefined)[]
}

export interface StoragePage {
  /** Заголовок страницы (H1 документа без разметки), до 255 символов. */
  title: string
  /** Тело страницы, storage-формат. */
  body: string
  /** Исходники схем PlantUML по порядку — их рендерит активность «преобразование». */
  diagrams: string[]
  /** Метки страницы: `bft` и `bft-<slug>` — по второй повторная отправка узнаёт свою страницу. */
  labels: string[]
  /** Код БФТ (epic_slug), если есть во frontmatter. */
  slug?: string
}

/** Имя вложения N-й схемы (с 1): латиница — Confluence его не нормализует. */
export const diagramFileName = (n: number): string => `bft-diagram-${n}.png`

export function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

const cdata = (text: string) => `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`

function macro(name: string, params: Record<string, string>, inner?: { rich?: string; plain?: string }): string {
  const p = Object.entries(params).map(([k, v]) => `<ac:parameter ac:name="${k}">${escapeXml(v)}</ac:parameter>`).join('')
  const body = inner?.rich !== undefined ? `<ac:rich-text-body>${inner.rich}</ac:rich-text-body>`
    : inner?.plain !== undefined ? `<ac:plain-text-body>${cdata(inner.plain)}</ac:plain-text-body>` : ''
  return `<ac:structured-macro ac:name="${name}">${p}${body}</ac:structured-macro>`
}

/** Простой frontmatter `ключ: значение` (как пишет навык); кавычки снимаются. */
export function frontmatterOf(markdown: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(markdown)
  const out: Record<string, string> = {}
  if (!m) return out
  for (const line of m[1]!.split('\n')) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (kv) out[kv[1]!] = kv[2]!.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
  }
  return out
}

/** Текст страницы: без frontmatter, границы шапки, служебных блоков PO и H1. */
export function publishableMarkdown(markdown: string): { title: string; body: string } {
  let body = markdown.replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '')
  body = body.replace(/<!-- BFT-HEAD-END[^>]*-->\n?/g, '')
  for (const head of SERVICE_HEADS) {
    const m = head.exec(body)
    if (m) body = body.slice(0, m.index)
  }
  const h1 = /^#\s+(.+?)\s*#*\s*$/m.exec(body)
  let title = ''
  if (h1) {
    title = h1[1]!
    body = body.slice(0, h1.index) + body.slice(h1.index + h1[0].length)
  }
  return { title: plainText(title).slice(0, 255).trim(), body: `${body.trim()}\n` }
}

/** Инлайн-разметка → текст (для заголовка страницы). */
function plainText(text: string): string {
  return text
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Блоки ```plantuml по порядку — их же нумерует bftToStorage. */
export function plantumlSources(markdown: string): string[] {
  const { body } = publishableMarkdown(markdown)
  return [...body.matchAll(/^```plantuml[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)].map((m) => m[1]!)
}

// ── Инлайн ────────────────────────────────────────────────────────────────

const JIRA_KEY = /\/browse\/([A-Z][A-Z0-9_]+-\d+)\/?$/

function linkHtml(text: string, url: string): string {
  const jira = JIRA_KEY.exec(url.replace(/[?#].*$/, ''))
  if (jira) return macro('jira', { key: jira[1]! })
  if (!/^(https?:|mailto:)/i.test(url)) return inline(text)
  return `<a href="${escapeXml(url)}">${inline(text) || escapeXml(url)}</a>`
}

/** Инлайн markdown → XHTML: код, ссылки, жирный, курсив, зачёркнутый, <br>. */
export function inline(text: string): string {
  const keep: string[] = []
  const hold = (html: string) => `\u0000${keep.push(html) - 1}\u0000`
  let s = text.replace(/\u0000/g, '')
  s = s.replace(/`([^`\n]+)`/g, (_, code: string) => hold(`<code>${escapeXml(code)}</code>`))
  s = s.replace(/\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, t: string, url: string) => hold(linkHtml(t, url)))
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) => hold(linkHtml(url, url)))
  s = s.replace(/<br\s*\/?>/gi, () => hold('<br/>'))
  s = escapeXml(s)
  s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^\w])__(?=\S)(.+?)(?<=\S)__(?!\w)/g, '$1<strong>$2</strong>')
  s = s.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>')
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1<em>$2</em>')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => keep[Number(i)]!)
}

// ── Блоки ─────────────────────────────────────────────────────────────────

const TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/
const FENCE = /^```\s*([\w+-]*)[^\n]*$/
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

function splitRow(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!
    if (c === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  cells.push(cur.trim())
  return cells
}

interface Ctx { diagram: number; diagrams: readonly (string | undefined)[]; sources: string[] }

function table(lines: string[]): string {
  const head = splitRow(lines[0]!)
  const rows = lines.slice(2).map(splitRow)
  const width = Math.max(head.length, ...rows.map((r) => r.length))
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, width - r.length)).fill('')]
  const th = pad(head).map((c) => `<th>${inline(c)}</th>`).join('')
  const td = rows.map((r) => `<tr>${pad(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')
  return `<table><tbody><tr>${th}</tr>${td}</tbody></table>`
}

interface Item { indent: number; ordered: boolean; text: string[]; children: Item[] }

function list(lines: string[]): string {
  const roots: Item[] = []
  const stack: Item[] = []
  for (const line of lines) {
    const m = LIST_ITEM.exec(line)
    if (!m) {
      const last = stack[stack.length - 1]
      if (last) last.text.push(line.trim())
      continue
    }
    const item: Item = { indent: m[1]!.replace(/\t/g, '    ').length, ordered: /\d/.test(m[2]!), text: [m[3]!], children: [] }
    while (stack.length && stack[stack.length - 1]!.indent >= item.indent) stack.pop()
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(item)
    else roots.push(item)
    stack.push(item)
  }
  const render = (items: Item[]): string => {
    // Соседние пункты разного вида — отдельными списками (как в markdown).
    let out = ''
    let i = 0
    while (i < items.length) {
      const ordered = items[i]!.ordered
      let li = ''
      while (i < items.length && items[i]!.ordered === ordered) {
        const it = items[i]!
        li += `<li>${inline(it.text.join(' '))}${it.children.length ? render(it.children) : ''}</li>`
        i++
      }
      out += ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>`
    }
    return out
  }
  return render(roots)
}

function fence(lang: string, code: string, ctx: Ctx): string {
  if (lang.toLowerCase() === 'plantuml') {
    ctx.diagram += 1
    ctx.sources.push(code)
    const file = ctx.diagrams[ctx.diagram - 1]
    if (file) return `<p>${`<ac:image ac:align="center"><ri:attachment ri:filename="${escapeXml(file)}"/></ac:image>`}</p>`
    return `<p><strong>[УТОЧНИТЬ: схема не отрендерилась — исходник PlantUML ниже]</strong></p>${macro('expand', { title: `Схема ${ctx.diagram} (PlantUML)` }, { rich: macro('code', {}, { plain: code }) })}`
  }
  const known = /^(java|javascript|js|json|xml|html|sql|bash|sh|python|yaml|text|ts|typescript|css|go|kotlin)$/i.test(lang)
  const params: Record<string, string> = known && !/^text$/i.test(lang) ? { language: normalizeLang(lang) } : {}
  return macro('code', params, { plain: code })
}

const normalizeLang = (lang: string) => ({ js: 'javascript', ts: 'javascript', typescript: 'javascript', sh: 'bash', yaml: 'yml' }[lang.toLowerCase()] ?? lang.toLowerCase())

/** Блоки markdown → XHTML. */
function blocks(md: string, ctx: Ctx): string {
  const lines = md.split('\n')
  const out: string[] = []
  let para: string[] = []
  const flush = () => {
    if (!para.length) return
    const html = para.map((l, i) => inline(l.replace(/\s+$/, '')) + (i < para.length - 1 ? (/ {2,}$|\\$/.test(l) ? '<br/>' : ' ') : '')).join('')
    out.push(`<p>${html.replace(/\\<br\/>/g, '<br/>')}</p>`)
    para = []
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (!line.trim()) { flush(); i++; continue }
    // HTML-комментарии (служебные метки навыка) не публикуются.
    if (/^\s*<!--/.test(line)) {
      flush()
      while (i < lines.length && !lines[i]!.includes('-->')) i++
      i++
      continue
    }
    const f = FENCE.exec(line)
    if (f) {
      flush()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) code.push(lines[i++]!)
      i++
      out.push(fence(f[1] ?? '', code.join('\n'), ctx))
      continue
    }
    // <details><summary>…</summary> … </details> → Expand.
    if (/^\s*<details\b[^>]*>/.test(line)) {
      flush()
      let depth = 0
      const inner: string[] = []
      for (; i < lines.length; i++) {
        const l = lines[i]!
        depth += (l.match(/<details\b/g) ?? []).length - (l.match(/<\/details>/g) ?? []).length
        inner.push(l)
        if (depth <= 0) { i++; break }
      }
      let text = inner.join('\n').replace(/^\s*<details\b[^>]*>/, '').replace(/<\/details>\s*$/, '')
      const sum = /<summary>([\s\S]*?)<\/summary>/.exec(text)
      const title = sum ? plainText(sum[1]!.replace(/<[^>]+>/g, '')).replace(/^[▶►▸]\s*/, '') : 'Подробнее'
      if (sum) text = text.slice(0, sum.index) + text.slice(sum.index + sum[0].length)
      out.push(macro('expand', { title }, { rich: blocks(text.trim(), ctx) }))
      continue
    }
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (h) {
      flush()
      // H1 — заголовок страницы; внутри тела h1 не встречается, а случайный — уровнем ниже.
      const level = Math.max(2, h[1]!.length)
      out.push(`<h${level}>${inline(h[2]!)}</h${level}>`)
      i++
      continue
    }
    if (HR.test(line) && !para.length) { flush(); out.push('<hr/>'); i++; continue }
    if (line.trim().startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      flush()
      const rows: string[] = [line, lines[i + 1]!]
      i += 2
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(lines[i++]!)
      out.push(table(rows))
      continue
    }
    if (/^\s*>/.test(line)) {
      flush()
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${blocks(q.join('\n'), ctx)}</blockquote>`)
      continue
    }
    if (LIST_ITEM.test(line) && !para.length) {
      flush()
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i]!
        if (LIST_ITEM.test(l)) { items.push(l); i++; continue }
        // Продолжение пункта — строка с отступом; пустая строка или новый блок — конец списка.
        if (l.trim() && /^\s+/.test(l) && !FENCE.test(l.trim())) { items.push(l); i++; continue }
        break
      }
      out.push(list(items))
      continue
    }
    para.push(line)
    i++
  }
  flush()
  return out.join('\n')
}

/**
 * Полный БФТ (markdown навыка) → страница Confluence. Сверху — панель «откуда
 * страница» (версия и дата документа из frontmatter) и оглавление.
 */
export function bftToStorage(source: string, opts: StorageOptions = {}): StoragePage {
  const markdown = source.replace(/\r\n?/g, '\n')
  const fm = frontmatterOf(markdown)
  const { title, body } = publishableMarkdown(markdown)
  const ctx: Ctx = { diagram: 0, diagrams: opts.diagrams ?? [], sources: [] }
  const content = blocks(body, ctx)
  const meta = [fm.version ? `версия ${fm.version}` : '', fm.synced ? `от ${fm.synced}` : ''].filter(Boolean).join(' ')
  const note = `<p>Страница опубликована из портала БФТ${meta ? ` (документ ${escapeXml(meta)})` : ''}. Правки вносите в портале: повторная отправка обновит эту страницу и перезапишет ручные изменения.</p>`
  const slug = fm.epic_slug && /^[\w.-]{1,80}$/.test(fm.epic_slug) ? fm.epic_slug : undefined
  return {
    title: title || (slug ? `[БФТ] ${slug}` : 'БФТ'),
    body: `${macro('info', {}, { rich: note })}\n${macro('toc', { maxLevel: '3' })}\n${content}\n`,
    diagrams: ctx.sources,
    labels: ['bft', ...(slug ? [`bft-${slug.toLowerCase()}`] : [])],
    ...(slug ? { slug } : {}),
  }
}
