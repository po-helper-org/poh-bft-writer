/**
 * Связка задачи доски Backlog.md с каталогом эпика.
 *
 * Задача (`PO-11`) и документ (`bft/documentation/<slug>/`) живут в разных
 * мирах и общего ключа не имеют. Признаки связи — по убыванию надёжности,
 * первый сработавший даёт ответ:
 *
 * 1. ссылка задачи ведёт внутрь каталога документов — первый сегмент после
 *    него и есть слаг. Это durable-связь: её плагин записывает сам, как только
 *    свяжет задачу впервые (`backlog-writer.ts`), и дальше работает только она;
 * 2. слаг равен идентификатору задачи без учёта регистра — конвенция плагина:
 *    черновик «Создать документ» передаёт навыку `epic_slug` = id строчными;
 * 3. H1 документа `# [БФТ] <slug>: <Название>`: либо `<slug>` в нём равен
 *    идентификатору задачи, либо название совпадает с названием задачи после
 *    снятия префикса «БФТ:» — черновик диктует название дословно.
 *
 * Эвристик по времени создания файлов и журналу работы нет намеренно: две
 * задачи, начатые подряд, они бы перепутали, а перепутанная ссылка хуже
 * отсутствующей. Не связалось — две строки в очереди, и PO добавляет ссылку
 * рукой; после этого работает признак 1.
 *
 * Все функции чистые.
 */

/** Кандидат в эпики: то, что о каталоге знает скан воркспейса. */
export interface EpicCandidate {
  slug: string
  /** `<slug>` из H1 документа, если документ есть. */
  h1Key?: string
  /** Название из H1 документа, если документ есть. */
  h1Title?: string
}

export type LinkVia = 'ref' | 'slug' | 'h1'

export interface EpicLink {
  slug: string
  via: LinkVia
}

/** `# [БФТ] <slug>: <Название>` — единственный заголовок, по которому связка узнаёт эпик. */
const H1_RE = /^#\s*\[БФТ\]\s*([^\s:]+)\s*:\s*(.+)$/m

export function parseH1(text: string): { key: string; title: string } | null {
  const match = H1_RE.exec(text)
  if (!match) return null
  return { key: match[1].trim(), title: match[2].trim() }
}

/**
 * Приводит ссылку к пути относительно корня воркспейса и проверяет, что она
 * ведёт внутрь каталога документов. `null` — ссылка ведёт куда-то ещё (URL,
 * заметка, файл вне `docsPath`), зацепиться не за что.
 *
 * Терпимость намеренная и ограниченная: снимаются только расхождения, которые
 * реально порождает пайплайн — префикс репозитория, `./`, `.bft` против `bft`, —
 * и ни одно из них не расширяет доступ за пределы `docsPath`: итоговый путь всё
 * равно начинается с него, а выход наружу отдельно проверяет reader.
 */
export function normalizeDocsRef(ref: string, docsPath: string): string | null {
  let value = ref.trim().replace(/\\/g, '/')
  if (value === '') return null

  // URL — не путь в воркспейсе. Отсекаем до нормализации, чтобы `https://host/bft/...`
  // не притворился локальным путём после снятия префиксов.
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || value.startsWith('okr:')) return null

  value = value.replace(/^\.\//, '')

  const docs = docsPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
  // Каталог документов переименовывали (`.bft` → `bft`), и в задачах остались ссылки
  // обеих форм. Сопоставляем по обоим вариантам, а возвращаем всегда актуальный `docs`.
  const docsAlt = docs.startsWith('.') ? docs.slice(1) : `.${docs}`

  for (const prefix of [docs, docsAlt]) {
    const at = indexOfSegment(value, prefix)
    if (at === -1) continue
    const tail = value.slice(at + prefix.length).replace(/^\/+/, '')
    if (tail === '') return null
    return `${docs}/${tail}`
  }
  return null
}

/** Ищет `needle` как целую последовательность сегментов пути, а не как подстроку. */
function indexOfSegment(value: string, needle: string): number {
  if (needle === '') return -1
  let from = 0
  for (;;) {
    const at = value.indexOf(needle, from)
    if (at === -1) return -1
    const before = at === 0 ? '/' : value[at - 1]
    const afterAt = at + needle.length
    const after = afterAt >= value.length ? '/' : value[afterAt]
    if (before === '/' && after === '/') return at
    from = at + 1
  }
}

/**
 * Слаг эпика из ссылок задачи: первый сегмент после `docsPath`. Годится ссылка
 * на что угодно внутри папки эпика — страницу, `.md`, `personas.csv`.
 */
export function epicSlugFromRefs(refs: readonly string[], docsPath: string): string | null {
  for (const ref of refs) {
    const normalized = normalizeDocsRef(ref, docsPath)
    if (normalized === null) continue
    const docs = docsPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
    const slug = normalized.slice(docs.length + 1).split('/')[0]
    if (slug) return slug
  }
  return null
}

/**
 * Название для сравнения: регистр, лишние пробелы, кавычки и префикс «БФТ:»
 * значения не имеют — они различаются от руки к руке, а не от эпика к эпику.
 */
export function normalizeTitle(title: string): string {
  return title
    .replace(/^БФТ\s*(?:\([^)]*\))?\s*:\s*/i, '')
    .replace(/[«»"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function linkTaskToEpic(
  task: { id: string; title: string; refs: readonly string[] },
  epics: readonly EpicCandidate[],
  docsPath: string,
): EpicLink | null {
  const bySlug = new Map(epics.map(epic => [epic.slug.toLowerCase(), epic]))

  const fromRefs = epicSlugFromRefs(task.refs, docsPath)
  if (fromRefs !== null) {
    const epic = bySlug.get(fromRefs.toLowerCase())
    if (epic) return { slug: epic.slug, via: 'ref' }
  }

  const byId = bySlug.get(task.id.toLowerCase())
  if (byId) return { slug: byId.slug, via: 'slug' }

  const id = task.id.toLowerCase()
  const title = normalizeTitle(task.title)
  for (const epic of epics) {
    if (epic.h1Key?.toLowerCase() === id) return { slug: epic.slug, via: 'h1' }
    if (title !== '' && epic.h1Title !== undefined && normalizeTitle(epic.h1Title) === title) {
      return { slug: epic.slug, via: 'h1' }
    }
  }
  return null
}
