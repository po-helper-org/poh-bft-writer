/**
 * Сборка очереди требований из воркспейса.
 *
 * Единственный слой, который знает про диск, — и то через порты. Всё, что
 * решает «какая стадия», «какой файл показать», «что найдётся по запросу»,
 * лежит в чистых модулях рядом и проверяется без воркспейса.
 */
import { join } from 'node:path'
import { branchUrl, type BftPluginConfig } from './config.js'
import { parseFrontmatter, type Frontmatter } from './frontmatter.js'
import type { BftLinks, BftTask } from './model.js'
import type { BftPorts } from './ports.js'
import { parseTaskList } from './backlog-source.js'
import { artifactsOf, stageFromArtifacts } from './stage.js'
import { lastFinished, parseWorkLog, WORKLOG_FILE, type WorkLog } from './worklog.js'

const JIRA_BROWSE = 'https://jira.mts.ru/browse/'
const WIKI_PAGE = 'https://confluence.mts.ru/pages/viewpage.action?pageId='

/** H1 документа: `# [БФТ] {slug}: {Название}`. Название — то, что после двоеточия. */
const H1_RE = /^#\s*\[БФТ\]\s*[\w-]+:\s*(.+)$/m

export interface WorkspaceScan {
  /** Каталог документов, который в итоге нашёлся (относительно корня воркспейса). */
  docsPath: string
  tasks: BftTask[]
  /** Журнал работы. Пустой — истории ещё нет либо файл не читается. */
  workLog: WorkLog
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
  const workLog = parseWorkLog(
    await ports.readTextFile(join(config.workspaceRoot, config.indexPath, WORKLOG_FILE)),
  )
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

    const verdict = stageFromArtifacts(slug, { entries, deepDocument })
    tasks.push({
      id: slug,
      title: H1_RE.exec(text)?.[1]?.trim() || slug,
      stage: verdict.stage,
      stageSource: 'artifacts',
      description: frontmatter.status ?? '',
      howToDemo: [],
      links: {
        ...linksOf(frontmatter, docsPath, slug, entries),
        // Ветка последнего закрытого отрезка: по ней продолжают, а не начинают.
        entire: config.entire
          ? branchUrl(config.entire, lastFinished(workLog, slug)?.contextRef)
          : undefined,
      },
      artifacts,
      missing: verdict.missing,
    })
  }

  return { docsPath, tasks: await withBacklog(tasks, config, ports), workLog }
}

/**
 * Дополняет очередь задачами доски Backlog.md.
 *
 * Доска необязательна: не задан бинарь или его нет в PATH — возвращается то же,
 * что было. Когда доска есть, она добавляет требования, заведённые раньше, чем
 * появился первый документ: иначе «агент завёл требование» ничем не кончается
 * до первого прогона /bft-fast.
 *
 * Объединение — по идентификатору. Связать задачу доски с её документом иначе,
 * чем по совпадению идентификатора со слагом эпика, пока нечем: `task list
 * --plain` ссылок задачи не отдаёт. Стадия документа при совпадении не
 * затирается доской — она выведена из того, что реально лежит на диске.
 */
async function withBacklog(
  tasks: BftTask[],
  config: BftPluginConfig,
  ports: BftPorts,
): Promise<BftTask[]> {
  if (!config.backlogBin) return tasks

  const { stdout, code } = await ports.runCommand(
    config.backlogBin, ['task', 'list', '--plain'], config.workspaceRoot,
  )
  if (code !== 0) return tasks

  const known = new Set(tasks.map(task => task.id))
  for (const summary of parseTaskList(stdout, config.taskType)) {
    if (known.has(summary.id)) continue
    tasks.push({
      ...summary,
      description: '',
      howToDemo: [],
      links: { other: [] },
      artifacts: { fast: false, fastHtml: false, deep: false, deepHtml: false },
      // Документа ещё нет — до FAST-DONE не хватает именно его.
      missing: ['документ БФТ'],
    })
  }
  return tasks
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
