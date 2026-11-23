/**
 * customer-form · браузерная половина (rev4: ничего своего).
 *
 * Решение владельца: форма заказчика — это ГЛАВНАЯ страница dsh как есть;
 * единственное изменение — скрытый сайдбар. Никаких своих компонентов,
 * оверлеев и дизайн-систем: канон харнесса. Плюс одно действие при старте —
 * чаты заказчика живут в workspace «Customer-requests» (создаём/подключаем,
 * как это делает poh-bft-plugin для своих чатов).
 */
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { IWorkspaces, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import { StreamingMic } from './mic.js'
import { PortalSettings } from './settings.js'
import { RecentRequests, rememberSession, type MyRequests } from './recent.js'
import {
  ACCEPTANCE_PREFIX, ACCEPTANCE_TAB, AcceptanceTab, AcceptanceTitle, BFT_PREFIX, BFT_TAB, BftTab, BftTitle, BftWatcher, bftWatch, bumpBft,
  bridges, InfoView, InputBridge, lastSessionId, sessionOfAddress, sessionOfBftAddress,
  type SessionInfo,
} from './panels.js'
import { portalHref } from './url.js'
import { NOTE_CSS, PORTAL_NOTE_RULE, PortalNoteMark } from './note.js'
import { INFO_KIND, INFO_TAB, InfoGlyph, InfoTitle, REQUESTS_KIND, REQUESTS_TAB, RequestsGlyph, RequestsGuideEntry, RequestsTab, RequestsTitle } from './guide.js'

/** Вход и статус администратора портала (узел customer-form, admin.ts). */
const ADMIN_PAGE = '/api/customer-form.admin'
const ADMIN_STATUS = '/api/customer-form.adminStatus'

// Имена СЛУЖБ cordis, не пакетов (грабля «pending» — см. ADR-0007 rev3).
export const inject = ['slots', 'connection', 'uiWorkspace', 'workspaces', 'sessions', 'locale']

/**
 * Классы ui-layout 0.1.7-rc.2 (как в poh-mobile-skin; хэши — с мажорами ядра).
 * Сайдбар выпадает из грида, поэтому центр растягиваем на его колонку, а правую
 * панель держим в своей: инлайн-ширины колонок dsh продолжает менять сам.
 */
const HIDE_SIDEBAR_CSS = `
/* Портал заказчика: сайдбар скрыт — остаётся чистый стартовый экран dsh. */
.pI_x6G_sidebarCol, .pI_x6G_handle { display: none !important; }
/* Кнопка «Открыть боковую панель» центра лежит под «Меню» портала (bft-manager), а сайдбара у заказчика нет. */
.pI_x6G_leadingSeat button[aria-label="Открыть боковую панель"], .pI_x6G_leadingSeat button[aria-label="Open sidebar"] { display: none !important; }
.pI_x6G_centerCol { grid-column: 1 / 3 !important; }
.pI_x6G_rightbarCol { grid-column: 3 !important; }
/* Правая панель «Старт»: без терминала (плагины выключены в профиле — здесь на случай
   оверлея) и без меню «Дополнительные инструменты» — у заказчика только свои карточки. */
[data-sidebar-right-guide] > :has([data-sidebar-right-guide-entry="terminal"]) { display: none !important; }
[data-sidebar-right-guide] > :not(:has([data-sidebar-right-guide-entry])):has(button[aria-haspopup="menu"]),
[data-sidebar-right-guide] > button[aria-haspopup="menu"] { display: none !important; }
`

/**
 * Русский языковой пакет экрана заказчика — штатный механизм dsh-client-locale
 * (addLanguage + register), не свой UI. Язык по умолчанию выбирает профиль
 * (locale.preference: ru-RU); всё, чего здесь нет, берётся из штатного ru ядра.
 * Заголовок героя — инструкция HowToDemo п.2 «Введите свои мысли».
 */
const RU_CONVERSATION: Record<string, string> = {
  'hero.headline': 'Введите свои мысли',
  'hero.preview': 'Портал заказчика',
  'hero.chooseWorkspace': 'Раздел заявок',
  'placeholder.hero': 'Опишите инициативу своими словами: что нужно, как сейчас, что мешает. Прикрепите файлы и ссылки',
  'placeholder.default': 'Ответьте или дополните заявку',
  'placeholder.workspace': 'Готовим раздел заявок…',
  'placeholder.unavailable': 'Чат недоступен',
  'input.commands': 'Прикрепить файлы',
  'input.file': 'Файл',
  'input.stop': 'Остановить ответ',
  'input.send': 'Отправить',
  'input.send.queue': 'Отправить следом',
  'input.send.steer': 'Уточнить сейчас',
  'attachment.pending': 'Вложения',
  'attachment.dropTitle': 'Перетащите сюда файлы или изображения',
  'attachment.dropDesc': 'Изображений — до {count}, по {size} каждое',
  'attachment.dropBlocked': 'Сейчас добавить файлы нельзя',
  'attachment.directoryDesktopOnly': 'Папки целиком в браузере не добавить — прикрепите файлы по одному',
}

/** Форма уточняющих вопросов (ask_user_question) — HowToDemo п.8. */
const RU_QUESTION: Record<string, string> = {
  'error.incomplete': 'Сначала ответьте на этот вопрос.',
  'error.unanswered': 'Выберите вариант или впишите свой ответ.',
  'nav.prev': 'Предыдущий вопрос',
  'nav.next': 'Следующий вопрос',
  'nav.minimize': 'Свернуть вопросы',
  'nav.maximize': 'Развернуть вопросы',
  'nav.cancel': 'Закрыть вопросы',
  'option.recommended': 'Рекомендуем',
  'custom.placeholder': 'Свой ответ',
  'action.skip': 'Пропустить',
  'action.next': 'Дальше',
  // Карточка согласования сценария приёмки (confirm_acceptance_demo, intent plan-review).
  'plan.header': 'Как я буду принимать работу',
  'plan.approve': 'Согласую',
  'plan.discuss': 'Нужны правки',
  'plan.decline': 'Отклонить',
}

/** Раскадровка сценария приёмки в правой панели (ui-plan открывает её сам). */
const RU_PLAN: Record<string, string> = {
  'preview.title': 'Сценарий приёмки',
  'preview.document': 'Сценарий приёмки · раскадровка',
  'preview.action': 'Открыть',
  'preview.open': 'Открыть сценарий в панели',
  'preview.full': 'Раскадровка',
  'preview.openNamed': 'Открыть: {title}',
  'preview.loading': 'Загружаем сценарий…',
  'preview.failed': 'Не удалось открыть сценарий',
  'preview.invalidAddress': 'Неверный адрес сценария',
  'preview.historyUnavailable': 'История диалога недоступна',
  'preview.notFound': 'Сценарий не найден',
  'preview.unavailable': 'Раскадровка недоступна',
  'preview.expired': 'Раскадровка устарела. Откройте её снова из карточки согласования.',
}

/** Статусы хода в ленте, которые видит заказчик. */
const RU_CHAT: Record<string, string> = {
  'message.stepProcess.questions': 'Ждём ваших ответов',
  'message.stepProcess.done.questions': 'Вопросы заданы',
  'message.turnProcess.worked': 'Готово',
  // Ядро 0.2: «took» — префикс, длительность дописывает само (не шаблон {duration}).
  'message.turnProcess.took': 'Заняло ',
  'message.turnProcess.failed': 'Не получилось',
  'chat.deepDiving': 'Изучаю…',
  'message.turnError': 'Ассистент не ответил',
  'row.failed': 'Ошибка',
}

const RU_COMMON: Record<string, string> = {
  submit: 'Отправить',
  submitting: 'Отправляем…',
}

interface HostRpcLike {
  rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; value?: { path?: string } }> }
}

interface SlotsLike {
  inject(name: string, register: () => () => void): void
  register(options: Record<string, unknown>, component: ComponentType<never>): () => void
}

interface UiConversationLike {
  userText: { register(rule: typeof PORTAL_NOTE_RULE): () => void }
}

interface SidebarRightTabsLike {
  register(definition: {
    id: string; kind: string; patterns?: string[]; priority: string; canOpen?: (address: string) => boolean; title: () => string
    /** Карточки панели «Старт»; тип без patterns — страница, открывается по kind. */
    guide?: { id: string; order: number; title: () => string; description?: () => string; icon?: ComponentType<{ size?: number; className?: string }> }[]
  }): () => void
}

/** Язык портала: штатный русский ядра + тексты экрана заказчика поверх. */
const PORTAL_LOCALE = 'ru-RU'

interface LocaleLike {
  addLanguage(language: { id: string; label: string; fallback: string }): () => void
  register(namespace: string, locale: string, dictionary: Record<string, string>): () => void
}

export function apply(ctx: ClientContext): void {
  // 1) Скрыть сайдбар: один <style>, никаких перемещений DOM (урок poh-mobile-skin).
  const style = document.createElement('style')
  style.setAttribute('data-plugin', 'customer-form')
  style.textContent = HIDE_SIDEBAR_CSS
  document.head.appendChild(style)
  ctx.effect(() => () => style.remove(), 'customer-form: стили портала')
  // Служебные «📌 …» портала — не пузырь заказчика (note.tsx); стиль и у администратора.
  const noteStyle = document.createElement('style')
  noteStyle.setAttribute('data-plugin', 'customer-form-notes')
  noteStyle.textContent = NOTE_CSS
  document.head.appendChild(noteStyle)
  ctx.effect(() => () => noteStyle.remove(), 'customer-form: строки портала в чате')

  // 1а) Администратор портала (ADR-0012): ему — интерфейс dsh целиком, со
  //     штатными «Настройками» (ключи, плагины). Заказчику сайдбар скрыт, а
  //     горячая клавиша настроек (⌥⌘, / Ctrl+Alt+,) не срабатывает; запись
  //     настроек без входа узел всё равно отклонит.
  const blockSettingsKey = (event: KeyboardEvent) => {
    if (event.code === 'Comma' && event.altKey && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
  }
  window.addEventListener('keydown', blockSettingsKey, true)
  ctx.effect(() => () => window.removeEventListener('keydown', blockSettingsKey, true), 'customer-form: клавиша настроек')
  void fetch(portalHref(ADMIN_STATUS), { credentials: 'same-origin', cache: 'no-store' })
    .then((res) => (res.ok ? res.json() as Promise<{ admin?: boolean }> : undefined))
    .then((status) => {
      if (!status?.admin) return
      window.removeEventListener('keydown', blockSettingsKey, true)
      style.textContent = ''
      document.documentElement.dataset.portalRole = 'admin'
      const badge = document.createElement('a')
      badge.href = portalHref(ADMIN_PAGE)
      badge.textContent = 'Администратор'
      badge.setAttribute('data-portal-admin', '')
      badge.title = 'Вы вошли администратором портала — выйти или открыть страницу входа'
      badge.style.cssText = 'position:fixed;z-index:50;display:none;font:11px/1 system-ui,sans-serif;padding:4px 8px;border-radius:999px;border:1px solid currentColor;opacity:.6;color:inherit;text-decoration:none'
      document.body.appendChild(badge)
      // Значок — в правой части строки «Ещё» внизу сайдбара: в правом нижнем углу
      // он перекрывал кнопки «Дальше» и «Замечания». Сайдбар скрыт — значка нет.
      let frame = 0
      const place = () => {
        frame = 0
        const anchor = document.querySelector('button[aria-label="Меню аккаунта"]')?.getBoundingClientRect()
        if (!anchor || anchor.right <= 0 || anchor.width === 0) { badge.style.display = 'none'; return }
        badge.style.display = 'block'
        badge.style.left = `${anchor.right - badge.offsetWidth - 8}px`
        badge.style.top = `${anchor.top + (anchor.height - badge.offsetHeight) / 2}px`
      }
      const schedule = () => { frame ||= requestAnimationFrame(place) }
      // Свои же правки стиля значка не считаем — иначе цикл на каждый кадр.
      const observer = new MutationObserver((records) => { if (records.some((record) => record.target !== badge)) schedule() })
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-collapsed'] })
      window.addEventListener('resize', schedule)
      document.addEventListener('transitionend', schedule, true)
      schedule()
      ctx.effect(() => () => {
        observer.disconnect()
        window.removeEventListener('resize', schedule)
        document.removeEventListener('transitionend', schedule, true)
        if (frame) cancelAnimationFrame(frame)
        badge.remove()
      }, 'customer-form: значок администратора')
      // «Настройки → Портал»: модели чата и полного БФТ (только администратору).
      const rpc = ctx.get('connection') as unknown as HostRpcLike
      const call = (endpoint: string, payload: unknown) => rpc.rpc.call('/api', endpoint, payload)
      const sectionSlots = ctx.get('slots') as SlotsLike
      sectionSlots.inject('settings.section', () => sectionSlots.register(
        { name: 'settings.section', id: 'customer-form-portal', order: 15, label: () => 'Портал', inject: () => ({ call }) },
        PortalSettings as ComponentType<never>,
      ))
    })
    .catch(() => { /* портал без статуса — режим заказчика */ })

  // 2) Русский язык интерфейса (штатный языковой пакет dsh).
  const locale = ctx.get('locale') as LocaleLike
  // Ядро 0.2 само несёт русский (`ru`), а словарь на пару «пространство имён + язык» один:
  // тексты портала — вариантом `ru-RU` с откатом на штатный `ru` (профиль: preference ru-RU).
  ctx.effect(() => locale.addLanguage({ id: PORTAL_LOCALE, label: 'Русский', fallback: 'ru' }), `customer-form: язык ${PORTAL_LOCALE}`)
  const dictionaries = { conversation: RU_CONVERSATION, question: RU_QUESTION, plan: RU_PLAN, chat: RU_CHAT, common: RU_COMMON }
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => locale.register(namespace, PORTAL_LOCALE, dictionary), `customer-form: словарь ${PORTAL_LOCALE}/${namespace}`)
  }

  // 3) RPC к узлу customer-form; сессия, которую открыл портал.
  const host = ctx.get('connection') as unknown as HostRpcLike
  let activeSessionId: string | undefined

  // 4) Сценарий приёмки страницей в правой панели, замечания → строка ввода,
  //    вкладка «Информация» (ADR-0007 rev10).
  const slots = ctx.get('slots') as SlotsLike
  ctx.inject(['sidebarRightTabs'], (scoped) => {
    const tabs = scoped.get('sidebarRightTabs') as SidebarRightTabsLike
    scoped.effect(() => tabs.register({
      id: ACCEPTANCE_TAB,
      kind: 'customer-acceptance',
      patterns: ['dsh-resource://plan-review/**', `${ACCEPTANCE_PREFIX}**`],
      priority: 'extension', // выше builtin ui-plan: карточка согласования открывает нашу страницу
      canOpen: (address) => sessionOfAddress(address) !== undefined,
      title: () => 'Сценарий приёмки',
    }), 'customer-form: вкладка сценария приёмки')
    scoped.effect(() => tabs.register({
      id: BFT_TAB,
      kind: 'customer-bft',
      patterns: [`${BFT_PREFIX}**`],
      priority: 'extension',
      canOpen: (address) => sessionOfBftAddress(address) !== undefined,
      title: () => 'Документ БФТ',
    }), 'customer-form: вкладка документа БФТ')
    // «Старт»: «Информация» (InfoView в панели) и «Смотреть все заявки» (доска портала).
    scoped.effect(() => tabs.register({
      id: INFO_TAB,
      kind: INFO_KIND,
      priority: 'extension',
      title: () => 'Информация',
      guide: [{ id: 'info', order: 30, title: () => 'Информация', description: () => 'Заявка, сценарий приёмки, документы БФТ и материалы', icon: InfoGlyph }],
    }), 'customer-form: вкладка «Информация»')
    scoped.effect(() => tabs.register({
      id: REQUESTS_TAB,
      kind: REQUESTS_KIND,
      priority: 'extension',
      title: () => 'Все заявки',
      guide: [{ id: 'all', order: 40, title: () => 'Смотреть все заявки', description: () => 'Доска всех заявок портала и статус документов', icon: RequestsGlyph }],
    }), 'customer-form: вкладка «Все заявки»')
  })
  slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: BFT_TAB }, BftTab as ComponentType<never>))
  slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: BFT_TAB }, BftTitle as ComponentType<never>))
  slots.inject('conversation.input.right', () => slots.register({ name: 'conversation.input.right', id: 'customer-form-bft-watch' }, BftWatcher as ComponentType<never>))
  slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: ACCEPTANCE_TAB }, AcceptanceTab as ComponentType<never>))
  slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: ACCEPTANCE_TAB }, AcceptanceTitle as ComponentType<never>))
  // «📌 …» портала: правило userText узнаёт ведущий значок, ключевой слот рисует пометку (note.tsx).
  ctx.inject(['uiConversation'], (scoped) => {
    const conversation = scoped.get('uiConversation') as UiConversationLike
    scoped.effect(() => conversation.userText.register(PORTAL_NOTE_RULE), 'customer-form: правило строк портала')
  })
  slots.inject('conversation.user.text.node', () => slots.register({
    name: 'conversation.user.text.node',
    key: PORTAL_NOTE_RULE.id,
    priority: 100,
  }, PortalNoteMark as ComponentType<never>))
  // Мост — в списочном input.right: одиночный input.activity занят микрофоном.
  slots.inject('conversation.input.right', () => slots.register({ name: 'conversation.input.right', id: 'customer-form-bridge' }, InputBridge as ComponentType<never>))
  // Потоковый микрофон вместо штатного голосового ввода (ui-voice-input выключен в профиле, ADR-0008 rev4).
  slots.inject('conversation.input.activity', () => slots.register({ name: 'conversation.input.activity' }, StreamingMic as ComponentType<never>))

  const loadInfo = async (sessionId: string): Promise<SessionInfo | undefined> => {
    const res = await host.rpc.call('/api', 'customer-form.sessionInfo', { sessionId })
    return res.ok ? (res.value as unknown as SessionInfo) : undefined
  }
  const openAcceptance = (sessionId: string) => {
    const right = ctx.get('sidebarRight') as { openResource(address: string): void } | undefined
    right?.openResource(`${ACCEPTANCE_PREFIX}${encodeURIComponent(sessionId)}/${Date.now()}`)
  }
  const openBft = (sessionId: string) => {
    const right = ctx.get('sidebarRight') as { openResource(address: string): void } | undefined
    // Адрес постоянный — открытая вкладка раскрывается, а не дублируется; новую версию даёт bumpBft.
    bumpBft(sessionId)
    right?.openResource(`${BFT_PREFIX}${encodeURIComponent(sessionId)}`)
  }
  bftWatch.loadInfo = loadInfo
  bftWatch.openBft = openBft
  slots.inject('conversation.view', () => slots.register({
    name: 'conversation.view',
    id: 'information',
    order: 20,
    label: () => 'Информация',
    inject: (sessionId: string) => ({ sessionId, loadInfo, openAcceptance, openBft }),
  }, InfoView as ComponentType<never>))
  // Та же «Информация» — страницей правой панели (карточка «Старта»).
  slots.inject('sidebar.right.pane.tab', () => slots.register({
    name: 'sidebar.right.pane.tab',
    key: INFO_TAB,
    inject: (sessionId: string) => ({ sessionId, loadInfo, openAcceptance, openBft }),
  }, InfoView as ComponentType<never>))
  slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: INFO_TAB }, InfoTitle as ComponentType<never>))
  // «Смотреть все заявки»: карточка-ссылка на доску (как под формой) и тело вкладки на случай открытия в панели.
  slots.inject('sidebar.right.tab.guide.entry', () => slots.register({ name: 'sidebar.right.tab.guide.entry', key: REQUESTS_TAB }, RequestsGuideEntry as ComponentType<never>))
  slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: REQUESTS_TAB }, RequestsTab as ComponentType<never>))
  slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: REQUESTS_TAB }, RequestsTitle as ComponentType<never>))

  // «Мои обращения» под формой стартового экрана (rev12): слот hero.agentPreset
  // свободен (ui-agent-preset выключен в профиле) и есть только у пустого чата.
  const uiWorkspaceOf = () => ctx.get('uiWorkspace') as { openSession(id: string): void } | undefined
  const loadRequests = async (sessionIds: string[]): Promise<MyRequests | undefined> => {
    const res = await host.rpc.call('/api', 'customer-form.myRequests', { sessionIds })
    return res.ok ? (res.value as unknown as MyRequests) : undefined
  }
  const openSession = (sessionId: string) => uiWorkspaceOf()?.openSession(sessionId)
  slots.inject('conversation.hero.agentPreset', () => slots.register({
    name: 'conversation.hero.agentPreset',
    inject: () => ({ loadRequests, openSession }),
  }, RecentRequests as ComponentType<never>))

  // Замечание со страницы сценария (iframe того же origin) → строка ввода.
  const onRemark = (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: string; text?: string } | undefined
    if (event.origin !== location.origin || data?.type !== 'customer-form/remark' || typeof data.text !== 'string') return
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe[data-customer-acceptance]")).find((f) => f.contentWindow === event.source)
    const sessionId = frame?.dataset.customerAcceptance ?? lastSessionId
    const actions = (sessionId && bridges.get(sessionId)) || (lastSessionId ? bridges.get(lastSessionId) : undefined)
    let ok = false
    try { ok = !!actions && actions.insertText(data.text, actions.captureInsertion()) } catch { ok = false }
    ;(event.source as Window | null)?.postMessage({ type: 'customer-form/remark-ack', id: data.id, ok }, location.origin)
  }
  window.addEventListener('message', onRemark)
  ctx.effect(() => () => window.removeEventListener('message', onRemark), 'customer-form: замечания со страницы сценария')

  // Страница документа БФТ (rev15): «Отправить замечания в чат» и «Согласовать»
  // сразу отправляют сообщение в чат своей сессии — как будто заказчик написал сам.
  // «Добавить требования» (rev16): начало фразы в поле ввода и запись голосом — без отправки.
  const COMPOSER = '[data-composer-input][contenteditable="true"]'
  /** Поле ввода на месте: карточка вопроса (confirm_bft_fast) его на время заменяет. */
  const composerBack = async (): Promise<void> => {
    for (let i = 0; i < 40 && !document.querySelector(COMPOSER); i++) await new Promise((resolve) => setTimeout(resolve, 100))
    // Мост поля ввода (InputBridge) переподключается эффектом после монтирования.
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const onSay = (event: MessageEvent) => {
    const data = event.data as { type?: string; id?: string; text?: string } | undefined
    const compose = data?.type === 'customer-form/compose'
    if (event.origin !== location.origin || (data?.type !== 'customer-form/say' && !compose) || typeof data?.text !== 'string') return
    const text = data.text
    const source = event.source as Window | null
    const frame = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[data-customer-bft]')).find((f) => f.contentWindow === event.source)
    const sessionId = frame?.dataset.customerBft ?? lastSessionId
    void (async () => {
      let ok = false
      try {
        // Вопрос «Документ верный?» в чате ждёт ответа — снять его: заказчик отвечает со страницы.
        // (После «Да, согласен» узел уже снял его сам: здесь — ничего.)
        if (sessionId) {
          const res = await host.rpc.call('/api', 'customer-form.fastAskRelease', { sessionId }).catch(() => undefined)
          if (res?.ok && (res.value as unknown as { released?: boolean } | undefined)?.released) await composerBack()
          else if (!document.querySelector(COMPOSER)) await composerBack()
        }
        const actions = sessionId ? bridges.get(sessionId) : undefined
        if (actions && compose) {
          actions.setDraft(text)
          ;(document.querySelector(COMPOSER) as HTMLElement | null)?.focus()
          // Микрофон портала (StreamingMic): заказчик сразу говорит, что и где добавить.
          ;(document.querySelector('[data-streaming-mic] button[aria-label="Начать запись"]') as HTMLButtonElement | null)?.click()
          ok = true
        } else if (actions) { actions.setDraft(text); actions.submit(); ok = true }
      } catch { ok = false }
      source?.postMessage({ type: 'customer-form/say-ack', id: data.id, ok }, location.origin)
    })()
  }
  window.addEventListener('message', onSay)
  ctx.effect(() => () => window.removeEventListener('message', onSay), 'customer-form: сообщения со страницы документа БФТ')

  // Ссылка на документ в ответе ассистента открывает его в правой панели, а не новой вкладкой.
  const onDocLink = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.('a[href*="/api/customer-form.bftFast?session="]') as HTMLAnchorElement | null
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return
    const sessionId = new URL(link.href).searchParams.get('session')
    if (!sessionId) return
    event.preventDefault()
    event.stopPropagation()
    openBft(sessionId)
  }
  document.addEventListener('click', onDocLink, true)
  ctx.effect(() => () => document.removeEventListener('click', onDocLink, true), 'customer-form: ссылка на документ БФТ — в правую панель')

  // 5) Чаты заказчика — в workspace «Customer-requests»: создаём по имени
  //    (идемпотентно, как workspaces.create({path}) у poh-bft-plugin) и
  //    открываем в нём новый чат.
  void (async () => {
    try {
      const workspaces = ctx.get('workspaces') as IWorkspaces | undefined
      const uiWorkspace = ctx.get('uiWorkspace') as { openSession(id: string): void } | undefined
      const sessions = ctx.get('sessions') as { create(options: { workspaceId: WorkspaceId }): Promise<string> } | undefined
      if (!workspaces || !uiWorkspace || !sessions) return
      // create({path}) идемпотентен по пути (поведение из poh-bft-plugin).
      // Абсолютный путь знает только узел (DSH_HOME) — спрашиваем эндпоинтом.
      const res = await host.rpc.call('/api', 'customer-form.workspacePath', {})
      const path = res.ok ? res.value?.path : undefined
      if (!path) throw new Error('узел не отдал путь workspace')
      const workspace = await workspaces.create({ path })
      // Ссылка на чат заявки (?session=<id>, Инбокс PO, ADR-0020) — открываем этот чат, нового не заводим.
      const linked = new URLSearchParams(location.search).get('session')
      if (linked && /^[\w-]{6,80}$/.test(linked)) {
        activeSessionId = linked
        rememberSession(linked)
        uiWorkspace.openSession(linked)
        return
      }
      // Каждый вход — СВОЯ новая сессия. Штатные пути dsh web однопользовательские:
      // восстановление и openWorkspace переиспользуют пустую сессию, и два
      // заказчика, открывших портал одновременно, писали бы в один чат.
      // На чистом томе список workspace догоняет create не сразу — ждём.
      for (let attempt = 0; ; attempt++) {
        try {
          activeSessionId = await sessions.create({ workspaceId: workspace.workspaceId })
          rememberSession(activeSessionId) // «мои обращения» — сессии этого браузера
          uiWorkspace.openSession(activeSessionId)
          break
        } catch (e) {
          if (attempt >= 20) throw e
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
    } catch (e) {
      console.error('[customer-form] workspace не подключился, чаты пойдут в текущий:', e)
    }
  })()
}
