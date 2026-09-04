/**
 * Сборка очереди требований из воркспейса.
 *
 * Единственный слой, который знает про диск, — и то через порты. Всё, что
 * решает «какая стадия», «какой файл показать», «что найдётся по запросу»,
 * лежит в чистых модулях рядом и проверяется без воркспейса.
 */
import { join } from 'node:path'
import type { BftPluginConfig } from './config.js'
import { parseFrontmatter, type Frontmatter } from './frontmatter.js'
import type { BftLinks, BftTask } from './model.js'
import type { BftPorts } from './ports.js'
import { artifactsOf, stageFromArtifacts } from './stage.js'

const JIRA_BROWSE = 'https://jira.mts.ru/browse/'
const WIKI_PAGE = 'https://confluence.mts.ru/pages/viewpage.action?pageId='

/** H1 документа: `# [БФТ] {slug}: {Название}`. Название — то, что после двоеточия. */
const H1_RE = /^#\s*\[БФТ\]\s*[\w-]+:\s*(.+)$/m

export interface WorkspaceScan {
  /** Каталог документов, который в итоге нашёлся (относительно корня воркспейса). */
  docsPath: string
  tasks: BftTask[]
}

/**
 * Каталог документов: сначала заданный, потом запасные. Ни одного не нашлось —
 * возвращается заданный, чтобы сообщение об ошибке называло ожидаемый путь, а
 * не последний перепробованный.
 */
async function resolveDocsPath(config: BftPluginConfig, ports: BftPorts): Promise<string> {
  for (const candidate of [config.docsPath, ...config.docsPathFallbacks]) {
    const entries = await ports.listDirectory(join(config.workspaceRoot, candidate))
    if (entries.length) return candidate
  }
  return config.docsPath
}

export async function scanWorkspace(config: BftPluginConfig, ports: BftPorts): Promise<WorkspaceScan> {
  const docsPath = await resolveDocsPath(config, ports)
  const root = join(config.workspaceRoot, docsPath)
  const slugs = await ports.listDirectory(root)

  const tasks: BftTask[] = []
  for (const slug of slugs.sort()) {
    const entries = await ports.listDirectory(join(root, slug))
    // Каталог без единого файла эпиком не является: это может быть что угодно,
    // от artefacts/ до случайной папки, и заводить по нему требование — врать.
    if (!entries.length) continue

    const artifacts = artifactsOf(slug, entries)
    if (!artifacts.fast && !artifacts.deep) continue

    const deepDocument = artifacts.deep
      ? await ports.readTextFile(join(root, slug, `${slug}.md`))
      : null
    const fastDocument = !artifacts.deep && artifacts.fast
      ? await ports.readTextFile(join(root, slug, `${slug}-fast.md`))
      : null
    const text = deepDocument ?? fastDocument ?? ''
    const frontmatter = parseFrontmatter(text)

    tasks.push({
      id: slug,
      title: H1_RE.exec(text)?.[1]?.trim() || slug,
      stage: stageFromArtifacts(slug, { entries, deepDocument }),
      stageSource: 'artifacts',
      description: frontmatter.status ?? '',
      howToDemo: [],
      links: linksOf(frontmatter, docsPath, slug, entries),
      artifacts,
    })
  }

  return { docsPath, tasks }
}

function linksOf(
  frontmatter: Frontmatter,
  docsPath: string,
  slug: string,
  entries: readonly string[],
): BftLinks {
  const links: BftLinks = { other: [] }

  const jira = frontmatter.jira?.trim()
  // `[СОЗДАТЬ эпик]` и прочие пометки — не ключ: ссылка на них была бы битой (ЗМ-009).
  if (jira && !jira.startsWith('[')) links.epic = `${JIRA_BROWSE}${jira}`

  const pageId = frontmatter.pageId?.trim()
  if (pageId && pageId !== 'pending' && !pageId.startsWith('[')) {
    links.confluence = `${WIKI_PAGE}${pageId}`
  }

  const html = entries.find(entry => entry.toLowerCase() === `${slug}.html`.toLowerCase())
    ?? entries.find(entry => entry.toLowerCase() === `${slug}-fast.html`.toLowerCase())
  if (html) links.html = `${docsPath}/${slug}/${html}`

  return links
}
