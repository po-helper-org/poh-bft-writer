/**
 * Сборка очереди требований из воркспейса.
 *
 * Единственный слой, который знает про диск, — и то через порты. Всё, что
 * решает «какая стадия», «какой файл показать», «с какой задачей связан
 * каталог», лежит в чистых модулях рядом и проверяется без воркспейса.
 *
 * Строка очереди — одна на требование, даже когда требование живёт в двух
 * местах: задачей на доске Backlog.md и каталогом эпика в `docsPath`. Связку
 * даёт `epic-link.ts`; стадия слитой строки — старшая из двух (доска знает про
 * процесс больше, чем видно по файлам, а файлы не врут про то, что собрано),
 * `stageSource` говорит, чья взяла.
 */
import { join } from 'node:path'
import { parseTaskList, parseTaskListJson, type BacklogTask } from './backlog-source.js'
import { branchUrl, type BftPluginConfig } from './config.js'
import { linkTaskToEpic, parseH1, type EpicCandidate } from './epic-link.js'
import { parseFrontmatter, type Frontmatter } from './frontmatter.js'
import { stageRank, type BftArtifacts, type BftLinks, type BftTask, type StageVerdict } from './model.js'
import type { BftPorts } from './ports.js'
import { artifactsOf, stageFromArtifacts } from './stage.js'
import { lastFinished, parseWorkLog, WORKLOG_FILE, type WorkLog } from './worklog.js'

const JIRA_BROWSE = 'https://jira.mts.ru/browse/'
const WIKI_PAGE = 'https://confluence.mts.ru/pages/viewpage.action?pageId='

export interface WorkspaceScan {
  /** Каталог документов, который в итоге нашёлся (относительно корня воркспейса). */
  docsPath: string
  tasks: BftTask[]
  /** Журнал работы. Пустой — истории ещё нет либо файл не читается. */
  workLog: WorkLog
  /** Доска ответила. Нет — бинаря нет, доска выключена или CLI упал; очередь только из файлов. */
  boardAvailable: boolean
}

/** Каталог эпика, как его видит скан: всё, что нужно и связке, и строке очереди. */
interface EpicRecord {
  slug: string
  entries: string[]
  artifacts: BftArtifacts
  verdict: StageVerdict
  frontmatter: Frontmatter
  h1: { key: string; title: string } | null
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

async function scanEpics(root: string, ports: BftPorts): Promise<EpicRecord[]> {
  const epics: EpicRecord[] = []
  for (const slug of (await ports.listDirectory(root)).sort()) {
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

    epics.push({
      slug,
      entries,
      artifacts,
      verdict: stageFromArtifacts(slug, { entries, deepDocument }),
      frontmatter: parseFrontmatter(text),
      h1: parseH1(text),
    })
  }
  return epics
}

/**
 * Задачи доски. `null` — доски нет: не задан бинарь, его нет в PATH или CLI
 * упал. Это штатно, раздел работает по файлам.
 *
 * Сначала `--json` (одним вызовом — статус и ссылки), для CLI без него —
 * `--plain`, где ссылок нет и связка идёт только по слагу и H1.
 */
async function readBoard(config: BftPluginConfig, ports: BftPorts): Promise<BacklogTask[] | null> {
  if (!config.backlogBin) return null

  const json = await ports.runCommand(
    config.backlogBin, ['task', 'list', '--type', config.taskType, '--json'], config.workspaceRoot,
  )
  if (json.code === 0) {
    const tasks = parseTaskListJson(json.stdout, config.taskType)
    if (tasks.length || json.stdout.trim().startsWith('{')) return tasks
  }

  const plain = await ports.runCommand(config.backlogBin, ['task', 'list', '--plain'], config.workspaceRoot)
  if (plain.code !== 0) return null
  return parseTaskList(plain.stdout, config.taskType)
}

export async function scanWorkspace(config: BftPluginConfig, ports: BftPorts): Promise<WorkspaceScan> {
  const docsPath = await resolveDocsPath(config, ports)
  const workLog = parseWorkLog(
    await ports.readTextFile(join(config.workspaceRoot, config.indexPath, WORKLOG_FILE)),
  )
  const epics = await scanEpics(join(config.workspaceRoot, docsPath), ports)
  const board = await readBoard(config, ports)

  // Связка: каждой задаче доски — не больше одного каталога, каждому каталогу —
  // не больше одной задачи. Второй претендент на тот же каталог остаётся
  // отдельной строкой: угадывать, чей документ, значило бы показать неправду.
  const candidates: EpicCandidate[] = epics.map(epic => ({
    slug: epic.slug, h1Key: epic.h1?.key, h1Title: epic.h1?.title,
  }))
  const taskBySlug = new Map<string, BacklogTask>()
  const unlinked: BacklogTask[] = []
  for (const task of board ?? []) {
    const link = linkTaskToEpic(task, candidates, docsPath)
    if (link && !taskBySlug.has(link.slug)) taskBySlug.set(link.slug, task)
    else unlinked.push(task)
  }

  const entire = (id: string): string | undefined => (config.entire
    ? branchUrl(config.entire, lastFinished(workLog, id)?.contextRef)
    : undefined)

  const tasks: BftTask[] = []
  for (const epic of epics) {
    const task = taskBySlug.get(epic.slug)
    const id = task?.id ?? epic.slug
    const links = linksOf(epic.frontmatter, docsPath, epic.slug, epic.entries)
    const row: BftTask = {
      id,
      slug: epic.slug,
      title: epic.h1?.title || task?.title || epic.slug,
      stage: epic.verdict.stage,
      stageSource: 'artifacts',
      artifactStage: epic.verdict.stage,
      description: epic.frontmatter.status ?? '',
      howToDemo: [],
      // Ветка последнего закрытого отрезка: по ней продолжают, а не начинают.
      links: { ...links, entire: entire(id) },
      artifacts: epic.artifacts,
      missing: epic.verdict.missing,
    }
    if (task) {
      row.board = { stage: task.stage, refs: task.refs }
      // Отмена терминальна и старше любого файла; иначе — кто дальше по процессу.
      if (task.stage === 'Cancelled' || stageRank(task.stage) > stageRank(epic.verdict.stage)) {
        row.stage = task.stage
        row.stageSource = 'backlog'
      }
    }
    tasks.push(row)
  }

  for (const task of unlinked) {
    tasks.push({
      id: task.id,
      title: task.title,
      stage: task.stage,
      stageSource: 'backlog',
      board: { stage: task.stage, refs: task.refs },
      description: '',
      howToDemo: [],
      links: { other: [], entire: entire(task.id) },
      artifacts: { fast: false, fastHtml: false, deep: false, deepHtml: false, custdev: false, custdevHtml: false },
      // Документа ещё нет — до FAST-DONE не хватает именно его.
      missing: ['документ БФТ'],
    })
  }

  return { docsPath, tasks, workLog, boardAvailable: board !== null }
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

  // Страница встречи идёт отдельной ссылкой, а не подменяет собой страницу ревью:
  // это скрипт интервью, а не документ требования.
  const custdev = entries.find(entry => entry.toLowerCase() === `${slug}-custdev.html`.toLowerCase())
  if (custdev) links.custdev = `${docsPath}/${slug}/${custdev}`

  return links
}
