/**
 * Форма сбора инициативы внутри панели раздела: тот же корень `.bft-panel`, что у списка и
 * превью, только тело — айфрейм с чужой страницей (адрес берётся из настроек, ключ `formUrl`).
 *
 * Это маршрут панели, а не «второй сайдбар»: слот `sidebar` занимает одна запись, и вторую
 * панель рядом поставить некуда — см. PanelRoute в Panel.tsx. Снаружи разницы нет: список
 * ушёл, форма пришла.
 *
 * Чего эта страница НЕ делает и делать не может: узнать, что форму отправили. Страница чужая,
 * своего экрана «Ответ записан» у неё не спросишь, событий она не шлёт. Поэтому финал сценария —
 * кнопка «Готово», которую жмёт PO: она возвращает к списку и запускает обновление. Обещать,
 * что данные уже в списке, нельзя — между формой и списком стоят таблица и разбор агентом.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Button, IconChevronLeftOutline14, IconCloseOutline16, IconWarningOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'

/**
 * Сколько ждать события загрузки, прежде чем показать плашку.
 *
 * Ловит ровно один случай: `load` не пришёл вовсе — адрес не отвечает, сеть висит. Отказ во
 * встраивании этим таймером НЕ ловится (см. onLoad ниже).
 */
const LOAD_TIMEOUT_MS = 4000

export interface FormPageProps {
  /** Адрес формы из настроек; страница рисуется только когда он непустой. */
  url: string
  /**
   * Где страница стоит: в панели (вход с «+» списка) или на полноэкранной странице (вход с
   * «Добавить» доски). Разметка одна, различается только подвал: в панели две кнопки делят
   * ширину, на странице стоят естественной ширины у правого края.
   */
  layout: 'panel' | 'page'
  t: (key: BftLocaleKey) => string
  /** Назад к списку без обновления — PO передумал заводить инициативу. */
  onBack: () => void
  /** Закрыть раздел целиком. */
  onClose: () => void
  /** «Готово»: назад к списку и обновление списка. */
  onDone: () => void
}

export function FormPage({ url, layout, t, onBack, onClose, onDone }: FormPageProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  /** Идентификатор ожидания: гасится в обработчике `load`, поэтому живёт в ref, а не в эффекте. */
  const timerRef = useRef<number | undefined>(undefined)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    setBlocked(false)
    timerRef.current = window.setTimeout(() => { setBlocked(true) }, LOAD_TIMEOUT_MS)
    return () => { window.clearTimeout(timerRef.current) }
  }, [url])

  /**
   * Разбирает, что осталось во фрейме после загрузки.
   *
   * ЧЕСТНАЯ ГРАНИЦА: надёжно отличить отказ во встраивании от успеха браузер не даёт.
   * `onerror` у айфрейма не срабатывает, а `onload` приходит в обоих случаях. Проверено на
   * живом харнессе: страница с `frame-ancestors 'none'` (github.com) остаётся для родителя
   * кросс-доменной — чтение её `location` бросает ровно так же, как у успешно загруженной
   * формы, и в записях resource timing обе выглядят одинаково. Поэтому единственный ответ,
   * который здесь может быть верным всегда, — «не знаю»; на этот случай в подвале постоянно
   * стоит «Открыть в браузере», а не всплывающая по догадке подсказка.
   *
   * Проверка ниже ловит второй, более старый вариант отказа — когда во фрейме остаётся
   * `about:blank` (он того же источника и читается без ошибки). Срабатывает не везде, но
   * ложных срабатываний не даёт: исключение при чтении означает, что страница пришла.
   */
  const onLoad = () => {
    // Ожидание закончилось: дальше судим по тому, что во фрейме, а не по часам. Без этого
    // таймер добивал бы уже загруженную форму плашкой через четыре секунды.
    window.clearTimeout(timerRef.current)
    let href: string | undefined
    try {
      href = frameRef.current?.contentWindow?.location.href
    } catch {
      setBlocked(false)
      return
    }
    setBlocked(href === undefined || href === 'about:blank')
  }

  // noopener/noreferrer обязательны: открываемая страница не должна получить ссылку на окно
  // харнесса через window.opener.
  const openExternally = () => { window.open(url, '_blank', 'noopener,noreferrer') }
  const grow = layout === 'panel' ? css.flexGrow : undefined

  return (
    <>
      <div className={css.header}>
        {/* С доски «назад» ведёт на доску, а не к списку — подпись не должна врать. */}
        <button
          type="button"
          className={css.iconButton}
          aria-label={t(layout === 'page' ? 'detailBack' : 'formBack')}
          onClick={onBack}
        >
          <IconChevronLeftOutline14 size={14} />
        </button>
        <h2>{t('formHeaderTitle')}</h2>
        <button type="button" className={css.iconButton} aria-label={t('close')} onClick={onClose}>
          <IconCloseOutline16 size={14} />
        </button>
      </div>
      <div className={css.formFrameWrap}>
        <iframe
          /* Ключом по адресу: смена адреса в настройках должна перезагрузить форму, а не
             оставить открытой прошлую. */
          key={url}
          ref={frameRef}
          className={css.formFrame}
          src={url}
          title={t('formFrameTitle')}
          /* allow-top-navigation не даём намеренно: чужая страница не должна уводить харнесс
             с текущего адреса. Остальное форме нужно по делу — отправка, скрипты, свои cookie
             (без allow-same-origin вход в корпоративную форму не переживёт редиректа) и
             всплывающее окно авторизации. */
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
          referrerPolicy="no-referrer"
          onLoad={onLoad}
        />
        {blocked && (
          /* Поверх айфрейма, а не вместо него: медленная форма догрузится и уберёт плашку сама. */
          <div className={css.formBlocked} role="status">
            <span className={css.stateIcon} data-tone="error" aria-hidden="true"><IconWarningOutline16 size={20} /></span>
            <p className={css.stateTitle}>{t('formBlocked')}</p>
            <p className={css.stateHint}>{t('formBlockedHint')}</p>
          </div>
        )}
      </div>
      {/* «Открыть в браузере» стоит всегда, а не появляется по догадке: отличить отказ во
          встраивании от успеха браузер не даёт (см. onLoad), и белый прямоугольник без выхода
          был бы тупиком. */}
      <div className={layout === 'page' ? `${css.panelFooter} ${css.footerEnd}` : css.panelFooter}>
        <Button variant="outline" className={grow} onClick={openExternally}>
          {t('formOpenExternal')}
        </Button>
        <Button variant="outline" className={grow} onClick={onDone}>{t('formDone')}</Button>
      </div>
    </>
  )
}
