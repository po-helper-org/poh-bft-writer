/**
 * Детальная страница требования (Task 3 плана «Панель целиком и превью»): полноэкранная
 * поверх приложения (`position: fixed; inset: 0`, класс `.${css.detailPage}` — см.
 * Panel.styles.ts). Тот же приём, что и соседняя панель Cordis, а не вторая регистрация
 * `shell.overlay` — компонент рендерится третьей веткой того же уже смонтированного
 * slot-компонента `RequirementsPanel` (см. `route.view === 'detail'` в Panel.tsx), а не
 * отдельной записью слота.
 *
 * Данные не наследуются от превью — страница грузит задачу заново по `id` через тот же канал
 * `task` (getTask), что и Preview.tsx, независимо от того, откуда открыта: из превью (объект
 * уже есть у вызывающей стороны) или с доски (Task 4 плана, объекта ни у кого нет — есть только
 * id карточки). Один путь данных вместо двух с разным поведением.
 *
 * Документ — отдельный запрос по каналу `document` (getDocument), запускается только когда
 * задача загружена и её `links.html` заполнен: раньше просто нечем звать канал. Свой
 * AbortController и свой повтор, независимые от загрузки задачи — тот же приём, что в
 * Preview.tsx для `task`.
 *
 * Чат по требованию (issue #41) идёт здесь же, через Claude Code CLI на узле
 * (`claude-chat.ts`): «В чат» запускает ход (`chatStart`), страница опрашивает хвост
 * событий (`chatPoll`) и показывает поток в правой колонке (DetailChat.tsx); пока ход идёт,
 * документ накрыт анимацией проработки, по завершении задача и документ перечитываются.
 * «Создать документ» идёт тем же путём без правки PO (черновик создания собирает узел).
 * Уход в композер харнесса (`openChatWithDraft`) остаётся запасным путём, когда чат
 * Claude Code выключен в профиле (`claudeBin: off`).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { ChatEvent } from '../chat-events.js'
// Реальные компонент кнопки и иконки харнесса (Task 4 визуального выравнивания) вместо
// hand-drawn inline SVG и локальных .btn/.btnOutline/.btnPrimary — см. Panel.tsx. IconCodeOutline16
// для «нет документа»: наш документ требования — HTML-артефакт (links.html), а в наборе икон нет
// прямого «пустой документ» глифа — код-иконка ближе всего к «здесь мог бы быть HTML» смыслу.
import {
  Button, IconChevronLeftOutline14, IconCodeOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DocumentRole } from '../bft-reader.js'
import type { RpcResult } from '../channel.js'
import type { BftTask } from '../model.js'
import type { BftLocaleKey } from './locales.js'
import { markdownToPage } from './markdown-page.js'
import { panelClassNames as css } from './Panel.styles.js'
import { DetailChat, POLL_MS, type ChatRunStatus, type ChatRunView } from './DetailChat.js'
import { buildContinueDraft, isHandoff } from './Preview.js'
import { SessionSummary } from './SessionMark.js'
import { describeSession, type LiveSession, type SessionView } from './session-view.js'
import { STAGE_TONE } from './stage-tone.js'

export interface DetailPageProps {
  /** Идентификатор задачи — единственное, что страница получает о ней на входе. */
  id: string
  t: (key: BftLocaleKey) => string
  /** Канал `/bft`, подкоманда `task` — тот же инжектированный вызов, что у Preview.tsx. */
  getTask(id: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  /**
   * Канал `/bft`, подкоманда `findDocument` — ищет документ по конвенции каталогов.
   * Страница передаёт только идентификатор: где лежит файл и как он называется — знание
   * хоста, а не клиента. Поэтому смена формата ссылок в навыках сюда не протекает.
   */
  findDocument(id: string, kind: DocumentRole, signal: AbortSignal): Promise<RpcResult<unknown>>
  /**
   * Какой документ эпика открыт: сам БФТ или скрипт CustDev-интервью. Приходит извне,
   * потому что открыть страницу сразу на скрипте умеет и превью (ссылка «CustDev»), и
   * переключатель внутри самой страницы.
   */
  doc?: DocumentRole
  /**
   * Канал `/bft`, подкоманда `handoff` — тот же, что у Preview.tsx. Для задачи без
   * документа сервер отдаёт черновик создания (`/bft-fast` с источником из задачи доски и
   * слагом по её идентификатору) и открывает отрезок в журнале работы; клиент шаблон
   * черновика не держит — иначе он разошёлся бы с тем, по чему раздел потом узнаёт эпик.
   */
  getHandoff(id: string, signal: AbortSignal, note?: string): Promise<RpcResult<unknown>>
  /** Обобщённая цепочка «уйти в чат с черновиком» (см. index.tsx). Отправки нет никогда. */
  openChatWithDraft(draft: string, taskId?: string): Promise<void>
  /** Чат через Claude Code CLI: канал `/bft`, подкоманды chatStatus/chatStart/chatPoll/chatStop. */
  chat: DetailChatChannel
  /** Живое состояние сессии харнесса и «Открыть чат» — см. RequirementsPanelInjected. */
  sessionInfo(sessionId: string): LiveSession | null | undefined
  openSession(sessionId: string): void
  /** Стрелка «← Назад»: возвращает панель к превью того же требования (см. Panel.tsx). */
  onBack(): void
  /** Панель целиком — зовётся после успешного ухода в чат, тот же приём, что в Preview.tsx. */
  onClose(): void
}

/** Подкоманды чата — как их отдаёт index.tsx; формы ответов проверяются здесь (toChatStatus и др.). */
export interface DetailChatChannel {
  status(id: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  start(id: string, note: string | undefined, signal: AbortSignal): Promise<RpcResult<unknown>>
  poll(runId: string, since: number, signal: AbortSignal): Promise<RpcResult<unknown>>
  stop(runId: string): Promise<RpcResult<unknown>>
}

type TaskState =
  | { phase: 'loading' }
  | { phase: 'ready'; task: BftTask }
  | { phase: 'error'; code: string; message: string }

type DocState =
  | { phase: 'loading' }
  /** Найден документ: `html` уже готов к показу (markdown завёрнут в страницу до этого). */
  | { phase: 'ready'; html: string; path: string; kind: 'html' | 'markdown' }
  /** В папке эпика нечего показать — либо самой папки нет. Это не ошибка. */
  | { phase: 'missing' }
  | { phase: 'error'; message: string }

/** Тот же приём защиты от мусора на проводе, что toTask() в Preview.tsx — не дублируем его
 * оттуда только потому, что BftTask там не экспортирован как утилита, а объявлен инлайн. */
function toTask(value: unknown): BftTask | null {
  if (typeof value !== 'object' || value === null) {
    console.error('[poh-bft-plugin] task ответил не объектом:', value)
    return null
  }
  return value as BftTask
}

/** Ответ канала `findDocument`: найденный документ либо `null`, если показывать нечего. */
interface FoundDocument {
  path: string
  kind: 'html' | 'markdown'
  content: string
}

/** `reader.findDocument()` отдаёт объект или `null`; что угодно ещё — признак поломки. */
function toFoundDocument(value: unknown): FoundDocument | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') {
    console.error('[poh-bft-plugin] findDocument ответил не объектом:', value)
    return null
  }
  const doc = value as Partial<FoundDocument>
  if (typeof doc.content !== 'string' || typeof doc.path !== 'string') {
    console.error('[poh-bft-plugin] findDocument вернул документ без содержимого:', value)
    return null
  }
  return { path: doc.path, kind: doc.kind === 'markdown' ? 'markdown' : 'html', content: doc.content }
}

const RUN_STATUSES: readonly ChatRunStatus[] = ['running', 'done', 'failed', 'stopped']

function toRunStatus(value: unknown): ChatRunStatus | null {
  return typeof value === 'string' && (RUN_STATUSES as readonly string[]).includes(value) ? (value as ChatRunStatus) : null
}

/** Ответ `chatStatus`: есть ли чат в этой среде и последний ход по требованию. */
function toChatStatus(value: unknown): { available: boolean; run: { runId: string; status: ChatRunStatus } | null } | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { available?: unknown; run?: unknown }
  if (typeof raw.available !== 'boolean') return null
  const run = raw.run as { runId?: unknown; status?: unknown } | null | undefined
  if (run === null || run === undefined) return { available: raw.available, run: null }
  const status = toRunStatus(run.status)
  return typeof run.runId === 'string' && status ? { available: raw.available, run: { runId: run.runId, status } } : null
}

/** Ответ `chatStart`: идентификатор хода. */
function toRunId(value: unknown): string | null {
  const raw = value as { runId?: unknown } | null
  return raw && typeof raw.runId === 'string' ? raw.runId : null
}

/** Ответ `chatPoll`: хвост событий, состояние, общий счётчик. Форму событий не проверяем поштучно — проекция терпима к незнакомым. */
function toPoll(value: unknown): { status: ChatRunStatus; events: ChatEvent[]; total: number } | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as { status?: unknown; events?: unknown; total?: unknown }
  const status = toRunStatus(raw.status)
  if (!status || !Array.isArray(raw.events) || typeof raw.total !== 'number') return null
  return { status, events: raw.events as ChatEvent[], total: raw.total }
}

/** Запасной мини-промт, когда канал не ответил: без команды навыка, но с правкой PO и стадией. */
function fallbackMiniPrompt(task: BftTask, text: string): string {
  if (text === '') return buildContinueDraft(task)
  const lines = [`По БФТ ${task.id} «${task.title}»: ${text}`, `Стадия на доске: ${task.stage}.`]
  if (task.links.entire) lines.push(`Контекст прошлого захода: ${task.links.entire}`)
  return lines.join('\n')
}

export function DetailPage({ id, t, getTask, findDocument, doc: initialDoc = 'requirement', getHandoff, openChatWithDraft, chat, sessionInfo, openSession, onBack, onClose }: DetailPageProps) {
  const [taskState, setTaskState] = useState<TaskState>({ phase: 'loading' })
  const taskControllerRef = useRef<AbortController | null>(null)

  /**
   * `silent` — перечитать, не роняя страницу в «загружаю»: после хода Claude Code задача и
   * документ обновляются под ногами у PO, и мигать пустым экраном тут незачем.
   */
  const loadTask = useCallback((silent = false) => {
    taskControllerRef.current?.abort()
    const controller = new AbortController()
    taskControllerRef.current = controller
    if (!silent) setTaskState({ phase: 'loading' })
    getTask(id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          setTaskState({ phase: 'error', code: result.error.code, message: result.error.message })
          return
        }
        const task = toTask(result.value)
        setTaskState(task === null ? { phase: 'error', code: 'parse-error', message: '' } : { phase: 'ready', task })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setTaskState({ phase: 'error', code: 'internal', message: error instanceof Error ? error.message : String(error) })
      })
  }, [getTask, id])

  useEffect(() => {
    loadTask()
    return () => { taskControllerRef.current?.abort() }
  }, [loadTask])

  // Документ ищется по идентификатору требования, а не по пути из ссылок: где лежит файл —
  // знание хоста (см. reader.findDocument). Поэтому запрос не ждёт загрузки задачи и не
  // зависит от того, записал ли навык ссылку на артефакт.
  const [docState, setDocState] = useState<DocState>({ phase: 'loading' })
  const docControllerRef = useRef<AbortController | null>(null)
  // Какой из двух документов эпика показан. Живёт здесь, а не в маршруте панели: переключение
  // не меняет, что открыто, — оно меняет, что видно внутри уже открытого требования.
  const [docRole, setDocRole] = useState<DocumentRole>(initialDoc)

  const loadDoc = useCallback((silent = false) => {
    docControllerRef.current?.abort()
    const controller = new AbortController()
    docControllerRef.current = controller
    if (!silent) setDocState({ phase: 'loading' })
    findDocument(id, docRole, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          setDocState({ phase: 'error', message: result.error.message })
          return
        }
        const doc = toFoundDocument(result.value)
        if (doc === null) {
          setDocState({ phase: 'missing' })
          return
        }
        // Markdown заворачивается в страницу здесь, а не на хосте: хост отдаёт артефакт как
        // есть, а как его показать — решение представления.
        const html = doc.kind === 'markdown' ? markdownToPage(doc.content, doc.path) : doc.content
        setDocState({ phase: 'ready', html, path: doc.path, kind: doc.kind })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setDocState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
      })
  }, [findDocument, id, docRole])

  useEffect(() => {
    loadDoc()
    return () => { docControllerRef.current?.abort() }
  }, [loadDoc])

  const [promptText, setPromptText] = useState('')
  // Общий busy-флаг для обеих кнопок, ведущих в чат («Создать документ» и мини-промт): обе
  // зовут одну и ту же цепочку openChatWithDraft, второй клик до её завершения не нужен —
  // тот же приём, что chatPending в Preview.tsx.
  const [chatPending, setChatPending] = useState(false)

  // Запасной путь «Создать документ», когда чат Claude Code выключен: черновик создания
  // приходит с сервера (см. getHandoff) и уходит в композер харнесса. Канал не ответил —
  // короткий черновик: без источника и слага, но уйти в чат без ничего хуже.
  const createInHarness = (task: BftTask) => {
    setChatPending(true)
    const controller = new AbortController()
    void getHandoff(task.id, controller.signal)
      .then(result => (result.ok && isHandoff(result.value) ? result.value.prompt : `/bft-fast ${task.id} «${task.title}»`))
      .catch(() => `/bft-fast ${task.id} «${task.title}»`)
      .then(draft => openChatWithDraft(draft, task.id))
      .then(
        () => { onClose() },
        (error: unknown) => {
          setChatPending(false)
          console.error('[poh-bft-plugin] detail create:', error)
        },
      )
  }

  // Запасной путь, когда чат Claude Code выключен в профиле: тот же черновик — в композер
  // харнесса. Черновик собирает сервер (подкоманда `handoff`): он знает журнал, состав
  // артефактов и каталог рабочего пространства чата — и открывает черновик слэш-командой
  // следующего навыка. Канал не ответил — короткий черновик, как в превью.
  const handoffToHarness = (task: BftTask, text: string) => {
    setChatPending(true)
    const controller = new AbortController()
    void getHandoff(task.id, controller.signal, text === '' ? undefined : text)
      .then(result => (result.ok && isHandoff(result.value) ? result.value.prompt : fallbackMiniPrompt(task, text)))
      .catch(() => fallbackMiniPrompt(task, text))
      .then(draft => openChatWithDraft(draft, task.id))
      .then(
        () => { onClose() },
        (error: unknown) => {
          setChatPending(false)
          console.error('[poh-bft-plugin] detail chat:', error)
        },
      )
  }

  // ——— Чат через Claude Code (issue #41) ———
  //
  // Состояние хода живёт здесь, а не в DetailChat: от него зависят и анимация на документе,
  // и перечитывание задачи с документом по завершении. `chatAvailable` — ответ узла, есть
  // ли CLI в этой среде; до ответа кнопка ведёт себя как при доступном чате.
  const [chatAvailable, setChatAvailable] = useState<boolean | undefined>(undefined)
  const [chatRun, setChatRun] = useState<ChatRunView | null>(null)
  const [chatStarting, setChatStarting] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const pollControllerRef = useRef<AbortController | null>(null)
  // Перечитывание и словарь — через ref, чтобы `pollRun` (и эффект подхвата хода ниже) не
  // пересоздавались при смене документа или перерисовке: пересоздание перезапускало бы опрос.
  const latestRef = useRef({ loadTask, loadDoc, t })
  latestRef.current = { loadTask, loadDoc, t }

  /**
   * Опрос хвоста событий, пока ход идёт. Один живой опрос на страницу: новый ход или
   * размонтирование обрывают предыдущий через AbortController. Ход завершился — задача и
   * документ перечитываются: CLI менял файлы, а доска сверялась на узле.
   */
  const pollRun = useCallback((runId: string, since: number) => {
    pollControllerRef.current?.abort()
    const controller = new AbortController()
    pollControllerRef.current = controller
    const tick = (from: number) => {
      chat.poll(runId, from, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          if (!result.ok) {
            // Узел перезапустился и хода не помнит — прогон потерян, страница это говорит.
            setChatError(result.error.code === 'chat-run-not-found' ? latestRef.current.t('detailChatLost') : result.error.message)
            setChatRun(run => (run && run.runId === runId ? { ...run, status: 'failed' } : run))
            return
          }
          const poll = toPoll(result.value)
          if (!poll) {
            setChatError(latestRef.current.t('previewParseError'))
            return
          }
          setChatRun(run => (run && run.runId === runId
            ? { ...run, status: poll.status, events: poll.events.length ? [...run.events, ...poll.events] : run.events, since: poll.total }
            : run))
          if (poll.status === 'running') {
            setTimeout(() => { if (!controller.signal.aborted) tick(poll.total) }, POLL_MS)
            return
          }
          latestRef.current.loadTask(true)
          latestRef.current.loadDoc(true)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setChatError(error instanceof Error ? error.message : String(error))
        })
    }
    tick(since)
  }, [chat])

  // Страница открыта заново, пока ход ещё идёт (или только что закончился): подхватить его —
  // транскрипт с начала, опрос — если ход не завершён.
  useEffect(() => {
    const controller = new AbortController()
    chat.status(id, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          setChatAvailable(false)
          return
        }
        const status = toChatStatus(result.value)
        if (!status) return
        setChatAvailable(status.available)
        if (status.run) {
          setChatRun({ runId: status.run.runId, status: status.run.status, events: [], since: 0 })
          pollRun(status.run.runId, 0)
        }
      })
      .catch(() => { /* нет ответа — кнопка ведёт себя как при доступном чате, ошибка придёт на отправке */ })
    return () => {
      controller.abort()
      pollControllerRef.current?.abort()
    }
  }, [chat, id, pollRun])

  /**
   * Ход Claude Code по требованию: с правкой PO («В чат») или без неё («Создать документ»
   * — черновик создания узел соберёт сам, см. handoff). Чат выключен в профиле —
   * запасной путь в композер харнесса.
   */
  const startRun = (task: BftTask, text: string, fallback: () => void) => {
    if (chatAvailable === false) {
      fallback()
      return
    }
    setChatStarting(true)
    setChatError(null)
    const controller = new AbortController()
    chat.start(task.id, text === '' ? undefined : text, controller.signal)
      .then((result) => {
        setChatStarting(false)
        if (!result.ok) {
          // Чата в этой среде нет — узел сказал это первым отказом: дальше — композер харнесса.
          if (result.error.code === 'chat-unavailable') {
            setChatAvailable(false)
            fallback()
            return
          }
          setChatError(result.error.message)
          return
        }
        const runId = toRunId(result.value)
        if (!runId) {
          setChatError(t('previewParseError'))
          return
        }
        setPromptText('')
        setChatRun({ runId, status: 'running', events: [], since: 0 })
        pollRun(runId, 0)
      })
      .catch((error: unknown) => {
        setChatStarting(false)
        setChatError(error instanceof Error ? error.message : String(error))
      })
  }

  const handleMiniPrompt = (task: BftTask) => {
    const text = promptText.trim()
    startRun(task, text, () => { handoffToHarness(task, text) })
  }

  const handleCreateDocument = (task: BftTask) => {
    startRun(task, '', () => { createInHarness(task) })
  }

  const handleStop = () => {
    if (!chatRun) return
    chat.stop(chatRun.runId).catch((error: unknown) => { console.error('[poh-bft-plugin] chatStop:', error) })
  }

  const chatWorking = chatStarting || chatRun?.status === 'running'

  return (
    <div className={css.detailPage}>
      <div className={css.header}>
        <button type="button" className={css.iconButton} aria-label={t('detailBack')} onClick={onBack}>
          <IconChevronLeftOutline14 size={14} />
        </button>
        {taskState.phase === 'ready'
          ? (
            <>
              <h2>{taskState.task.title}</h2>
              <span className={css.itemId}>{taskState.task.id}</span>
            </>
            )
          : <h2>{t('detailHeaderTitle')}</h2>}
      </div>

      {taskState.phase !== 'ready' && (
        <div className={css.body}>
          {taskState.phase === 'loading' && (
            <div className={css.stateBlock} aria-busy="true">
              <p className={css.stateMessage}>{t('previewLoading')}</p>
            </div>
          )}
          {taskState.phase === 'error' && taskState.code === 'task-not-found' && (
            <div className={css.stateBlock}>
              <span className={css.stateIcon} data-tone="error" aria-hidden="true"><IconWarningOutline16 size={20} /></span>
              <p className={css.stateMessage}>{t('previewTaskNotFound')}</p>
              <Button variant="outline" onClick={onBack}>{t('detailBack')}</Button>
            </div>
          )}
          {taskState.phase === 'error' && taskState.code !== 'task-not-found' && (
            <div className={css.stateBlock}>
              <span className={css.stateIcon} data-tone="error" aria-hidden="true"><IconWarningOutline16 size={20} /></span>
              <p className={css.stateMessage}>
                {taskState.code === 'parse-error' ? t('previewParseError') : taskState.message}
              </p>
              <Button variant="outline" onClick={() => { loadTask() }}>{t('previewRetry')}</Button>
            </div>
          )}
        </div>
      )}

      {taskState.phase === 'ready' && (
        <div className={css.detailBody}>
          <div className={css.detailLeft}>
            {docState.phase === 'missing' && (
              <div className={css.stateBlock}>
                <span className={css.stateIcon} aria-hidden="true"><IconCodeOutline16 size={20} /></span>
                <h3 className={css.stateTitle}>{t('detailNoDocument')}</h3>
                <p className={css.stateHint}>{t('detailNoDocumentHint')}</p>
                <Button variant="primary" disabled={chatPending || chatWorking} onClick={() => { handleCreateDocument(taskState.task) }}>
                  {t('detailCreateDocument')}
                </Button>
              </div>
            )}
            {docState.phase === 'loading' && (
              <div className={css.stateBlock} aria-busy="true">
                <p className={css.stateMessage}>{t('detailDocumentLoading')}</p>
              </div>
            )}
            {docState.phase === 'error' && (
              <div className={css.stateBlock}>
                <span className={css.stateIcon} data-tone="error" aria-hidden="true"><IconWarningOutline16 size={20} /></span>
                <p className={css.stateMessage}>{docState.message}</p>
                <Button variant="outline" onClick={() => { loadDoc() }}>{t('retry')}</Button>
              </div>
            )}
            {taskState.task.artifacts.custdev && (
              // Две кнопки, а не вкладки харнесса: переключатель из двух состояний, и
              // собственный компонент вкладок ради него был бы тяжелее самой функции.
              <div className={css.detailDocSwitch} role="group" aria-label={t('detailDocSwitch')}>
                <Button
                  variant={docRole === 'requirement' ? 'primary' : 'outline'}
                  onClick={() => { setDocRole('requirement') }}
                >
                  {t('detailDocRequirement')}
                </Button>
                <Button
                  variant={docRole === 'custdev' ? 'primary' : 'outline'}
                  onClick={() => { setDocRole('custdev') }}
                >
                  {t('detailDocCustdev')}
                </Button>
              </div>
            )}
            {docState.phase === 'ready' && (
              // allow-same-origin ОБЯЗАТЕЛЕН: без него localStorage документа кидает исключение,
              // и комментирование внутри HTML-документа молча ломается (issue #36). Тесты этого
              // не проверяют — флаг просто не трогать.
              <iframe
                className={css.detailFrame}
                title={t('detailDocumentFrameTitle')}
                srcDoc={docState.html}
                sandbox="allow-scripts allow-same-origin allow-popups"
              />
            )}
            {chatWorking && (
              // Анимация проработки поверх документа, пока ход Claude Code идёт: документ
              // остаётся читаемым под полупрозрачной плёнкой, бегущая полоса сверху — что
              // работа идёт, подпись — чья.
              <div className={css.docWorking} role="status" aria-live="polite">
                <div className={css.docWorkingBar} aria-hidden="true" />
                <div className={css.docWorkingPill}>
                  <span className={css.chatPulse} aria-hidden="true" />
                  {t('detailChatWorking')}
                </div>
              </div>
            )}
          </div>
          <DetailSidebar
            task={taskState.task}
            t={t}
            session={describeSession(taskState.task.session, taskState.task.session ? sessionInfo(taskState.task.session.id) : undefined)}
            onOpenSession={(sessionId) => { openSession(sessionId); onClose() }}
          >
            <DetailChat
              t={t}
              available={chatAvailable}
              run={chatRun}
              starting={chatStarting || chatPending}
              error={chatError}
              promptText={promptText}
              onPromptChange={setPromptText}
              onSend={() => { handleMiniPrompt(taskState.task) }}
              onStop={handleStop}
              onOpenDetail={() => { loadTask(); loadDoc() }}
              links={taskState.task.links}
            />
          </DetailSidebar>
        </div>
      )}
    </div>
  )
}

/**
 * Правая колонка: стадия (тот же STAGE_TONE/.groupDot, что превью), ссылки Confluence/эпик
 * (та же разметка `.previewField`/`.previewLink`, что ReadyBody в Preview.tsx — не копия
 * геометрии, переиспользованы классы), и чат с Claude Code (`children` — DetailChat.tsx),
 * который забирает оставшуюся высоту колонки.
 */
function DetailSidebar({ task, t, session, onOpenSession, children }: {
  task: BftTask
  t: (key: BftLocaleKey) => string
  session: SessionView | null
  onOpenSession: (sessionId: string) => void
  children: ReactNode
}) {
  const tone = { '--tone': STAGE_TONE[task.stage] } as CSSProperties
  return (
    <div className={css.detailRight}>
      <div className={css.previewField}>
        <div className={css.previewFieldLabel}>{t('previewStage')}</div>
        <div className={css.previewFieldValue}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span className={css.groupDot} style={tone} aria-hidden="true" />
            {task.stage}
          </span>
        </div>
      </div>
      <div className={css.previewField}>
        <div className={css.previewFieldLabel}>{t('previewSession')}</div>
        <div className={css.previewFieldValue}>
          <SessionSummary session={session} t={t} onOpen={onOpenSession} />
        </div>
      </div>
      {task.links.confluence && (
        <div className={css.previewField}>
          <div className={css.previewFieldLabel}>{t('previewLinksConfluence')}</div>
          <div className={css.previewFieldValue}>
            <a className={css.previewLink} href={task.links.confluence} target="_blank" rel="noopener">
              {task.links.confluence}
            </a>
          </div>
        </div>
      )}
      {task.links.epic && (
        <div className={css.previewField}>
          <div className={css.previewFieldLabel}>{t('previewLinksEpic')}</div>
          <div className={css.previewFieldValue}>
            <a className={css.previewLink} href={task.links.epic} target="_blank" rel="noopener">
              {task.links.epic}
            </a>
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
