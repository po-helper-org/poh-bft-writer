/**
 * Общие части приёма заявки (ADR-0023): схемы полей и шаги, которые одинаково
 * выполняют инструменты чата заказчика (tool.ts) и MCP портала (mcp-bft.ts) —
 * одна методология и одни проверки, кто бы ни вёл диалог.
 */
import { readFile } from 'node:fs/promises'
import { fastPagePath, publicPortalUrl } from './bft-fast.js'
import { KINDS, SPECIALISTS } from './primary.js'
import { demoPageHtml } from './demo-page.js'
import { moscowTime, type Backlog, type Ticket } from './host.js'
import type { DemoRecord } from './demo.js'
import { mirrorRequest } from './workspace-mirror.js'

/** Сессия заявки, заведённой внешним агентом через MCP (ADR-0023): её модель — агента, не портала. */
export const MCP_SESSION_PREFIX = 'mcp-'
export const isMcpSession = (sessionId: string) => sessionId.startsWith(MCP_SESSION_PREFIX)

export const text = (description: string) => ({ type: 'string', required: true, description })
export const optional = (description: string) => ({ type: 'string', description })
export const strings = (description: string) => ({ type: 'array', required: true, items: { type: 'string' }, description })
const quote = (what: string) => text(`${what}. Цитата: «Заказчик: «дословно»» (его сообщения и ответы в форме), «Материалы [S1 00:12]: «…»» или «Сценарий приёмки (согласован): «…»»`)

/** Сценарий приёмки (HowToDemo): confirm_acceptance_demo в чате, bft_set_acceptance_demo в MCP. */
export const DEMO_PARAMS = {
  title: text('Что принимаем — результат работы, 3–8 слов'),
  where: text('Где заказчик проверяет: система, окружение или канал (почта, папка, портал, отчёт)'),
  steps: {
    type: 'array', required: true, description: 'Шаги проверки по порядку, 2–7 шагов — по одному экрану на шаг',
    items: {
      type: 'object', additionalProperties: false,
      properties: {
        screen: text('Экран или место, коротко: «Почта Outlook», «Отчёт в BI»'),
        action: text('Что заказчик делает на этом экране'),
        expect: text('Что заказчик видит на этом экране — проверяемо (цифры, файл, статус), из его слов или материалов. Передача данных между системами — не expect: её заказчик не видит'),
        device: optional('Где этот экран: браузер, письмо, уведомление или приложение'),
        mock: text('Что заказчик увидит на этом экране — для картинки раскадровки, сверху вниз через «;»: заголовок: …; текст: …; кнопка: …; список: 3; поле: … = …; '
          + 'успех: …; отказ: …. 3–6 частей, только то, что заказчик увидит. Отметки, статусы и уведомления — только названные заказчиком или в материалах; своё допущение — вопросом в unclear'),
      },
    },
  },
  done: strings('Чек-лист приёмки строго от лица заказчика: 3–6 коротких пунктов, каждый проверяется однозначно «да/нет» '
    + 'и начинается с того, что он видит или может сделать: «Вижу в корзине опцию „Застраховать билеты“ с ценой», «Получаю полис на почту после оплаты». Без технических деталей'),
  asis: optional('ASIS по материалам: как сейчас, со ссылками на источники [S1 00:12]'),
  gap: optional('GAP по материалам: что не устраивает, со ссылками на источники'),
  tobe: optional('TOBE по материалам: как должно стать, со ссылками на источники'),
  unclear: {
    type: 'array', items: { type: 'string' },
    description: 'Чего нет в материалах или где они противоречат друг другу — заказчик поправит в «Нужны правки». '
      + 'Сюда же — каждое добавленное тобой допущение (статус, уведомление, надпись, шаг), вопросом «Верно ли, что…?»',
  },
}

/** Постановка заявки: submit_customer_request в чате, bft_submit_request в MCP. */
export const SUBMIT_PARAMS = {
  title: text('Короткое название заявки для доски, до 8 слов'),
  customerName: text('ФИО заказчика'),
  customerEmail: text('Email заказчика'),
  summary: text('Суть инициативы, 1–2 предложения'),
  asis: optional('ASIS: как работает сейчас — со слов заказчика; если заказчик не описывал — пусто, не додумывай'),
  gap: text('GAP: почему текущее решение не устраивает'),
  tobe: text('TOBE: как должно работать'),
  howToDemo: strings('HowToDemo: шаги, согласованные заказчиком в confirm_acceptance_demo, по одному на элемент'),
  glossary: {
    type: 'array', required: true, description: 'Расшифровки сокращений',
    items: { type: 'object', additionalProperties: false, properties: { term: text('Сокращение'), expansion: text('Расшифровка') } },
  },
  links: strings('Ссылки на материалы, которые дал заказчик (JIRA, Confluence, внешние); ссылку на саму заявку не добавляй'),
  openQuestions: strings('Что осталось невыясненным — для PO'),
}

/** Первичные требования (бриф): create_bft_fast в чате, bft_create_brief в MCP. */
export const FAST_PARAMS = {
  title: text('Название — как у заявки, до 10 слов'),
  want: {
    type: 'object', required: true, additionalProperties: false, description: 'Что заказчик хочет и зачем — его словами',
    properties: {
      what: text('Что хочет получить — одна фраза'),
      why: optional('Зачем — проблема или выгода, если звучала'),
      quote: quote('Откуда это'),
      asis: optional('Как сейчас — дословно, только если заказчик описал текущий процесс; не пересказ: кусок его реплики из quote или цитаты требования. Нет реплики — не заполняй'),
    },
  },
  requirements: {
    type: 'array', required: true, description: 'Требования со слов: каждое — одна короткая фраза и цитата; чего не говорил — не добавляй. '
      + 'Ответ «Каким вы видите решение» — гипотеза реализации: дословно в achievable.vision. В requirements — результат, который заказчик назвал нужным пользователю или бизнесу; kind «система» — наблюдаемое поведение системы, а не механизм (кто кого вызывает, какой поток читает). Названная заказчиком обязательная интеграция или система остаётся требованием, сформулированным как результат (данные оказываются в системе X). Условие, которое ещё предстоит согласовать, — в approvals и openQuestions.',
    items: {
      type: 'object', additionalProperties: false,
      properties: {
        kind: { type: 'string', required: true, enum: [...KINDS], description: 'зачем — ценность; пользователю — что хочет пользователь; на экране — что он видит; система — что делает система; качество — измеримое свойство, только если названо' },
        text: text('Требование — одна фраза'),
        quote: quote('Откуда требование'),
        asis: optional('Как сейчас в этой точке — дословно, подстрока цитаты этого требования или want.quote; только если заказчик описал текущий процесс. Нет реплики — не заполняй'),
      },
    },
  },
  outOfScope: {
    type: 'array', description: 'Только то, что заказчик явно исключил («это не делаем», «потом»). Нерешённое и «уточняется» — не сюда, а в openQuestions',
    items: { type: 'object', additionalProperties: false, properties: { text: text('Что не входит — одна фраза'), quote: quote('Где заказчик это исключил') } },
  },
  agreements: {
    type: 'array', description: 'Договорённости и обязательные условия со слов заказчика (обязательная система, согласование, ограничение) — не исключения и не открытые вопросы',
    items: { type: 'object', additionalProperties: false, properties: { text: text('Договорённость — одна фраза'), quote: quote('Откуда') } },
  },
  people: {
    type: 'array', description: 'Заказчик и люди, которых он назвал',
    items: {
      type: 'object', additionalProperties: false,
      properties: {
        name: text('Имя'), role: optional('Роль — из сказанного'),
        about: optional('Зона влияния: по каким вопросам к нему — из сказанного; не контакты'),
        contact: optional('Email или телефон, если назвал'),
      },
    },
  },
  openQuestions: { type: 'array', items: { type: 'string' }, description: 'Настоящие пробелы задачи, нерешённое и «уточняется» — уходят в чат и в заявку' },
  glossary: {
    type: 'array', description: 'Расшифровки сокращений и терминов — со слов заказчика или материалов',
    items: { type: 'object', additionalProperties: false, properties: { term: text('Сокращение или термин'), meaning: text('Расшифровка') } },
  },
  metric: {
    type: 'object', additionalProperties: false, description: 'Эффект, если заказчик его назвал: какой показатель и как изменится. Не назвал — не заполняй, не выдумывай',
    properties: { now: optional('Сколько сейчас — его словами'), target: optional('Сколько хотим — его словами'), quote: quote('Откуда') },
  },
  deadline: {
    type: 'object', additionalProperties: false, description: 'Желаемый срок или событие, если заказчик назвал. Не назвал — не заполняй',
    properties: { when: text('К какому сроку или событию'), why: optional('Почему тогда — если сказал'), quote: quote('Откуда') },
  },
  actors: {
    type: 'array', description: 'Кто будет пользоваться результатом — роли и примерно сколько, со слов заказчика (не стейкхолдеры из people)',
    items: { type: 'object', additionalProperties: false, properties: { role: text('Роль пользователя'), count: optional('Примерно сколько — если сказал'), quote: quote('Откуда') } },
  },
  achievable: {
    type: 'object', additionalProperties: false,
    description: 'SMART A — краткий план реализации из ответа заказчика «Каким вы видите решение»; здесь ты дораскрываешь, по 1–4 коротких пункта',
    properties: {
      vision: optional('Ответ заказчика «Каким вы видите решение» — дословно; не отвечал — не заполняй'),
      teams: { type: 'array', items: { type: 'string' }, description: 'Какие команды участвуют в реализации' },
      specialists: { type: 'array', items: { type: 'string', enum: [...SPECIALISTS] }, description: 'Какие специалисты нужны' },
      approvals: { type: 'array', items: { type: 'string' }, description: 'Какие согласования нужны' },
      questions: { type: 'array', items: { type: 'string' }, description: 'Что проработать до реализации' },
    },
  },
}

/**
 * Страница сценария приёмки (UserFlow, раскадровка, чек-лист, замечания) —
 * файлом .html в заявку: та же, что заказчик видел в правой панели, открывается
 * и без портала. Согласованная версия — отдельным файлом с отметкой времени.
 * Сбой трекера диалог не роняет.
 */
export async function attachAcceptancePage(backlog: Backlog, sessionId: string, record: DemoRecord): Promise<void> {
  try {
    const ticket = await backlog.find(sessionId)
    if (!ticket) return
    const approved = record.approvedAt ? moscowTime(record.approvedAt) : undefined
    const html = demoPageHtml(record.demo, { sessionId, rev: record.rev, taskId: ticket.taskId, ...(approved ? { approved } : {}) })
    const name = `scenarij-priyomki-${ticket.taskId}-v${record.rev}${approved ? '-soglasovan' : ''}.html`
    await backlog.attach(ticket, name, new TextEncoder().encode(html))
  } catch (e) {
    console.error('[customer-form] страница сценария не ушла в задачу:', e)
  }
}


/** Папка заявки сессии в workspace — если заявка уже заведена. */
export async function mirrorSession(backlog: Backlog, sessionId: string): Promise<void> {
  const ticket = await backlog.find(sessionId).catch(() => undefined)
  if (ticket) await mirrorRequest(ticket.taskId, sessionId)
}


/**
 * «Источник Summary» открытого поля fast (план качества, C8): страница заявки
 * в портале по PORTAL_PUBLIC_URL; адреса нет или он loopback — «заявка #N»
 * без ссылки (ссылка на 127.0.0.1 или внутренний трекер у читателя не откроется).
 */
export function requestSource(taskId: number, sessionId: string): string {
  const page = publicPortalUrl(fastPagePath(sessionId))
  if (!page) console.error(`[customer-form] PORTAL_PUBLIC_URL не задан или loopback — в документе заявки #${taskId} ссылки на портал не будет`)
  return page ? `заявка #${taskId} — ${page}` : `заявка #${taskId}`
}


/** Документ, страница и csv — в заявку; комментарий — PO видит, что fast готов. Сбой трекера ответ не роняет. */
export async function publishFast(backlog: Backlog, ticket: Ticket, slug: string, rev: number,
  files: { md: string; html: string; personas: string; requirements: string; contextMap: string }, questions: string[], cortex: boolean): Promise<void> {
  const suffix = rev > 1 ? `-v${rev}` : ''
  try {
    const out: [string, string][] = [[files.html, `${slug}-fast${suffix}.html`], [files.md, `${slug}-fast${suffix}.md`],
      [files.personas, `${slug}-personas${suffix}.csv`], [files.requirements, `${slug}-requirements${suffix}.csv`]]
    // Находки Кортекса — отдельным файлом, как карта /bft-recon: в документ со слов заказчика не вписываются.
    if (cortex) out.push([files.contextMap, `${slug}-context-map${suffix}.md`])
    for (const [path, name] of out) await backlog.attach(ticket, name, await readFile(path))
    await backlog.comment(ticket, [
      `<p><strong>📄 Быстрая версия БФТ собрана в чате заказчика</strong> — версия ${rev}, ${moscowTime(new Date().toISOString())}</p>`,
      `<p>Файлы: ${slug}-fast${suffix}.html (страница ревью) и .md; следующий шаг — /bft-deep по документу.</p>`,
      questions.length ? `<p><strong>Открытые вопросы:</strong></p><ul>${questions.map((q) => `<li>${q.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</li>`).join('')}</ul>` : '',
    ].join(''))
  } catch (e) {
    console.error('[customer-form] быстрая версия БФТ не ушла в задачу:', e)
  }
}
