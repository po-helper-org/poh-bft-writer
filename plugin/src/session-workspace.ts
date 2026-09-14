/**
 * Рабочее пространство чатов по требованиям.
 *
 * Чат, открытый из раздела, живёт не в текущем рабочем пространстве харнесса,
 * а в каталоге рядом с документами (`bft/` при `bft/documentation`): агент
 * стартует там, где лежат `documentation/` и `index/`, а сессии по требованиям
 * собираются отдельной группой, не перемешиваясь с общими чатами.
 *
 * Навыки `/bft-*` читают `bft-config.md` из корня рабочего пространства чата —
 * значит, в каталоге чатов он обязан быть и обязан указывать на те же
 * документы, что и раздел. Здесь он собирается из конфига корня воркспейса
 * (если есть) с путями, пересчитанными относительно каталога чатов. Все
 * функции чистые: пути приходят и уходят строками, диск — на host-слое.
 */
import { posix } from 'node:path'

/** Секции `## ключ` → значение; формат — `bft-config.template.md` этого репозитория. */
export interface ConfigPaths {
  docs_path: string
  index_path: string
  /**
   * Skill-root воркспейса, если раздел его знает (`skillsPath` конфига). Не знает —
   * секция не пишется: навык сам ищет корень навыков в cwd и родительских каталогах
   * (`bft-writer/SKILL.md` §«Пути к ресурсам после установки»). Раскладку IDE-агента
   * плагин не угадывает — это связало бы режимы, см. test-dual-mode.sh.
   */
  skills_path?: string
}

const HEADING_RE = /^## +([A-Za-z_][A-Za-z0-9_]*)\s*$/

/**
 * Переписывает значения секций `## docs_path`, `## index_path`, `## skills_path`
 * в тексте `bft-config.md`; отсутствующие секции дописывает в конец. Остальные
 * секции (`wiki_space`, `team_name`, …) не трогает: они нужны навыкам как есть.
 */
export function rewriteConfigPaths(text: string, paths: ConfigPaths): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const values: Record<string, string> = { docs_path: paths.docs_path, index_path: paths.index_path }
  if (paths.skills_path !== undefined) values.skills_path = paths.skills_path
  const pending = new Set(Object.keys(values))

  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const heading = HEADING_RE.exec(lines[i])
    const key = heading?.[1]
    if (key === undefined || !(key in values)) {
      out.push(lines[i])
      i++
      continue
    }
    // Секция наша: заголовок, новое значение, затем пропускаем старое тело до следующего `## `.
    out.push(lines[i], values[key])
    pending.delete(key)
    i++
    while (i < lines.length && !HEADING_RE.test(lines[i])) i++
    out.push('')
  }

  let result = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  for (const key of ['docs_path', 'index_path', 'skills_path']) {
    if (!pending.has(key) || !(key in values)) continue
    result += `\n\n## ${key}\n${values[key]}`
  }
  return `${result}\n`
}

/** Каталог чатов: заданный явно или родитель каталога документов. */
export function sessionDirectory(sessionPath: string | undefined, docsPath: string): string {
  if (sessionPath !== undefined) return sessionPath
  const parent = posix.dirname(docsPath.replace(/\\/g, '/'))
  return parent === '.' ? '' : parent
}

/**
 * Пути для `bft-config.md` каталога чатов — относительно самого каталога:
 * так конфиг переживает перенос воркспейса целиком.
 */
export function relativeConfigPaths(
  sessionDir: string,
  docsPath: string,
  indexPath: string,
  skillsPath: string | undefined,
): ConfigPaths {
  const from = sessionDir === '' ? '.' : sessionDir
  const rel = (to: string): string => posix.relative(from, to.replace(/\\/g, '/')) || '.'
  return {
    docs_path: rel(docsPath),
    index_path: rel(indexPath),
    skills_path: skillsPath === undefined ? undefined : rel(skillsPath),
  }
}

/** Минимальный конфиг, когда в корне воркспейса своего нет. */
export const CONFIG_TEMPLATE = `# bft-config

Конфиг пайплайна БФТ для рабочего пространства чатов по требованиям. Собран
разделом «Управление требованиями»: пути ведут к документам воркспейса.
Остальные ключи — см. bft-config.template.md в репозитории poh-bft-writer.
`

