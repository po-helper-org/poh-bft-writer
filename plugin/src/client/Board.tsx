/**
 * Доска по стадиям (Task 4 плана «Панель целиком и превью»): полноэкранная страница поверх
 * приложения, тот же приём, что и детальная страница (Task 3, DetailPage.tsx) — `position:
 * fixed; inset: 0` (класс `.${css.detailPage}`, переиспользован как есть), не второй слой
 * оверлеев `shell.overlay`, а ветка того же уже смонтированного slot-компонента
 * `RequirementsPanel` (см. `route.view === 'board'` в Panel.tsx).
 *
 * Список — свой запрос по каналу `/bft` (подкоманда `list`, тот же `listRequirements`, которым
 * грузится список панели, см. index.tsx), не переиспользует React-состояние панели: тело панели
 * хранит `queueGroups()` — хронологию очереди без Cancelled/DEEP-DONE и без пустых колонок, а
 * доске нужны все семь стадий из `boardColumns()` (src/queue.ts), включая пустые — разная
 * группировка одного и того же плоского списка. Общий у них только кэш localStorage
 * (task-cache.ts): что panel, что доска читают его при монтировании (мгновенный первый рендер,
 * если кто-то из них уже грузил список в этой сессии браузера) и перезаписывают при каждой
 * успешной загрузке. Тот же приём, каким уже пользуются Preview.tsx и DetailPage.tsx для
 * собственной загрузки: `useState` + `useEffect` + `AbortController`, три состояния
 * loading/ready/error — отдельного «пусто» не заводим, доска и так показывает семь колонок с
 * нулевыми счётчиками, когда задач нет.
 *
 * Карточка несёт только `BftTaskSummary` (id/title/stage/priority) — этого достаточно для
 * названия и идентификатора, полную задачу доска не грузит. Клик переключает панель на
 * детальную страницу (Task 3): у неё нет объекта задачи, только id карточки, но DetailPage
 * сама догружает задачу по id независимо от источника открытия (см. комментарий в шапке
 * DetailPage.tsx) — доске не нужно ничего готовить заранее.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
// Реальные компонент кнопки и иконки харнесса (Task 4 визуального выравнивания) вместо
// hand-drawn inline SVG и локальных .btn/.btnOutline — см. Panel.tsx.
import { Button, IconChevronLeftOutline14, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { RpcResult } from '../channel.js'
import { boardColumns, type BftGroup } from '../queue.js'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'
import { STAGE_TONE } from './stage-tone.js'
import { readTaskCache, toTaskSummaries, writeTaskCache } from './task-cache.js'

export interface BoardProps {
  t: (key: BftLocaleKey) => string
  /** Канал `/bft`, подкоманда `list` — тот же вызов, что грузит список панели (см. index.tsx). */
  listRequirements(signal: AbortSignal): Promise<RpcResult<unknown>>
  /** Открывает детальную страницу требования (Task 3) — переключает режим панели, живёт в Panel.tsx. */
  onOpenDetail(id: string): void
  /** Стрелка «← Назад»: возвращает панель к списку. */
  onBack(): void
}

type BoardState =
  | { phase: 'loading' }
  | { phase: 'ready'; groups: BftGroup[] }
  | { phase: 'error'; message: string }

export function Board({ t, listRequirements, onOpenDetail, onBack }: BoardProps) {
  // Тот же кэш localStorage, что Panel.tsx (task-cache.ts) — общий плоский список, доска
  // строит из него boardColumns() вместо queueGroups(). Доска — отдельная ветка рендера
  // Panel.tsx, монтируется заново при каждом открытии (в отличие от самой панели), поэтому
  // кэш читается тут при каждом монтировании, а не только один раз на загрузку страницы.
  const [state, setState] = useState<BoardState>(() => {
    const cached = readTaskCache()
    return cached === undefined ? { phase: 'loading' } : { phase: 'ready', groups: boardColumns(cached) }
  })
  const controllerRef = useRef<AbortController | null>(null)

  // silent — тот же приём, что в Panel.tsx: не сбрасывает экран в 'loading', ошибка фонового
  // обновления не перекрывает уже показанный кэш, только логируется.
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
          if (silent) { console.error('[poh-bft-plugin] фоновое обновление доски:', result.error.message); return }
          setState({ phase: 'error', message: result.error.message })
          return
        }
        const tasks = toTaskSummaries(result.value)
        writeTaskCache(tasks)
        setState({ phase: 'ready', groups: boardColumns(tasks) })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : String(error)
        if (silent) { console.error('[poh-bft-plugin] фоновое обновление доски:', message); return }
        setState({ phase: 'error', message })
      })
  }, [listRequirements])

  // Загрузка запускается один раз при монтировании (доска — отдельная ветка рендера Panel.tsx,
  // монтируется заново при каждом открытии) и обрывается при размонтировании — тот же приём,
  // что useEffect загрузки задачи в DetailPage.tsx. Повторное открытие доски создаёт новый
  // компонент (React размонтирует старый при переключении ветки route.view), поэтому старый
  // AbortController не может пережить новое открытие и погнаться за него результатом. `state`
  // читается без зависимости намеренно (тот же приём, что в Panel.tsx) — эффект запускается
  // единственный раз за монтирование и должен увидеть значение из ленивого инициализатора выше,
  // а не реагировать на дальнейшие изменения state.
  useEffect(() => {
    load({ silent: state.phase === 'ready' })
    return () => { controllerRef.current?.abort() }
  }, [load])

  return (
    <div className={css.detailPage}>
      <div className={css.header}>
        <button type="button" className={css.iconButton} aria-label={t('detailBack')} onClick={onBack}>
          <IconChevronLeftOutline14 size={14} />
        </button>
        <h2>{t('boardHeaderTitle')}</h2>
      </div>

      {state.phase !== 'ready' && (
        <div className={css.body}>
          {state.phase === 'loading' && (
            <div className={css.stateBlock} aria-busy="true">
              <p className={css.stateMessage}>{t('loading')}</p>
            </div>
          )}
          {state.phase === 'error' && (
            <div className={css.stateBlock}>
              <span className={css.stateIcon} data-tone="error" aria-hidden="true"><IconWarningOutline16 size={20} /></span>
              <p className={css.stateMessage}>{state.message}</p>
              <Button variant="outline" onClick={() => { load() }}>{t('retry')}</Button>
            </div>
          )}
        </div>
      )}

      {state.phase === 'ready' && (
        <div className={css.boardRow}>
          {state.groups.map(group => (
            <BoardColumn key={group.stage} group={group} onSelect={onOpenDetail} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Одна колонка стадии: заголовок (та же геометрия точки/подписи/счётчика, что и `.groupHeader`
 * списка панели — `.groupDot`/`.groupLabel`/`.badge` переиспользованы как есть) прилипает
 * сверху естественным образом — он вне скроллящегося тела колонки (`flex: none` над `flex: 1;
 * overflow-y: auto`), а не через `position: sticky`. Карточки — существующие `.item`/
 * `.itemBody`/`.itemId` списка панели (название + id, цветная полоса стадии слева через
 * `--tone`) — тот же приём, что `GroupList` в Panel.tsx, отдельного класса карточки не заводим.
 */
function BoardColumn({ group, onSelect }: { group: BftGroup; onSelect: (id: string) => void }) {
  const tone = { '--tone': STAGE_TONE[group.stage] } as CSSProperties
  return (
    <section className={css.boardColumn}>
      <div className={css.boardColumnHeader}>
        <span className={css.groupDot} style={tone} aria-hidden="true" />
        <span className={css.groupLabel}>{group.stage}</span>
        <span className={css.badge}>{group.tasks.length}</span>
      </div>
      <div className={css.boardColumnBody}>
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
}
