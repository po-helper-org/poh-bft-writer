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
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
// Реальные компонент кнопки и иконки харнесса (Task 4 визуального выравнивания) вместо
// hand-drawn inline SVG и локальных .btn/.btnOutline/.btnPrimary — см. Panel.tsx. IconCodeOutline16
// для «нет документа»: наш документ требования — HTML-артефакт (links.html), а в наборе икон нет
// прямого «пустой документ» глифа — код-иконка ближе всего к «здесь мог бы быть HTML» смыслу.
import {
  Button, IconChevronLeftOutline14, IconCodeOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RpcResult } from '../channel.js'
import type { BftTask } from '../model.js'
import type { BftLocaleKey } from './locales.js'
import { markdownToPage } from './markdown-page.js'
import { panelClassNames as css } from './Panel.styles.js'
import { buildContinueDraft } from './Preview.js'
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
  findDocument(id: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  /** Обобщённая цепочка «уйти в чат с черновиком» (см. index.tsx). Отправки нет никогда. */
  openChatWithDraft(draft: string): Promise<void>
  /** Стрелка «← Назад»: возвращает панель к превью того же требования (см. Panel.tsx). */
  onBack(): void
  /** Панель целиком — зовётся после успешного ухода в чат, тот же приём, что в Preview.tsx. */
  onClose(): void
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

export function DetailPage({ id, t, getTask, findDocument, openChatWithDraft, onBack, onClose }: DetailPageProps) {
  const [taskState, setTaskState] = useState<TaskState>({ phase: 'loading' })
  const taskControllerRef = useRef<AbortController | null>(null)

  const loadTask = useCallback(() => {
    taskControllerRef.current?.abort()
    const controller = new AbortController()
    taskControllerRef.current = controller
    setTaskState({ phase: 'loading' })
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

  const loadDoc = useCallback(() => {
    docControllerRef.current?.abort()
    const controller = new AbortController()
    docControllerRef.current = controller
    setDocState({ phase: 'loading' })
    findDocument(id, controller.signal)
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
  }, [findDocument, id])

  useEffect(() => {
    loadDoc()
    return () => { docControllerRef.current?.abort() }
  }, [loadDoc])

  const [promptText, setPromptText] = useState('')
  // Общий busy-флаг для обеих кнопок, ведущих в чат («Создать документ» и мини-промт): обе
  // зовут одну и ту же цепочку openChatWithDraft, второй клик до её завершения не нужен —
  // тот же приём, что chatPending в Preview.tsx.
  const [chatPending, setChatPending] = useState(false)

  const sendChat = (draft: string) => {
    setChatPending(true)
    void openChatWithDraft(draft).then(
      () => { onClose() },
      (error: unknown) => {
        setChatPending(false)
        console.error('[poh-bft-plugin] detail chat:', error)
      },
    )
  }

  const handleCreateDocument = (task: BftTask) => {
    sendChat(`/bft-fast ${task.id} «${task.title}»`)
  }

  const handleMiniPrompt = (task: BftTask) => {
    const text = promptText.trim()
    if (text === '') {
      // Пустое поле — тот же черновик, что «Работать в чате» в превью (buildContinueDraft).
      sendChat(buildContinueDraft(task))
      return
    }
    const docPath = task.links.html ?? '—'
    // Ссылка на ветку контекста идёт в правку так же, как в большой черновик:
    // мелкая правка — тот же заход по требованию, и начинать его с нуля незачем.
    const lines = [`По БФТ ${task.id} «${task.title}» (${docPath}): ${text}`, `Стадия: ${task.stage}.`]
    if (task.links.entire) lines.push(`Контекст прошлого захода: ${task.links.entire}`)
    sendChat(lines.join('\n'))
  }

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
              <Button variant="outline" onClick={loadTask}>{t('previewRetry')}</Button>
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
                <Button variant="primary" disabled={chatPending} onClick={() => { handleCreateDocument(taskState.task) }}>
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
                <Button variant="outline" onClick={loadDoc}>{t('retry')}</Button>
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
          </div>
          <DetailSidebar
            task={taskState.task}
            t={t}
            promptText={promptText}
            onPromptChange={setPromptText}
            chatPending={chatPending}
            onSend={() => { handleMiniPrompt(taskState.task) }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Правая колонка: стадия (тот же STAGE_TONE/.groupDot, что превью), ссылки Confluence/эпик
 * (та же разметка `.previewField`/`.previewLink`, что ReadyBody в Preview.tsx — не копия
 * геометрии, переиспользованы классы), и мини-промт — короткий путь вместо полноценного
 * встроенного мини-чата (это следующий этап, см. план).
 */
function DetailSidebar({ task, t, promptText, onPromptChange, chatPending, onSend }: {
  task: BftTask
  t: (key: BftLocaleKey) => string
  promptText: string
  onPromptChange: (value: string) => void
  chatPending: boolean
  onSend: () => void
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
      <div className={css.previewField}>
        <div className={css.previewFieldLabel}>{t('detailMiniPromptLabel')}</div>
        <textarea
          className={css.detailTextarea}
          placeholder={t('detailMiniPromptLabel')}
          value={promptText}
          onChange={(event) => { onPromptChange(event.target.value) }}
        />
      </div>
      <Button variant="primary" className={css.fullWidth} disabled={chatPending} onClick={onSend}>
        {t('detailMiniPromptSend')}
      </Button>
    </div>
  )
}
