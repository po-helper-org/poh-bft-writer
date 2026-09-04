/**
 * Фасад над воркспейсом: то, что канал отдаёт браузеру.
 *
 * Здесь и только здесь собирается вместе всё остальное — сканирование
 * артефактов, журнал работы, выбор документа. Сам по себе слой тонкий: вся
 * логика, которая может быть неверной, лежит в чистых модулях рядом и
 * проверяется без воркспейса.
 */
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { BftPluginConfig } from './config.js'
import { chooseDocument } from './document-source.js'
import {
  DocumentOutsideWorkspaceError, InvalidTaskIdError, TaskNotFoundError,
} from './errors.js'
import { buildHandoff, type Handoff } from './handoff.js'
import type { BftTask } from './model.js'
import { nodePorts, type BftPorts } from './ports.js'
import { scanWorkspace, type WorkspaceScan } from './reader.js'
import {
  finishWork, lastFinished, parseWorkLog, serializeWorkLog, startWork,
  WORKLOG_FILE, type WorkEntry, type WorkLog,
} from './worklog.js'

/** Слаг эпика — имя каталога. Всё, что похоже на путь, идентификатором не является. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isOutside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && (rel.startsWith('..') || isAbsolute(rel))
}

export class BftReader {
  constructor(
    private readonly config: BftPluginConfig,
    private readonly ports: BftPorts = nodePorts,
  ) {}

  private scan(): Promise<WorkspaceScan> {
    return scanWorkspace(this.config, this.ports)
  }

  async listTasks(): Promise<BftTask[]> {
    return (await this.scan()).tasks
  }

  async getTask(id: string): Promise<BftTask> {
    this.assertSlug(id)
    const task = (await this.scan()).tasks.find(item => item.id === id)
    if (!task) throw new TaskNotFoundError(id)
    return task
  }

  /**
   * Документ по пути из браузера.
   *
   * Путь приходит с клиента, поэтому проверяется дважды: как записан и после
   * раскрытия симлинков. Без второй проверки ссылка внутри каталога документов
   * увела бы чтение куда угодно.
   */
  async readDocument(relativePath: string): Promise<string | null> {
    const docsRoot = resolve(this.config.workspaceRoot, this.config.docsPath)
    const target = resolve(this.config.workspaceRoot, relativePath)
    if (isAbsolute(relativePath) || isOutside(docsRoot, target)) {
      throw new DocumentOutsideWorkspaceError(relativePath)
    }
    if (isOutside(docsRoot, await this.ports.realPath(target))) {
      throw new DocumentOutsideWorkspaceError(relativePath)
    }
    return this.ports.readTextFile(target)
  }

  /**
   * Документ по идентификатору требования — по конвенции каталогов.
   *
   * Клиент передаёт только идентификатор и ничего не знает ни про пути, ни про
   * формат ссылок: переименование каталога или смена формата ссылок в навыках
   * не требует правок ни в клиенте, ни в протоколе канала.
   */
  async findDocument(id: string): Promise<{ path: string; content: string } | null> {
    this.assertSlug(id)
    const { docsPath } = await this.scan()
    const dir = join(this.config.workspaceRoot, docsPath, id)
    const choice = chooseDocument(id, await this.ports.listDirectory(dir))
    if (!choice) return null
    const path = `${docsPath}/${id}/${choice.name}`
    const content = await this.readDocument(path)
    return content && content.trim() !== '' ? { path, content } : null
  }

  /** Черновик для чата: продолжение с последнего закрытого отрезка. */
  async handoff(id: string): Promise<Handoff> {
    const scan = await this.scan()
    const task = scan.tasks.find(item => item.id === id)
    if (!task) throw new TaskNotFoundError(id)
    return buildHandoff(task, lastFinished(scan.workLog, id), this.config)
  }

  async readWorkLog(): Promise<WorkLog> {
    return parseWorkLog(await this.ports.readTextFile(this.workLogPath()))
  }

  /** Начать отрезок работы. Незакрытый по этому требованию уже есть — журнал не меняется. */
  async startWork(entry: WorkEntry): Promise<WorkLog> {
    return this.saveLog(startWork(await this.readWorkLog(), entry))
  }

  async finishWork(id: string, summary: string, contextRef?: string): Promise<WorkLog> {
    this.assertSlug(id)
    const log = finishWork(await this.readWorkLog(), id, new Date().toISOString(), summary, contextRef)
    return this.saveLog(log)
  }

  private async saveLog(log: WorkLog): Promise<WorkLog> {
    await this.ports.writeTextFile(this.workLogPath(), serializeWorkLog(log))
    return log
  }

  private workLogPath(): string {
    return join(this.config.workspaceRoot, this.config.indexPath, WORKLOG_FILE)
  }

  private assertSlug(id: string): void {
    if (!SLUG_RE.test(id)) throw new InvalidTaskIdError(id)
  }
}
