/**
 * Коннектор ссылок Google (ADR-0017): Docs, Slides, Sheets, файл и папка Drive,
 * открытые «всем, у кого есть ссылка», → Markdown материала заявки.
 *
 * Без ключей — открытый экспорт Google:
 *   Docs   → /export?format=md  (картинки внутри — data URI: вырезаем, читаем OCR);
 *   Slides → /export/pptx       (MarkItDown: текст слайдов, заметки, подписи картинок);
 *   Sheets → /export?format=xlsx;
 *   файл   → drive.usercontent.google.com/download (имя — из content-disposition);
 *   папка  → embeddedfolderview (HTML-список) или Drive API v3, если владелец
 *            задал GOOGLE_DRIVE_API_KEY (тогда и больше файлов, и без HTML-разбора).
 *
 * Байты разбирает context-ingest (MarkItDown, Tesseract) — тот же путь, что у
 * вложений. Загружает портал: у context-ingest сети наружу нет и не нужно.
 * Ходим только на хосты Google из списка ниже, редиректы — вручную и тоже по
 * списку: закрытый файл уводит на вход accounts.google.com — это «закрыт»,
 * а не страница входа в материалах.
 */

export interface GoogleIngestReply {
  kind: 'audio' | 'document'
  markdown: string
  ocr?: boolean
  pages?: number
  durationSec?: number
}

export type IngestFn = (name: string, bytes: Uint8Array | string) => Promise<GoogleIngestReply>
export type FetchFn = (url: string, init: { redirect: 'manual'; signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>

export interface GoogleRead {
  label: string
  markdown: string
}

export type GoogleTarget =
  | { kind: 'doc' | 'slides' | 'sheet' | 'file' | 'folder'; id: string }

const ID = '[A-Za-z0-9_-]{10,}'
const PATTERNS: [RegExp, GoogleTarget['kind']][] = [
  [new RegExp(`^https://docs\\.google\\.com/document/(?:u/\\d+/)?d/(${ID})`), 'doc'],
  [new RegExp(`^https://docs\\.google\\.com/presentation/(?:u/\\d+/)?d/(${ID})`), 'slides'],
  [new RegExp(`^https://docs\\.google\\.com/spreadsheets/(?:u/\\d+/)?d/(${ID})`), 'sheet'],
  [new RegExp(`^https://drive\\.google\\.com/(?:drive/(?:u/\\d+/)?)?folders/(${ID})`), 'folder'],
  [new RegExp(`^https://drive\\.google\\.com/file/(?:u/\\d+/)?d/(${ID})`), 'file'],
  [new RegExp(`^https://drive\\.google\\.com/(?:open|uc)\\?(?:.*&)?id=(${ID})`), 'file'],
]

/** Ссылка Google, которую умеет читать коннектор; иначе undefined (обычная страница). */
export function googleTarget(url: string): GoogleTarget | undefined {
  for (const [re, kind] of PATTERNS) {
    const m = re.exec(url)
    if (m) return { kind, id: m[1] }
  }
  return undefined
}

/** Хосты, куда коннектор ходит и куда идёт за редиректом. */
export function allowedHost(host: string): boolean {
  return ['docs.google.com', 'drive.google.com', 'drive.usercontent.google.com', 'www.googleapis.com'].includes(host)
    || host.endsWith('.googleusercontent.com')
}

export class GoogleClosedError extends Error {}

const MAX_BYTES = Number(process.env.GOOGLE_MAX_BYTES) > 0 ? Number(process.env.GOOGLE_MAX_BYTES) : 50 * 2 ** 20
const FOLDER_FILES = Number(process.env.GOOGLE_FOLDER_FILES) > 0 ? Number(process.env.GOOGLE_FOLDER_FILES) : 30
const FOLDER_DEPTH = 2
const DOC_IMAGES = 10
const PARALLEL = 4
/** Бюджет текста папки: делим между файлами, чтобы середину не вырезали целиком. */
const FOLDER_BUDGET = 16_000
const TIMEOUT_MS = 120_000

/** Форматы, которые context-ingest разбирает (MarkItDown, OCR, речь). */
const SUPPORTED = /\.(pdf|docx?|pptx?|xlsx?|csv|txt|md|html?|json|rtf|odt|png|jpe?g|tiff?|bmp|webp|gif|heic|heif|m4a|mp3|wav|ogg|oga|opus|aac|flac|webm|mp4|mov|amr|caf|3gp|wma)$/i
const IMAGE = /\.(png|jpe?g|tiff?|bmp|webp|gif|heic|heif)$/i

interface Entry { kind: GoogleTarget['kind']; id: string; name: string }

const NATIVE_MIME: Record<string, GoogleTarget['kind']> = {
  'application/vnd.google-apps.document': 'doc',
  'application/vnd.google-apps.presentation': 'slides',
  'application/vnd.google-apps.spreadsheet': 'sheet',
  'application/vnd.google-apps.folder': 'folder',
}

const decodeHtml = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Список папки из embeddedfolderview: ссылка записи + её подпись. */
export function parseFolderView(html: string): { title?: string; entries: Entry[] } {
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1]
  const entries: Entry[] = []
  const re = /<a href="([^"]+)"[^>]*>[\s\S]*?class="flip-entry-title">([^<]*)</g
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const target = googleTarget(decodeHtml(m[1]))
    if (target) entries.push({ ...target, name: decodeHtml(m[2]).trim() || target.id })
  }
  return { title: title ? decodeHtml(title).trim() : undefined, entries }
}

/** Картинки Google Docs в Markdown-экспорте: ссылки-определения с data URI. */
export function splitDocImages(markdown: string): { text: string; images: { ref: string; ext: string; bytes: Uint8Array }[] } {
  const images: { ref: string; ext: string; bytes: Uint8Array }[] = []
  const text = markdown.replace(/^\[([^\]]+)\]:\s*<data:image\/([a-z+]+);base64,([^>]*)>\s*$/gm, (_, ref: string, type: string, data: string) => {
    images.push({ ref, ext: type === 'jpeg' ? 'jpg' : type.replace('+xml', ''), bytes: Buffer.from(data, 'base64') })
    return ''
  })
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), images }
}

const short = (text: string, budget: number) => text.length <= budget ? text : `${text.slice(0, budget)}\n[… обрезано, ${text.length - budget} симв. …]`

async function pool<T, R>(items: T[], limit: number, job: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => { for (let i = next++; i < items.length; i = next++) out[i] = await job(items[i]) }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export class GoogleConnector {
  constructor(
    private readonly ingest: IngestFn,
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly apiKey: string | undefined = process.env.GOOGLE_DRIVE_API_KEY?.trim() || undefined,
  ) {}

  /** GET по списку хостов Google; редиректы — только туда же. */
  async get(url: string): Promise<{ bytes: Uint8Array; type: string; disposition: string; url: string }> {
    let current = url
    for (let hop = 0; hop < 6; hop++) {
      const host = new URL(current).hostname
      if (!allowedHost(host)) {
        if (/^accounts\.google\.com$|\.google\.com$/.test(host)) throw new GoogleClosedError('нужен вход в Google')
        throw new Error(`редирект на чужой хост ${host}`)
      }
      const res = await this.fetchFn(current, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        if (!location) throw new Error(`редирект ${res.status} без адреса`)
        current = new URL(location, current).toString()
        continue
      }
      if (res.status === 401 || res.status === 403) throw new GoogleClosedError(`Google ответил ${res.status}`)
      if (res.status === 404) throw new GoogleClosedError('Google ответил 404 — файла нет или он закрыт')
      if (!res.ok) throw new Error(`Google ответил ${res.status}`)
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > MAX_BYTES) throw new Error(`файл больше ${MAX_BYTES / 2 ** 20} МБ`)
      const bytes = new Uint8Array(await res.arrayBuffer())
      if (bytes.length > MAX_BYTES) throw new Error(`файл больше ${MAX_BYTES / 2 ** 20} МБ`)
      return { bytes, type: res.headers.get('content-type') ?? '', disposition: res.headers.get('content-disposition') ?? '', url: current }
    }
    throw new Error('слишком много редиректов')
  }

  private async text(url: string): Promise<string> {
    const got = await this.get(url)
    if (/text\/html/.test(got.type) && /accounts\.google\.com\/(?:ServiceLogin|v3\/signin)/.test(new TextDecoder().decode(got.bytes.slice(0, 20_000)))) {
      throw new GoogleClosedError('нужен вход в Google')
    }
    return new TextDecoder().decode(got.bytes)
  }

  /** Ссылка заказчика → материал. Ошибка «закрыт» — с подсказкой, как открыть. */
  async read(url: string): Promise<GoogleRead> {
    const target = googleTarget(url)
    if (!target) throw new Error('не ссылка Google Docs/Slides/Sheets/Drive')
    try {
      return await this.readTarget({ ...target, name: '' }, 0)
    } catch (e) {
      if (e instanceof GoogleClosedError) {
        throw new Error(`${e.message}: файл закрыт — попросите заказчика открыть доступ «Все, у кого есть ссылка» (читатель) или приложить файл`)
      }
      throw e
    }
  }

  private async readTarget(entry: Entry, depth: number): Promise<GoogleRead> {
    switch (entry.kind) {
      case 'doc': return this.doc(entry.id)
      case 'slides': return this.slides(entry.id)
      case 'sheet': return this.sheet(entry.id)
      case 'file': return this.file(entry.id, entry.name)
      case 'folder': return this.folder(entry.id, depth)
    }
  }

  private async doc(id: string): Promise<GoogleRead> {
    const { text, images } = splitDocImages(await this.text(`https://docs.google.com/document/d/${id}/export?format=md`))
    const shown = images.slice(0, DOC_IMAGES)
    const ocr = await pool(shown, PARALLEL, async (image) => {
      try {
        const reply = await this.ingest(`${image.ref}.${image.ext}`, image.bytes)
        return reply.markdown.trim()
      } catch (e) {
        return `(не распознана: ${(e as Error).message})`
      }
    })
    const parts = [text]
    if (shown.length) {
      parts.push('## Картинки документа (текст распознан OCR; возможны ошибки)',
        ...shown.map((image, i) => `### ${image.ref}\n\n${short(ocr[i] || '(текста нет)', 3_000)}`))
      if (images.length > shown.length) parts.push(`[… ещё ${images.length - shown.length} картинок не распознавались …]`)
    }
    return {
      label: `Google Docs — документ${images.length ? `, ${images.length} картинок (OCR)` : ''}`,
      markdown: parts.join('\n\n'),
    }
  }

  private async slides(id: string): Promise<GoogleRead> {
    const got = await this.get(`https://docs.google.com/presentation/d/${id}/export/pptx`)
    let markdown: string
    try {
      markdown = (await this.ingest('slides.pptx', got.bytes)).markdown
    } catch {
      markdown = await this.text(`https://docs.google.com/presentation/d/${id}/export/txt`)
    }
    const slides = (markdown.match(/<!-- Slide number: \d+ -->/g) ?? []).length
    return { label: `Google Slides — презентация${slides ? `, ${slides} слайдов` : ''} (текст слайдов и заметки)`, markdown }
  }

  private async sheet(id: string): Promise<GoogleRead> {
    const got = await this.get(`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`)
    return { label: 'Google Sheets — таблица', markdown: (await this.ingest('sheet.xlsx', got.bytes)).markdown }
  }

  private async file(id: string, known: string): Promise<GoogleRead> {
    const got = await this.get(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`)
    const name = fileName(got.disposition) || known || id
    if (/text\/html/.test(got.type) && !/\.html?$/i.test(name)) throw new GoogleClosedError('вместо файла Google отдал страницу')
    if (!SUPPORTED.test(name)) return { label: `файл Drive «${name}» — формат не разбирается`, markdown: `(файл «${name}» не разобран: формат не поддерживается; попросите приложить PDF или Word)` }
    const reply = await this.ingest(name, got.bytes)
    const label = reply.kind === 'audio' ? 'запись — расшифровка' : reply.ocr || IMAGE.test(name) ? 'картинка — текст распознан OCR' : 'документ'
    return { label: `файл Drive «${name}» — ${label}`, markdown: reply.markdown }
  }

  /** Записи папки: Drive API с ключом владельца, иначе открытый HTML-список. */
  async list(id: string): Promise<{ title?: string; entries: Entry[] }> {
    if (this.apiKey) {
      const q = encodeURIComponent(`'${id}' in parents and trashed = false`)
      const entries: Entry[] = []
      let page = ''
      do {
        const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType)&pageSize=100&orderBy=name&key=${encodeURIComponent(this.apiKey)}${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`
        const body = JSON.parse(await this.text(url)) as { files?: { id: string; name: string; mimeType: string }[]; nextPageToken?: string }
        for (const f of body.files ?? []) entries.push({ kind: NATIVE_MIME[f.mimeType] ?? 'file', id: f.id, name: f.name })
        page = body.nextPageToken ?? ''
      } while (page && entries.length < FOLDER_FILES * 2)
      return { entries }
    }
    return parseFolderView(await this.text(`https://drive.google.com/embeddedfolderview?id=${id}`))
  }

  private async folder(id: string, depth: number): Promise<GoogleRead> {
    const { title, entries } = await this.list(id)
    const files: (Entry & { path: string })[] = []
    const walk = async (items: Entry[], prefix: string, level: number) => {
      for (const item of items) {
        if (files.length >= FOLDER_FILES) return
        if (item.kind !== 'folder') { files.push({ ...item, path: `${prefix}${item.name}` }); continue }
        if (level + 1 >= FOLDER_DEPTH) continue
        const sub = await this.list(item.id).catch(() => ({ entries: [] as Entry[] }))
        await walk(sub.entries, `${prefix}${item.name}/`, level + 1)
      }
    }
    await walk(entries, '', depth)
    const budget = Math.max(600, Math.floor(FOLDER_BUDGET / Math.max(1, files.length)))
    const read = await pool(files, PARALLEL, async (f) => {
      try {
        return { ok: true, ...(await this.readTarget(f, FOLDER_DEPTH)) }
      } catch (e) {
        return { ok: false, label: 'не разобран', markdown: `(${(e as Error).message})` }
      }
    })
    const total = entries.length
    const head = [`Папка Google Drive${title ? ` «${title}»` : ''}: ${files.length} файлов${total > files.length && files.length >= FOLDER_FILES ? ` (первые ${FOLDER_FILES})` : ''}.`]
    const sections = files.map((f, i) => `## ${f.path} — ${read[i].label}\nСсылка: ${entryUrl(f)}\n\n${short(read[i].markdown.trim(), budget)}`)
    const ocr = read.filter((r) => r.ok && /OCR/.test(r.label)).length
    return {
      label: `папка Google Drive — ${files.length} файлов${ocr ? `, картинки (${ocr}) — текст распознан OCR, возможны ошибки` : ''}`,
      markdown: [...head, ...sections].join('\n\n'),
    }
  }
}

function entryUrl(entry: Entry): string {
  switch (entry.kind) {
    case 'doc': return `https://docs.google.com/document/d/${entry.id}`
    case 'slides': return `https://docs.google.com/presentation/d/${entry.id}`
    case 'sheet': return `https://docs.google.com/spreadsheets/d/${entry.id}`
    case 'folder': return `https://drive.google.com/drive/folders/${entry.id}`
    case 'file': return `https://drive.google.com/file/d/${entry.id}/view`
  }
}

/** Имя из content-disposition: filename*=UTF-8''… или filename="…". */
export function fileName(disposition: string): string {
  const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(disposition)
  if (star) {
    try { return decodeURIComponent(star[1].trim()) } catch { /* ниже — простое имя */ }
  }
  return /filename="?([^";]+)"?/.exec(disposition)?.[1]?.trim() ?? ''
}
