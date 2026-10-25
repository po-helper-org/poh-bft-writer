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
import {
  ACCEPTANCE_PREFIX, ACCEPTANCE_TAB, AcceptanceTab, AcceptanceTitle, bridges, InfoView, InputBridge, lastSessionId, sessionOfAddress,
  type SessionInfo,
} from './panels.js'

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
.pI_x6G_centerCol { grid-column: 1 / 3 !important; }
.pI_x6G_rightbarCol { grid-column: 3 !important; }
`

/**
 * Русский языковой пакет экрана заказчика — штатный механизм dsh-client-locale
 * (addLanguage + register), не свой UI. Язык по умолчанию выбирает профиль
 * (locale.preference: ru); всё, чего здесь нет, берётся из en.
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
  'message.turnProcess.deepDivingFor': 'Изучаю {duration}',
  'message.turnProcess.took': 'Заняло {duration}',
  'message.turnProcess.failed': 'Не получилось',
  'chat.deepDiving': 'Изучаю…',
  'message.turnError': 'Ассистент не ответил',
  'row.failed': 'Ошибка',
}

/** Микрофон композера (голосовой ввод dsh, провайдер ru-speech плагина speech-ru). */
const RU_SPEECH: Record<string, string> = {
  dictate: 'Надиктовать',
  start: 'Начать запись',
  stop: 'Остановить и распознать',
  cancel: 'Отмена',
  insert: 'Вставить текст',
  discard: 'Убрать распознанный текст',
  retryRecording: 'Записать снова',
  loading: 'Подключаем распознавание…',
  reconnecting: 'Подключаем распознавание речи…',
  requesting: 'Разрешите доступ к микрофону…',
  recording: 'Идёт запись…',
  transcribingShort: 'Распознаю…',
  wakingShort: 'Запускаю…',
  interrupted: 'Запись прервалась. Попробуйте ещё раз.',
  provider: 'Распознавание',
  language: 'Язык',
  ru: 'Русский',
  local: 'Речь распознаётся на сервере портала, запись никуда не отправляется.',
  cloud: 'Речь распознаёт облачный сервис (Requesty, gpt-4o-mini-transcribe); если он недоступен — сервер портала.',
  cloudReady: 'Распознавание речи готово.',
  'preparation.ready': 'Распознавание речи готово.',
  empty: 'Речь не распознана',
  cancelled: 'Голосовой ввод отменён.',
  conflict: 'Черновик изменился. Распознанный текст сохранён — его можно вставить в позицию курсора.',
  failed: 'Не удалось распознать речь: {message}',
  unavailable: 'Этот браузер не умеет записывать звук. Откройте портал в браузере с микрофоном.',
  permission: 'Доступ к микрофону выключен. Разрешите его в настройках браузера и системы.',
  tooLarge: 'Запись слишком длинная. Запишите короче — до двух минут.',
  'setupPrompt.unavailableTitle': 'Распознавание речи не готово',
  'setupPrompt.unavailableBody': 'Распознавание речи сейчас недоступно. Напишите текстом или приложите запись файлом.',
  'setupPrompt.later': 'Позже',
}

const RU_COMMON: Record<string, string> = {
  submit: 'Отправить',
  submitting: 'Отправляем…',
}

/**
 * Ключ записи микрофона — тот же расчёт, что audioKey в speech-ru (длина +
 * FNV-1a 32 по байтам): узел по нему находит диалог записи. Без crypto.subtle —
 * портал открывают и по HTTP в локальной сети, где его нет.
 */
function audioKeyOfBase64(base64: string): string {
  const bytes = atob(base64)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes.charCodeAt(i), 0x01000193)
  return `${bytes.length}:${(h >>> 0).toString(16)}`
}

interface SpeechRemoteLike {
  transcribe(request: { audioBase64: string }, signal?: AbortSignal): Promise<unknown>
}

interface HostRpcLike {
  rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; value?: { path?: string } }> }
}

interface SlotsLike {
  inject(name: string, register: () => () => void): void
  register(options: Record<string, unknown>, component: ComponentType<never>): () => void
}

interface SidebarRightTabsLike {
  register(definition: { id: string; kind: string; patterns: string[]; priority: string; canOpen?: (address: string) => boolean; title: () => string }): () => void
}

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

  // 2) Русский язык интерфейса (штатный языковой пакет dsh).
  const locale = ctx.get('locale') as LocaleLike
  ctx.effect(() => locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' }), 'customer-form: язык ru')
  const dictionaries = { conversation: RU_CONVERSATION, question: RU_QUESTION, plan: RU_PLAN, chat: RU_CHAT, common: RU_COMMON, 'voice-input': RU_SPEECH }
  for (const [namespace, dictionary] of Object.entries(dictionaries)) {
    ctx.effect(() => locale.register(namespace, 'ru', dictionary), `customer-form: словарь ru/${namespace}`)
  }

  // 3) Подсказка терминов микрофону (speech-ru, ADR-0008): штатный голосовой
  //    ввод шлёт на узел только запись, поэтому перед распознаванием говорим
  //    узлу, из какого диалога она, — распознаватель возьмёт его термины.
  const host = ctx.get('connection') as unknown as HostRpcLike
  let activeSessionId: string | undefined
  //    Метод namespace-службы remote.speech — геттер (шлюз dsh отдаёт функцию,
  //    привязанную к контексту вызывающего плагина), поэтому переопределяем
  //    геттер и зовём исходный с тем же this.
  ctx.inject(['remote.speech'], (scoped) => {
    const speech = scoped.get('remote.speech') as SpeechRemoteLike | undefined
    const original = speech && Object.getOwnPropertyDescriptor(speech, 'transcribe')
    if (!speech || !original?.get) {
      console.warn('[customer-form] remote.speech.transcribe не найден — микрофон без терминов диалога')
      return
    }
    const originalGet = original.get
    Object.defineProperty(speech, 'transcribe', {
      ...original,
      get(this: SpeechRemoteLike) {
        const call = originalGet.call(this) as SpeechRemoteLike['transcribe']
        return async (request: { audioBase64: string }, signal?: AbortSignal) => {
          if (activeSessionId) {
            await host.rpc.call('/api', 'customer-form.voiceContext', { audioKey: audioKeyOfBase64(request.audioBase64), sessionId: activeSessionId })
              .catch(() => undefined) // без подсказки распознавание всё равно идёт
          }
          return call(request, signal)
        }
      },
    })
    scoped.effect(() => () => { Object.defineProperty(speech, 'transcribe', original) }, 'customer-form: термины диалога для микрофона')
  })

  // 4) Сценарий приёмки страницей в правой панели, замечания → строка ввода,
  //    вкладка Information (ADR-0007 rev10).
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
  })
  slots.inject('sidebar.right.pane.tab', () => slots.register({ name: 'sidebar.right.pane.tab', key: ACCEPTANCE_TAB }, AcceptanceTab as ComponentType<never>))
  slots.inject('sidebar.right.pane.tab.title', () => slots.register({ name: 'sidebar.right.pane.tab.title', key: ACCEPTANCE_TAB }, AcceptanceTitle as ComponentType<never>))
  // conversation.input.activity — одиночный слот (его держит голосовой ввод), поэтому мост — в списочном input.right.
  slots.inject('conversation.input.right', () => slots.register({ name: 'conversation.input.right', id: 'customer-form-bridge' }, InputBridge as ComponentType<never>))

  const loadInfo = async (sessionId: string): Promise<SessionInfo | undefined> => {
    const res = await host.rpc.call('/api', 'customer-form.sessionInfo', { sessionId })
    return res.ok ? (res.value as unknown as SessionInfo) : undefined
  }
  const openAcceptance = (sessionId: string) => {
    const right = ctx.get('sidebarRight') as { openResource(address: string): void } | undefined
    right?.openResource(`${ACCEPTANCE_PREFIX}${encodeURIComponent(sessionId)}/${Date.now()}`)
  }
  slots.inject('conversation.view', () => slots.register({
    name: 'conversation.view',
    id: 'information',
    order: 20,
    label: () => 'Information',
    inject: (sessionId: string) => ({ sessionId, loadInfo, openAcceptance }),
  }, InfoView as ComponentType<never>))

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
      // Каждый вход — СВОЯ новая сессия. Штатные пути dsh web однопользовательские:
      // восстановление и openWorkspace переиспользуют пустую сессию, и два
      // заказчика, открывших портал одновременно, писали бы в один чат.
      // На чистом томе список workspace догоняет create не сразу — ждём.
      for (let attempt = 0; ; attempt++) {
        try {
          activeSessionId = await sessions.create({ workspaceId: workspace.workspaceId })
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
