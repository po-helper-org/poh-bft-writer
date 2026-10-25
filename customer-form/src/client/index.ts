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

/** Микрофон композера (голосовой ввод dsh, провайдер gigaam-local — rev9). */
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

  // 3) Чаты заказчика — в workspace «Customer-requests»: создаём по имени
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
      const host = ctx.get('connection') as unknown as {
        rpc: { call: (channel: string, endpoint: string, payload?: unknown) => Promise<{ ok: boolean; value?: { path?: string } }> }
      }
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
          uiWorkspace.openSession(await sessions.create({ workspaceId: workspace.workspaceId }))
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
