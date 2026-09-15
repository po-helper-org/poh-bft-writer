/**
 * Фасад над воркспейсом: то, что канал отдаёт браузеру.
 *
 * Здесь и только здесь собирается вместе всё остальное — сканирование
 * артефактов, журнал работы, выбор документа. Сам по себе слой тонкий: вся
 * логика, которая может быть неверной, лежит в чистых модулях рядом и
 * проверяется без воркспейса.
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { applyBacklogEdits, planBacklogEdits, type BacklogEditResult } from './backlog-writer.js'
import { ClaudeChatService, type ChatPoll, type ChatRun, type ChatRunStatus } from './claude-chat.js'
import type { BftPluginConfig } from './config.js'
import { chooseCustdevDocument, chooseDocument, type DocumentKind } from './document-source.js'
import {
  ChatRunNotFoundError, ChatUnavailableError, DocumentOutsideWorkspaceError, InvalidTaskIdError,
  OkrHandoffError, TaskNotFoundError,
} from './errors.js'
import { buildCreateDraft, buildHandoff, parseTaskViewJson, type Handoff } from './handoff.js'
import { OKR_READY_STAGE, type BftTask } from './model.js'
import { okrHandoffArgs, type OkrHandoff } from './okr-handoff.js'
import { nodePorts, type BftPorts } from './ports.js'
import { resolveDocsPath, scanWorkspace, type WorkspaceScan } from './reader.js'
import {
  CONFIG_TEMPLATE, relativeConfigPaths, rewriteConfigPaths, sessionDirectory,
} from './session-workspace.js'
import {
  attachSession, finishWork, lastFinished, lastSession, markInterrupted, parseWorkLog, serializeWorkLog,
  startWork, touchSession, WORKLOG_FILE, type SessionState, type WorkEntry, type WorkLog,
} from './worklog.js'

/** Какой документ эпика открывают: сам БФТ или скрипт CustDev-интервью. */
export type DocumentRole = 'requirement' | 'custdev'

/** Слаг эпика — имя каталога. Всё, что похоже на путь, идентификатором не является. */
const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function isOutside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel !== '' && (rel.startsWith('..') || isAbsolute(rel))
}

/** Что детальная страница знает о ходе Claude Code по требованию. */
export interface ChatStatus {
  runId: string
  status: ChatRunStatus
  sessionId?: string
}

export class BftReader {
  /**
   * Чат через Claude Code CLI (issue #41). `null` — выключен: нет порта запуска
   * процессов (тесты, среда без CLI) или `claudeBin: off` в профиле.
   */
  private readonly chat: ClaudeChatService | null

  constructor(
    private readonly config: BftPluginConfig,
    private readonly ports: BftPorts = nodePorts,
  ) {
    const spawn = ports.spawnStreaming
    this.chat = spawn && config.claudeBin
      ? new ClaudeChatService({ bin: config.claudeBin, args: config.claudeArgs }, spawn, (run) => { this.chatFinished(run) })
      : null
  }

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

    await this.updateLog((log) => {
      for (const edit of edits) {
        if (!edit.ok || !edit.stage) continue
        const task = scan.tasks.find(item => item.id === edit.id)
        const page = task?.links.html ? `, страница ${task.links.html}` : ''
        log = finishWork(log, edit.id, new Date().toISOString(), `${edit.stage}${page}`)
      }
      return log
    })

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
   * есть — слэш-команда следующего навыка по артефактам и продолжение с
   * последнего закрытого отрезка. `note` — правка PO из мини-промта детальной
   * страницы: уходит в черновик обратной связью к документу.
   */
  async handoff(id: string, note?: string): Promise<Handoff> {
    this.assertSlug(id)
    const scan = await this.scan()
    const task = scan.tasks.find(item => item.id === id)
    if (!task) throw new TaskNotFoundError(id)
    if (task.artifactStage !== undefined) {
      // Пути в черновике — от каталога, из которого пойдёт чат (`sessionWorkspace`).
      const chatDir = sessionDirectory(this.config.sessionPath, scan.docsPath)
      return buildHandoff(task, lastFinished(scan.workLog, id), this.config, { chatDir, note })
    }

    const details = await this.boardDetails(id)
    await this.startWork({ epic: id, stage: task.stage, startedAt: new Date().toISOString() })
    return buildCreateDraft(task, details, note)
  }

  /**
   * «Добавить в OKR»: готовый БФТ уходит в квартальное планирование.
   *
   * Пишется только на доску — стадия `OKR-ADDED`, план, комментарий, ссылки
   * (см. `okr-handoff.ts`); файлы эпика не трогаются, по ним эта стадия не
   * выводится. Условия жёсткие и названы словами: задача доски есть, стадия
   * ровно `DEEP-DONE`. Не `>=`: из `OKR-ADDED` повторная передача перезаписала
   * бы план, который PO мог уже править в плагине OKR.
   *
   * Успех записывается в журнал итогом «OKR-ADDED, квартал …» — тем же
   * приёмом, каким `reconcile` записывает поднятую стадию. Открытый отрезок
   * (чат по требованию) закрывается этим итогом; нет открытого — отрезок
   * заводится и закрывается сразу: передача в OKR — событие, и следующий
   * заход должен видеть, с чего он начинается.
   */
  async addToOkr(id: string, handoff: OkrHandoff): Promise<BftTask> {
    this.assertSlug(id)
    if (!this.config.backlogBin) throw new OkrHandoffError(id, 'доска Backlog.md выключена в настройках раздела')
    const scan = await this.scan()
    const task = scan.tasks.find(item => item.id === id)
    if (!task) throw new TaskNotFoundError(id)
    if (!task.board) throw new OkrHandoffError(id, 'у требования нет задачи на доске Backlog.md')
    if (task.stage !== OKR_READY_STAGE) {
      throw new OkrHandoffError(id, `в OKR передаётся только ${OKR_READY_STAGE}, а требование в стадии ${task.stage}`)
    }

    const args = okrHandoffArgs(id, handoff, task.board.refs)
    const { stdout, stderr, code } = await this.ports.runCommand(this.config.backlogBin, args, this.config.workspaceRoot)
    if (code !== 0) {
      const first = `${stderr ?? ''}\n${stdout}`.split('\n').map(line => line.trim()).find(line => line !== '')
      throw new OkrHandoffError(id, first ?? `backlog task edit: код ${code}`)
    }

    await this.updateLog((log) => {
      const now = new Date().toISOString()
      const opened = startWork(log, { epic: id, stage: task.stage, startedAt: now })
      return finishWork(opened, id, now, `OKR-ADDED, квартал ${handoff.quarter}`)
    })
    return this.getTask(id)
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
    return this.updateLog(log => startWork(log, entry))
  }

  async finishWork(id: string, summary: string, contextRef?: string): Promise<WorkLog> {
    this.assertSlug(id)
    return this.updateLog(log => finishWork(log, id, new Date().toISOString(), summary, contextRef))
  }

  /**
   * Чат по требованию открыт: запомнить сессию, чтобы PO мог вернуться в неё, а
   * не начинать заново. Стадия отрезка — текущая стадия требования.
   */
  async attachSession(id: string, sessionId: string): Promise<WorkLog> {
    this.assertSlug(id)
    const scan = await this.scan()
    const task = scan.tasks.find(item => item.id === id)
    if (!task) throw new TaskNotFoundError(id)
    return this.updateLog(log => attachSession(log, id, task.stage, sessionId, new Date().toISOString()))
  }

  /** Сессия харнесса сменила состояние. Чужая сессия — журнал не меняется, файл не пишется. */
  async touchSession(sessionId: string, state: SessionState): Promise<void> {
    await this.updateLog(log => touchSession(log, sessionId, state, new Date().toISOString()))
  }

  /** Харнесс поднялся заново: всё, что числилось «агент ходит», оборвалось. */
  async markInterrupted(): Promise<void> {
    await this.updateLog(log => markInterrupted(log, new Date().toISOString()))
  }

  /**
   * Рабочее пространство чатов по требованиям: абсолютный путь каталога, либо
   * `null`, когда привязка выключена (`sessionPath: ''`).
   *
   * Каталог заводится, а в нём — `bft-config.md` с путями к документам,
   * пересчитанными относительно каталога: навыки читают конфиг из корня
   * рабочего пространства чата, и без него в каталоге `bft/` они не нашли бы
   * ни документов, ни линтеров.
   *
   * Копия — производная от конфига корня воркспейса и следует за ним: PO
   * дописал `wiki_space` или `tracker_projects` в корне — следующий ход по
   * требованию видит их (`/bft-deliver` без них спрашивает каждый раз). Поэтому
   * править нужно корневой файл, копию не редактируют. Корневого конфига нет —
   * копия один раз собирается из шаблона и дальше не трогается: тогда она и
   * есть единственный конфиг, и правки PO в ней — его.
   */
  async sessionWorkspace(): Promise<string | null> {
    if (this.config.sessionPath === '') return null
    const docsPath = await resolveDocsPath(this.config, this.ports)
    const dir = sessionDirectory(this.config.sessionPath, docsPath)
    const absolute = resolve(this.config.workspaceRoot, dir)
    if (isOutside(this.config.workspaceRoot, absolute)) throw new DocumentOutsideWorkspaceError(dir)

    const configPath = join(absolute, 'bft-config.md')
    const root = dir === '' ? null : await this.ports.readTextFile(join(this.config.workspaceRoot, 'bft-config.md'))
    const current = await this.ports.readTextFile(configPath)
    if (root === null && current !== null) return absolute
    const paths = relativeConfigPaths(dir, docsPath, this.config.indexPath, this.config.skillsPath)
    const next = rewriteConfigPaths(root ?? CONFIG_TEMPLATE, paths)
    if (next !== current) await this.ports.writeTextFile(configPath, next)
    return absolute
  }

  // ——— Чат по требованию через Claude Code CLI (issue #41) ———

  /**
   * Ход по требованию. Сессия Claude Code известна до запуска: прошлая — из
   * журнала (`--resume`), новая — сгенерированный UUID (`--session-id`); так
   * журнал и «Последняя сессия» не ждут первого события. cwd — рабочее
   * пространство чатов, где лежит `bft-config.md`; корень воркспейса открыт CLI
   * через `--add-dir`, потому что документы и навыки лежат выше.
   *
   * Что уходит CLI. Новая сессия — черновик навыка (`handoff`, тот же, что
   * раньше шёл в композер харнесса), с текстом PO как правкой к документу.
   * Сессия продолжается — текст PO идёт **как есть**: это ответ в тот же
   * диалог («ок» на сухой прогон отгрузки, значения на уточняющие вопросы,
   * следующая правка), и заворачивать его в черновик значило бы задавать модели
   * вопрос заново вместо ответа. Пустое поле в продолжаемой сессии — черновик
   * следующего шага по артефактам (например, `/bft-deliver` после deep).
   */
  async chatStart(id: string, note?: string): Promise<ChatStatus> {
    const chat = this.requireChat()
    this.assertSlug(id)
    const scan = await this.scan()
    const task = scan.tasks.find(item => item.id === id)
    if (!task) throw new TaskNotFoundError(id)
    const previous = lastSession(scan.workLog, id)
    const resume = previous?.kind === 'claude' && previous.state !== 'gone' ? previous.id : undefined
    const text = note?.trim()
    const prompt = resume && text ? text : (await this.handoff(id, note)).prompt
    const cwd = (await this.sessionWorkspace()) ?? this.config.workspaceRoot
    const sessionId = resume ?? randomUUID()
    const started = chat.start(id, prompt, cwd, {
      resume,
      newSessionId: resume ? undefined : sessionId,
      addDir: cwd === this.config.workspaceRoot ? undefined : this.config.workspaceRoot,
    })
    await this.updateLog(log => attachSession(log, id, task.stage, sessionId, new Date().toISOString(), 'claude', 'running'))
    return { runId: started.runId, status: 'running', sessionId }
  }

  /** Хвост событий хода с позиции `since` — для опроса с детальной страницы. */
  chatPoll(runId: string, since: number): ChatPoll {
    const poll = this.requireChat().poll(runId, since)
    if (!poll) throw new ChatRunNotFoundError(runId)
    return poll
  }

  chatStop(runId: string): boolean {
    return this.requireChat().stop(runId)
  }

  /** Последний ход по требованию — идущий подхватывается страницей, открытой заново. */
  chatStatus(id: string): ChatStatus | null {
    this.assertSlug(id)
    const run = this.chat?.latestFor(id)
    return run ? { runId: run.runId, status: run.status, sessionId: run.sessionId } : null
  }

  /** Есть ли чат через Claude Code в этой среде — страница показывает поле ввода только тогда. */
  chatAvailable(): boolean {
    return this.chat !== null
  }

  private requireChat(): ClaudeChatService {
    if (!this.chat) throw new ChatUnavailableError()
    return this.chat
  }

  /**
   * CLI завершился: журнал — «ждёт» или «прервалась», доска — сверка по
   * артефактам, как после хода агента харнесса (там её зовёт `agent/status`,
   * которого у внешнего процесса нет). Ошибки — в консоль: ход уже завершён,
   * ронять ответ клиенту нечем и незачем.
   */
  private chatFinished(run: ChatRun): void {
    const state: SessionState = run.status === 'done' ? 'idle' : 'failed'
    const sessionId = run.sessionId
    const log = sessionId ? this.touchSession(sessionId, state) : Promise.resolve()
    log
      .then(() => this.reconcile())
      .then(({ edits }) => {
        for (const edit of edits) {
          if (!edit.ok) console.warn(`[poh-bft-plugin] доска не обновлена: ${edit.id}: ${edit.error ?? ''}`)
        }
      })
      .catch((error: unknown) => { console.warn('[poh-bft-plugin] после хода Claude Code:', error) })
  }

  /**
   * Все правки журнала идут через одну очередь: события харнесса приходят
   * пачками (`agent/status` на каждый ход), и два параллельных
   * «прочитал-изменил-записал» потеряли бы одно из изменений.
   */
  private logQueue: Promise<unknown> = Promise.resolve()

  private updateLog(change: (log: WorkLog) => WorkLog): Promise<WorkLog> {
    const next = this.logQueue.then(async () => {
      const before = await this.readWorkLog()
      const after = change(before)
      if (after !== before) await this.saveLog(after)
      return after
    })
    this.logQueue = next.catch(() => undefined)
    return next
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
