/**
 * Панель «Требования»: список БФТ-задач по каналу `/bft` (подкоманда `list`), сгруппированный
 * по стадиям через queueGroups() из ядра пакета (src/queue.ts) — своей группировки здесь нет.
 *
 * Регистрируется отдельной записью в слое оверлеев (`shell.overlay`, см. src/client/index.tsx).
 * Корневой элемент — сама панель (`.bft-panel`, стили и карта имён — Panel.styles.ts, текст CSS
 * инжектирует index.tsx в <style>, см. комментарий там же): слой оверлеев прозрачен для
 * указателя и передаёт pointer-events только прямым детям якоря записи (display:contents), так
 * что растянутый на весь экран корень перехватил бы клики по всему приложению вместо панели —
 * см. docs/client-wiring.md, §3.2. Поэтому .bft-panel сама задаёт себе геометрию
 * (top/right/bottom/width) и pointer-events: auto, а не оборачивается в inset:0-контейнер.
 *
 * Видимость держит стор слота из src/client/index.tsx (`panelStore`, @deepseek-ai/dsh-client-store) —
 * одна и та же регистрация `store:` стоит и у записи кнопки, и у записи этой панели, поэтому
 * `useStore`/`actions` синтезированы фреймворком и всегда согласованы. Пока `open` ложный,
 * компонент рендерит null: тогда в оверлее вообще нет узла панели и перехватывать клики нечему.
 *
 * Четыре состояния тела: загрузка (скелет той же геометрии, что и список — без прыжка
 * раскладки), список (группы по стадиям), пусто (список получен, требований нет) и ошибка
 * (текст ответа канала как есть + «Повторить»). Текст ошибки — из RpcResult.error.message,
 * он уже написан для пользователя на node-половине (src/channel.ts) и не переформулируется.
 */
// Type-only: даёт слияние SlotMap с записью 'shell.overlay' — нужно PropsRuntime<'shell.overlay'> ниже.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { PropsStore } from '@deepseek-ai/dsh-client-store'
// Реальные компонент кнопки и иконки харнесса (Task 4 визуального выравнивания) вместо
// hand-drawn inline SVG и локальных .btn/.btnOutline: пакет внешний (см. CLIENT_EXTERNALS в
// tsdown.config.ts), берётся у хоста в рантайме вместе с уже загруженным им CSS.
// IconArchiveOutline20 — «пусто»/«ничего не найдено» (архивная коробка, ближайшее совпадение
// из полного набора icons/index.tsx — точного «empty state» глифа там нет, см. отчёт задачи).
// IconRefreshOutline16 и IconSearchOutline16/IconCloseOutline16 — прямое совпадение по смыслу.
import {
  Button, IconArchiveOutline20, IconCloseOutline16, IconRefreshOutline16, IconSearchOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpcResult } from '../channel.js'
import type { BftStage } from '../model.js'
import { queueGroups, searchTasks, type BftGroup } from '../queue.js'
// Type-only: PanelStoreHandle описывает форму стора, реальный хэндл создаётся в apply()
// (src/client/index.tsx) и сюда не импортируется — только тип, значение не пересекает границу.
import type { PanelStoreHandle } from './index.js'
// Не CSS-модуль (сборка стороннего плагина его не поддерживает — см. Panel.styles.ts):
// плоская карта «семантическое имя → класс», тот же текст инжектирует index.tsx в <style>.
import { Board } from './Board.js'
import { DetailPage } from './DetailPage.js'
import { panelClassNames as css } from './Panel.styles.js'
import { Preview } from './Preview.js'
import { STAGE_TONE } from './stage-tone.js'
import { readTaskCache, toTaskSummaries, writeTaskCache } from './task-cache.js'

/** Собственный business-face панели: всё остальное (open/close) несёт общий со кнопкой стор. */
export interface RequirementsPanelInjected {
  listRequirements(signal: AbortSignal): Promise<RpcResult<unknown>>
  /** Превью требования: канал `/bft`, подкоманда `task`, см. Preview.tsx. */
  getTask(id: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  /** Документ требования: канал `/bft`, подкоманда `document`, см. DetailPage.tsx (Task 3). */
  getDocument(path: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  /**
   * Поиск документа по конвенции каталогов: канал `/bft`, подкоманда `findDocument`.
   * Основной путь получения документа на детальной странице: в отличие от `getDocument`
   * не требует, чтобы навык записал ссылку на файл в строго определённом формате.
   */
  findDocument(id: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  /**
   * Черновик для чата: канал `/bft`, подкоманда `handoff`. Собирается на сервере,
   * потому что опирается на журнал работы — клиенту он не виден.
   */
  getHandoff(id: string, signal: AbortSignal): Promise<RpcResult<unknown>>
  /**
   * Кнопка «Обновить»: цепочка connectWorkspace → scope → setDraft → open, собранная в
   * src/client/index.tsx (docs/client-wiring.md, §1.3). Открывает чат с подставленной
   * командой синка `/bft-needed-list` — без автоотправки, Enter жмёт PO. Промис отклоняется,
   * если цепочка не собралась (служба недоступна, нет рабочего пространства, sessions.scope
   * вернул undefined) — тогда панель остаётся открытой, см. onClick ниже.
   */
  openSyncChat(): Promise<void>
  /**
   * Та же цепочка, обобщённая до произвольного черновика — использует превью для кнопки
   * «Работать в чате» (Preview.tsx) и детальную страницу (DetailPage.tsx). Отправки нет ни при
   * каких условиях, см. index.tsx.
   */
  openChatWithDraft(draft: string): Promise<void>
}

export type RequirementsPanelProps =
  PropsRuntime<'shell.overlay'> &
  PropsStore<PanelStoreHandle> &
  InjectFace<RequirementsPanelInjected> &
  PropsLocale<'bft.requirements'>

type BodyState =
  | { phase: 'loading' }
  | { phase: 'ready'; groups: BftGroup[]; total: number }
  | { phase: 'empty' }
  | { phase: 'error'; message: string }

/**
 * Куда возвращает стрелка «← Назад» детальной страницы (route.view === 'detail' ниже): до
 * задачи 4 в детальную страницу вело единственное место (превью того же требования), и «назад»
 * был зашит как константа. Теперь входов два — превью конкретного требования и доска по
 * стадиям (Task 4, Board.tsx, у которой нет «своего» требования) — поэтому куда вернуться,
 * несёт сам маршрут, а не жёстко забитое предположение на стороне DetailPage.
 */
type DetailBackRoute = { view: 'preview'; id: string } | { view: 'board' }

/**
 * Что сейчас показывает панель: список, превью одного требования, его детальная страница
 * (Task 3) или доска по стадиям (Task 4). Один размеченный union вместо нескольких независимых
 * `string | null` (было `previewId`) — так невозможно собрать состояние вида «detailId задан, а
 * previewId — нет» и наоборот. Локальное состояние компонента, не переживает закрытие панели
 * (см. useEffect сброса ниже).
 * `onOpenDetail`, которым Preview.tsx и Board.tsx открывают детальную страницу, не часть
 * RequirementsPanelInjected — он был заглушкой именно под задачу 2→3, а не законченным
 * архитектурным решением; переключение режима панели живёт здесь же, локально, рядом с
 * остальной навигацией панели.
 */
type PanelRoute =
  | { view: 'list' }
  | { view: 'preview'; id: string }
  | { view: 'detail'; id: string; back: DetailBackRoute }
  | { view: 'board' }

/** Панель раздела. Возвращает null, пока закрыта — тогда в оверлее нет узла, перехватывать нечего. */
export function RequirementsPanel({
  useStore,
  actions,
  listRequirements,
  getTask,
  getDocument,
  findDocument,
  getHandoff,
  openSyncChat,
  openChatWithDraft,
  t,
}: RequirementsPanelProps) {
  const isOpen = useStore(state => state.open)
  // Кэш localStorage (task-cache.ts) — переживает не только закрытие панели, но и перезагрузку
  // страницы: PO просил <1с открытие, когда данные уже загружены локально. Читается один раз
  // здесь (ленивый инициализатор — сам компонент монтируется один раз при загрузке страницы,
  // задолго до первого открытия панели), дальше см. `load()` ниже, которая и держит state, и
  // пишет кэш при каждой успешной загрузке.
  const [state, setState] = useState<BodyState>(() => {
    const cached = readTaskCache()
    if (cached === undefined) return { phase: 'loading' }
    const groups = queueGroups(cached)
    const total = groups.reduce((sum, group) => sum + group.tasks.length, 0)
    return total === 0 ? { phase: 'empty' } : { phase: 'ready', groups, total }
  })
  const [collapsed, setCollapsed] = useState<ReadonlySet<BftStage>>(() => new Set())
  const [query, setQuery] = useState('')
  const [route, setRoute] = useState<PanelRoute>({ view: 'list' })
  const controllerRef = useRef<AbortController | null>(null)

  // silent=true — фоновое обновление кэша: не сбрасывает экран в 'loading' и не показывает
  // ошибку, если она случится (что уже показано — то и остаётся). Обычный вызов (retry,
  // первая загрузка) идёт через явный 'loading', как раньше.
  const load = useCallback((opts?: { silent?: boolean }) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const silent = opts?.silent ?? false
    if (!silent) setState({ phase: 'loading' })
    listRequirements(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        if (!result.ok) {
          if (silent) { console.error('[poh-bft-plugin] фоновое обновление списка:', result.error.message); return }
          setState({ phase: 'error', message: result.error.message })
          return
        }
        const tasks = toTaskSummaries(result.value)
        writeTaskCache(tasks)
        const groups = queueGroups(tasks)
        const total = groups.reduce((sum, group) => sum + group.tasks.length, 0)
        setState(total === 0 ? { phase: 'empty' } : { phase: 'ready', groups, total })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        if (silent) { console.error('[poh-bft-plugin] фоновое обновление списка:', message); return }
        setState({ phase: 'error', message })
      })
  }, [listRequirements])

  useEffect(() => {
    if (!isOpen) return
    // Кэш списка (PO: «открывается долго каждый раз» — backlog CLI поднимается секунды).
    // `state` уже может быть 'ready'/'empty' здесь двумя разными путями: осталось от прошлого
    // открытия в эту же загрузку страницы (компонент не размонтируется при закрытии панели, см.
    // `if (!isOpen) return null` ниже), либо восстановлено из localStorage самим ленивым
    // инициализатором `useState` выше — для эффекта разницы нет, в обоих случаях рисуем то, что
    // уже есть, без спиннера, и молча обновляем в фоне. Иначе (кэша не было нигде, или прошлая
    // попытка упала ошибкой) — обычная загрузка с 'loading'.
    load({ silent: state.phase === 'ready' || state.phase === 'empty' })
    return () => { controllerRef.current?.abort() }
  }, [isOpen, load])

  // Свёрнутость групп и текст поиска — локальное состояние панели, не переживает закрытие:
  // при следующем открытии список должен снова быть развёрнут и без старого фильтра.
  useEffect(() => {
    if (isOpen) return
    setCollapsed(new Set())
    setQuery('')
    setRoute({ view: 'list' })
  }, [isOpen])

  if (!isOpen) return null

  const toggleGroup = (stage: BftStage) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  const badgeCount = state.phase === 'ready' ? state.total : state.phase === 'empty' ? 0 : undefined

  // Фильтрация — по уже загруженному списку (searchTasks из ядра), без похода в канал.
  // Пустые после фильтрации группы не показываются нулями — отбрасываются целиком.
  const filteredGroups = state.phase === 'ready'
    ? state.groups
      .map(g => ({ stage: g.stage, tasks: searchTasks(g.tasks, query) }))
      .filter(g => g.tasks.length > 0)
    : []
  const isSearching = state.phase === 'ready' && query.trim().length > 0
  const noSearchResults = isSearching && filteredGroups.length === 0

  // Детальная страница (Task 3) — не .bft-panel: свой полноэкранный корень поверх всего
  // приложения (см. .${css.detailPage} в Panel.styles.ts), тот же приём соседней панели
  // Cordis, что описан в DetailPage.tsx, а не второй слой оверлеев. «Назад» возвращает туда,
  // откуда открыли (route.back, см. DetailBackRoute выше) — превью того же требования (Task 2)
  // или доску (Task 4), а не всегда к превью, как было зашито до задачи 4.
  if (route.view === 'detail') {
    return (
      <DetailPage
        id={route.id}
        t={t}
        getTask={getTask}
        findDocument={findDocument}
        openChatWithDraft={openChatWithDraft}
        onBack={() => { setRoute(route.back) }}
        onClose={() => { actions.close() }}
      />
    )
  }

  // Режим превью полностью подменяет тело панели (Task 2): тот же корневой .bft-panel,
  // своя шапка со стрелкой «назад» вместо заголовка/бейджа/«Обновить» — см. Preview.tsx.
  if (route.view === 'preview') {
    return (
      <aside className={css.panel} aria-label={t('previewHeaderTitle')}>
        <Preview
          id={route.id}
          t={t}
          getTask={getTask}
          getHandoff={getHandoff}
          openChatWithDraft={openChatWithDraft}
          onOpenDetail={(id) => { setRoute({ view: 'detail', id, back: { view: 'preview', id } }) }}
          onBack={() => { setRoute({ view: 'list' }) }}
          onClose={() => { actions.close() }}
        />
      </aside>
    )
  }

  // Доска по стадиям (Task 4) — не .bft-panel: свой полноэкранный корень поверх приложения,
  // тот же приём, что и детальная страница выше (третья/четвёртая ветка того же уже
  // смонтированного slot-компонента, а не второй слой оверлеев). Список требований доска
  // грузит сама (см. комментарий в шапке Board.tsx) — состояние панели (state.groups) ей не
  // передаём: там уже отфильтрованная под очередь панели группировка (queueGroups, без
  // Cancelled/DEEP-DONE, без пустых колонок), а доске нужны все семь стадий (boardColumns).
  if (route.view === 'board') {
    return (
      <Board
        t={t}
        listRequirements={listRequirements}
        onOpenDetail={(id) => { setRoute({ view: 'detail', id, back: { view: 'board' } }) }}
        onBack={() => { setRoute({ view: 'list' }) }}
      />
    )
  }

  return (
    <aside className={css.panel} aria-label={t('panelTitle')}>
      <div className={css.header}>
        <h2>{t('panelTitle')}</h2>
        {badgeCount !== undefined && <span className={css.badge}>{badgeCount}</span>}
        <button
          type="button"
          className={css.iconButton}
          aria-label={t('refresh')}
          onClick={() => {
            // Цепочка сама открывает чат и не отправляет ничего (см. openSyncChat в
            // src/client/index.tsx) — здесь только решаем, закрывать ли панель. Закрываем
            // единственно по успеху: если цепочка не собралась (служба недоступна, нет
            // рабочего пространства, sessions.scope вернул undefined), панель остаётся
            // открытой, а не молча исчезает без результата.
            void openSyncChat().then(
              () => { actions.close() },
              (error: unknown) => { console.error('[poh-bft-plugin] sync chat:', error) },
            )
          }}
        >
          <IconRefreshOutline16 size={16} />
        </button>
        <button type="button" className={css.iconButton} aria-label={t('close')} onClick={() => { actions.close() }}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      {state.phase === 'ready' && (
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder={t('searchPlaceholder')}
          clearLabel={t('searchClear')}
        />
      )}
      <div className={css.body}>
        {state.phase === 'loading' && <LoadingSkeleton label={t('loading')} />}
        {state.phase === 'error' && <ErrorState message={state.message} retryLabel={t('retry')} onRetry={load} />}
        {state.phase === 'empty' && <EmptyState title={t('empty')} hint={t('emptyHint')} />}
        {state.phase === 'ready' && noSearchResults && (
          <SearchEmptyState title={t('searchEmpty')} resetLabel={t('searchReset')} onReset={() => { setQuery('') }} />
        )}
        {state.phase === 'ready' && !noSearchResults && (
          <GroupList
            groups={filteredGroups}
            collapsed={collapsed}
            onToggle={toggleGroup}
            onSelect={(id) => { setRoute({ view: 'preview', id }) }}
          />
        )}
      </div>
      {/* Кнопка «Статус проработки» (Task 4) — футер панели, вне скроллящегося .body, всегда
          виден внизу независимо от состояния списка (загрузка/пусто/ошибка/готово): доска
          открывается своим независимым запросом (Board.tsx), ей не важно, что успел или не
          успел загрузить список панели. */}
      <div className={css.panelFooter}>
        <Button variant="outline" className={css.fullWidth} onClick={() => { setRoute({ view: 'board' }) }}>
          {t('boardOpen')}
        </Button>
      </div>
    </aside>
  )
}

function SearchField({ value, onChange, placeholder, clearLabel }: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  clearLabel: string
}) {
  return (
    <div className={css.searchRow}>
      <span className={css.searchIcon} aria-hidden="true"><IconSearchOutline16 size={14} /></span>
      <input
        type="text"
        className={css.searchInput}
        placeholder={placeholder}
        value={value}
        onChange={(event) => { onChange(event.target.value) }}
      />
      {value.length > 0 && (
        <button type="button" className={css.searchClear} aria-label={clearLabel} onClick={() => { onChange('') }}>
          <IconCloseOutline16 size={14} />
        </button>
      )}
    </div>
  )
}

function GroupList({ groups, collapsed, onToggle, onSelect }: {
  groups: BftGroup[]
  collapsed: ReadonlySet<BftStage>
  onToggle: (stage: BftStage) => void
  /** Клик по строке требования — переключает панель в режим превью (Task 2, см. Preview.tsx). */
  onSelect: (id: string) => void
}) {
  return (
    <>
      {groups.map((group) => {
        const isCollapsed = collapsed.has(group.stage)
        const tone = { '--tone': STAGE_TONE[group.stage] } as CSSProperties
        return (
          <section key={group.stage} className={css.group} data-collapsed={isCollapsed}>
            <button
              type="button"
              className={css.groupHeader}
              aria-expanded={!isCollapsed}
              onClick={() => { onToggle(group.stage) }}
            >
              <span className={css.groupDot} style={tone} aria-hidden="true" />
              <span className={css.groupLabel}>{group.stage}</span>
              <span className={css.badge}>{group.tasks.length}</span>
              <span className={css.chevron} aria-hidden="true">▾</span>
            </button>
            <div className={css.groupBody}>
              {group.tasks.map(task => (
                <button
                  key={task.id}
                  type="button"
                  className={css.item}
                  style={tone}
                  onClick={() => { onSelect(task.id) }}
                >
                  <div className={css.itemBody}>
                    {task.title}
                    <span className={css.itemId}>{task.id}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} style={{ display: 'contents' }}>
      {[0, 1, 2].map(key => (
        <div key={key} className={css.skeletonGroup}>
          <span className={`${css.skeletonBar} ${css.skeletonHead}`} />
          <span className={`${css.skeletonBar} ${css.skeletonLine}`} />
          <span className={`${css.skeletonBar} ${css.skeletonLine}`} />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className={css.stateBlock}>
      <span className={css.stateIcon} aria-hidden="true"><IconArchiveOutline20 size={20} /></span>
      <h3 className={css.stateTitle}>{title}</h3>
      <p className={css.stateHint}>{hint}</p>
    </div>
  )
}

function ErrorState({ message, retryLabel, onRetry }: { message: string; retryLabel: string; onRetry: () => void }) {
  return (
    <div className={css.stateBlock}>
      <span className={css.stateIcon} data-tone="error" aria-hidden="true"><IconWarningOutline16 size={20} /></span>
      <p className={css.stateMessage}>{message}</p>
      <Button variant="outline" onClick={() => { onRetry() }}>{retryLabel}</Button>
    </div>
  )
}

function SearchEmptyState({ title, resetLabel, onReset }: { title: string; resetLabel: string; onReset: () => void }) {
  return (
    <div className={css.stateBlock}>
      <span className={css.stateIcon} aria-hidden="true"><IconArchiveOutline20 size={20} /></span>
      <h3 className={css.stateTitle}>{title}</h3>
      <Button variant="outline" onClick={onReset}>{resetLabel}</Button>
    </div>
  )
}
