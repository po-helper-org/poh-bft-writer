/**
 * Фасад над воркспейсом: то, что канал отдаёт браузеру.
 *
 * Здесь и только здесь собирается вместе всё остальное — сканирование
 * артефактов, журнал работы, выбор документа. Сам по себе слой тонкий: вся
 * логика, которая может быть неверной, лежит в чистых модулях рядом и
 * проверяется без воркспейса.
 */
import { isAbsolute, join, relative, resolve } from 'node:path'
import { applyBacklogEdits, planBacklogEdits, type BacklogEditResult } from './backlog-writer.js'
import type { BftPluginConfig } from './config.js'
import { chooseCustdevDocument, chooseDocument, type DocumentKind } from './document-source.js'
import {
  DocumentOutsideWorkspaceError, InvalidTaskIdError, TaskNotFoundError,
} from './errors.js'
import { buildCreateDraft, buildHandoff, parseTaskViewJson, type Handoff } from './handoff.js'
import type { BftTask } from './model.js'
import { nodePorts, type BftPorts } from './ports.js'
import { scanWorkspace, type WorkspaceScan } from './reader.js'
import {
  finishWork, lastFinished, parseWorkLog, serializeWorkLog, startWork,
  WORKLOG_FILE, type WorkEntry, type WorkLog,
} from './worklog.js'

/** Какой документ эпика открывают: сам БФТ или скрипт CustDev-интервью. */
export type DocumentRole = 'requirement' | 'custdev'

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

  /**
   * Очередь для панели. Заодно приводит доску в соответствие с артефактами
   * (`reconcile`): обновление списка — самый частый момент, когда PO смотрит на
   * стадии, и показывать доску, отставшую от файлов, здесь хуже, чем потратить
   * лишний вызов CLI.
   */
  async listTasks(): Promise<BftTask[]> {
    return (await this.reconcile()).scan.tasks
  }

  /**
   * Доска ← артефакты: стадия вверх и ссылка на страницу ревью, где их не
   * хватает. Ничего не изменилось — ни одного вызова `task edit`. Поднятая
   * стадия закрывает открытый отрезок журнала: заход, начатый кнопкой
   * «Создать документ», кончился документом, и следующий стартует с этого.
   */
  async reconcile(): Promise<{ scan: WorkspaceScan; edits: BacklogEditResult[] }> {
    const scan = await this.scan()
    const edits = await applyBacklogEdits(planBacklogEdits(scan.tasks, scan.docsPath), this.config, this.ports)
    if (!edits.length) return { scan, edits }

    let log = await this.readWorkLog()
    for (const edit of edits) {
      if (!edit.ok || !edit.stage) continue
      const task = scan.tasks.find(item => item.id === edit.id)
      const page = task?.links.html ? `, страница ${task.links.html}` : ''
      log = finishWork(log, edit.id, new Date().toISOString(), `${edit.stage}${page}`)
    }
    await this.saveLog(log)

    const after = await this.scan()
    for (const edit of edits) {
      if (edit.ok) continue
      const task = after.tasks.find(item => item.id === edit.id)
      if (task) task.missing = [...task.missing, `доска не обновлена: ${edit.error ?? 'причина неизвестна'}`]
    }
    return { scan: after, edits }
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
  /**
   * Документ требования: собранная страница ревью, а если её ещё нет — исходный markdown.
   *
   * `kind` едет вместе с содержимым, а не выводится получателем из расширения: для
   * markdown представление обязано завернуть текст в страницу, и без этого признака оно
   * показывало бы разметку сырым текстом. Выбор файла — знание хоста (chooseDocument),
   * и вид документа принадлежит тому же выбору.
   *
   * Аргумент `kind` выбирает, какой документ эпика открыть: сам БФТ или скрипт
   * CustDev-интервью. Клиент передаёт только роль, а имя файла по-прежнему не знает —
   * иначе переименование артефакта в навыке протекло бы в браузер.
   */
  async findDocument(
    id: string,
    kind: DocumentRole = 'requirement',
  ): Promise<{ path: string; kind: DocumentKind; content: string } | null> {
    this.assertSlug(id)
    const { docsPath, tasks } = await this.scan()
    // Идентификатор задачи и каталог эпика совпадают не всегда: связку знает скан.
    const slug = tasks.find(item => item.id === id)?.slug ?? id
    const dir = join(this.config.workspaceRoot, docsPath, slug)
    const entries = await this.ports.listDirectory(dir)
    const choice = kind === 'custdev' ? chooseCustdevDocument(slug, entries) : chooseDocument(slug, entries)
    if (!choice) return null
    const path = `${docsPath}/${slug}/${choice.name}`
    const content = await this.readDocument(path)
    return content && content.trim() !== '' ? { path, kind: choice.kind, content } : null
  }

  /**
   * Черновик для чата.
   *
   * Документа ещё нет — это черновик создания: `/bft-fast` с источником из
   * задачи доски и слагом по её идентификатору; заодно в журнале открывается
   * отрезок, который закроет `reconcile`, когда документ появится. Документ
   * есть — продолжение с последнего закрытого отрезка.
   */
  async handoff(id: string): Promise<Handoff> {
    this.assertSlug(id)
    const scan = await this.scan()
    const task = scan.tasks.find(item => item.id === id)
    if (!task) throw new TaskNotFoundError(id)
    if (task.artifactStage !== undefined) return buildHandoff(task, lastFinished(scan.workLog, id), this.config)

    const details = await this.boardDetails(id)
    await this.startWork({ epic: id, stage: task.stage, startedAt: new Date().toISOString() })
    return buildCreateDraft(task, details, scan.docsPath)
  }

  /** Описание, приёмка и заметки задачи доски. Доски нет или CLI молчит — пустые детали, не ошибка. */
  private async boardDetails(id: string) {
    if (!this.config.backlogBin) return {}
    const { stdout, code } = await this.ports.runCommand(
      this.config.backlogBin, ['task', 'view', id, '--json'], this.config.workspaceRoot,
    )
    return code === 0 ? parseTaskViewJson(stdout) : {}
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
