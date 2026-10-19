/**
 * Заметки PO к разделам документа БФТ — правки, которые копятся при чтении и уходят в чат
 * одним сообщением («Отправить правки»).
 *
 * Раздел — ближайший заголовок (h1–h3), стоящий в документе до места нажатия: страница ревью
 * и markdown-страница размечены заголовками, а обёртки вокруг них у разных навыков разные,
 * поэтому раздел ищется по порядку в документе, а не по вложенности.
 *
 * Документ показан в iframe с allow-same-origin (см. DetailPage), так что разметка и
 * жесты вешаются прямо на его DOM: долгое нажатие на раздел — заметка, заголовок раздела
 * с заметкой подсвечивается, прокрутка до конца открывает футер с действиями.
 *
 * Заметки живут в localStorage браузера по требованию: это черновик PO до отправки, а не
 * часть документа, и переживать смену устройства им не нужно.
 */

export interface SectionNote {
  /** Заголовок раздела, как он написан в документе. */
  section: string
  text: string
}

const STORAGE_PREFIX = 'poh-bft-plugin:notes:'

export function loadNotes(taskId: string): SectionNote[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + taskId)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((n): n is SectionNote =>
      typeof n === 'object' && n !== null
      && typeof (n as SectionNote).section === 'string'
      && typeof (n as SectionNote).text === 'string')
  } catch {
    return []
  }
}

export function saveNotes(taskId: string, notes: readonly SectionNote[]): void {
  try {
    if (notes.length === 0) window.localStorage.removeItem(STORAGE_PREFIX + taskId)
    else window.localStorage.setItem(STORAGE_PREFIX + taskId, JSON.stringify(notes))
  } catch {
    // Хранилище недоступно (приватный режим) — заметки живут до закрытия страницы.
  }
}

/** Правка PO для черновика узла (`handoff`, поле `note`): по разделам, в порядке записи. */
export function formatNotes(notes: readonly SectionNote[]): string {
  const lines = ['Правки PO по разделам документа:']
  notes.forEach((note, index) => {
    lines.push(`${index + 1}. Раздел «${note.section}»: ${note.text.trim()}`)
  })
  return lines.join('\n')
}

const HEADINGS = 'h1, h2, h3'
const LONG_PRESS_MS = 550
const MOVE_TOLERANCE = 10
const END_TOLERANCE = 32

function headingText(el: Element): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  return text.length > 90 ? `${text.slice(0, 89)}…` : text
}

/** Заголовок раздела, в котором лежит узел: последний h1–h3 до него (или он сам). */
function sectionHeading(doc: Document, target: Node): Element | null {
  let found: Element | null = null
  for (const heading of Array.from(doc.querySelectorAll(HEADINGS))) {
    if (heading === target || heading.contains(target)) return heading
    // Заголовок стоит раньше узла в документе.
    if (heading.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING) found = heading
    else break
  }
  return found
}

const DOC_STYLE = `
[data-bft-pressing] { background: rgba(247, 173, 49, 0.18) !important; transition: background-color .2s ease; }
[data-bft-note] { box-shadow: inset 3px 0 0 #f7ad31; background: rgba(247, 173, 49, 0.10); padding-left: 10px !important; border-radius: 4px; }
`
/** Только на телефоне: без этого долгое нажатие открывает выделение текста и меню iOS. */
const TOUCH_STYLE = `
body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
`

export interface SectionBindingOptions {
  /** Долгое нажатие на раздел. */
  onLongPress(section: string): void
  /** Документ прокручен до конца (или короче экрана) / ушёл от конца. */
  onAtEnd(atEnd: boolean): void
  /** Телефон: гасить выделение текста, чтобы долгое нажатие было жестом раздела. */
  touch: boolean
}

export interface SectionBinding {
  /** Подсветить заголовки разделов с заметками. */
  mark(sections: readonly string[]): void
  /** Прокрутить документ к концу — к футеру с действиями. */
  scrollToEnd(): void
  dispose(): void
}

/** Вешает жесты и разметку на документ во фрейме. `null` — документ недоступен (другой origin). */
export function bindSections(frame: HTMLIFrameElement, options: SectionBindingOptions): SectionBinding | null {
  const doc = frame.contentDocument
  const win = frame.contentWindow
  if (!doc || !win || !doc.body) return null

  const style = doc.createElement('style')
  style.setAttribute('data-bft', 'section-notes')
  style.textContent = DOC_STYLE + (options.touch ? TOUCH_STYLE : '')
  doc.head?.appendChild(style)

  let timer: number | undefined
  let start: { x: number; y: number } | null = null
  let pressed: Element | null = null

  const cancel = () => {
    if (timer !== undefined) win.clearTimeout(timer)
    timer = undefined
    start = null
    pressed?.removeAttribute('data-bft-pressing')
    pressed = null
  }

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    // Ссылки и поля документа (комментарии страницы ревью) живут своей жизнью.
    const target = event.target as Element | null
    if (!target || target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return
    const heading = sectionHeading(doc, target)
    if (!heading) return
    cancel()
    start = { x: event.clientX, y: event.clientY }
    pressed = heading
    heading.setAttribute('data-bft-pressing', '')
    timer = win.setTimeout(() => {
      const section = headingText(heading)
      cancel()
      try { navigator.vibrate?.(15) } catch { /* вибрации нет */ }
      options.onLongPress(section)
    }, LONG_PRESS_MS)
  }
  const onMove = (event: PointerEvent) => {
    if (!start) return
    if (Math.abs(event.clientX - start.x) > MOVE_TOLERANCE || Math.abs(event.clientY - start.y) > MOVE_TOLERANCE) cancel()
  }
  const onContextMenu = (event: Event) => {
    if (options.touch) event.preventDefault()
  }

  let atEnd: boolean | null = null
  const checkEnd = () => {
    const scroller = doc.scrollingElement ?? doc.documentElement
    const next = scroller.scrollTop + win.innerHeight >= scroller.scrollHeight - END_TOLERANCE
    if (next !== atEnd) {
      atEnd = next
      options.onAtEnd(next)
    }
  }

  doc.addEventListener('pointerdown', onDown, true)
  doc.addEventListener('pointermove', onMove, true)
  doc.addEventListener('pointerup', cancel, true)
  doc.addEventListener('pointercancel', cancel, true)
  doc.addEventListener('contextmenu', onContextMenu, true)
  win.addEventListener('scroll', checkEnd, { passive: true })
  win.addEventListener('resize', checkEnd)
  checkEnd()

  return {
    mark(sections) {
      const wanted = new Set(sections)
      for (const heading of Array.from(doc.querySelectorAll(HEADINGS))) {
        if (wanted.has(headingText(heading))) heading.setAttribute('data-bft-note', '')
        else heading.removeAttribute('data-bft-note')
      }
    },
    scrollToEnd() {
      const scroller = doc.scrollingElement ?? doc.documentElement
      win.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
    },
    dispose() {
      cancel()
      doc.removeEventListener('pointerdown', onDown, true)
      doc.removeEventListener('pointermove', onMove, true)
      doc.removeEventListener('pointerup', cancel, true)
      doc.removeEventListener('pointercancel', cancel, true)
      doc.removeEventListener('contextmenu', onContextMenu, true)
      win.removeEventListener('scroll', checkEnd)
      win.removeEventListener('resize', checkEnd)
      style.remove()
    },
  }
}
