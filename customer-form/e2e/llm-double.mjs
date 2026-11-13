/**
 * Модель-ДВОЙНИК для E2E микродиалога портала (не ИИ): OpenAI-совместимый
 * /v1/chat/completions со стримингом и tool-calls, проигрывающий сценарий
 * «вопросы формой → раскадровка на согласование → «Согласую» → «уже готовлю» →
 * submit_customer_request → create_bft_fast → ссылка на документ» (rev16: без ИТОГ).
 * Нужен, чтобы путь заказчика проверялся без внешнего ключа и квоты.
 *
 *   node e2e/llm-double.mjs            # порт LLM_DOUBLE_PORT (8799)
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.LLM_DOUBLE_PORT ?? 8799)

const text = (m) => (typeof m.content === 'string' ? m.content
  : (m.content ?? []).map((p) => p.text ?? '').join('\n'))

const QUESTIONS = {
  questions: [
    { id: 'asis', header: 'ASIS', question: 'Как отчёт делается сейчас?',
      options: [{ label: 'Вручную в Excel', description: 'Сотрудник собирает данные сам' }, { label: 'Скриптом' }] },
    { id: 'demo', header: 'HowToDemo', question: 'Где вы будете проверять результат?',
      options: [{ label: 'В почте утром', description: 'Файл приходит письмом к 9:00' }, { label: 'В папке на диске' }] },
  ],
}

/** Форма, пока длинная запись ещё разбирается (rev10): только то, чего в материалах не будет. */
const TITLE_QUESTIONS = {
  questions: [
    { id: 'title', header: 'Название', question: 'Краткое название инициативы',
      options: [{ label: 'Отпуска в портале', description: 'Заявки на отпуск — в портал вместо почты' }] },
  ],
}

const DEMO = {
  title: 'утренний CSV с отчётом продаж',
  where: 'почта и BI',
  steps: [
    { screen: 'Почта Outlook', action: 'В 9:00 открываю входящие', expect: 'Письмо «Отчёт продаж» с вложением report.csv',
      device: 'письмо', mock: 'отправитель: robot@bi; заголовок: Отчёт продаж; текст: Во вложении отчёт за вчера; кнопка-контур: report.csv' },
    { screen: 'Файл report.csv', action: 'Открываю вложение в Excel', expect: 'Строки по всем регионам за вчера', mock: 'заголовок: report.csv; список: 3; поле: Регионов = 12' },
    { screen: 'Отчёт в BI', action: 'Сверяю итог продаж', expect: 'Сумма совпадает с BI до рубля', mock: 'заголовок: Продажи за вчера; поле: Итого = 1 250 000 ₽; отметка: Совпадает с BI' },
  ],
  done: ['Получаю письмо с report.csv к 9:00 три рабочих дня подряд', 'Вижу в файле строки по всем регионам за вчера', 'Итог в файле совпадает с BI до рубля'],
}

/** Черновик по материалам (rev8): что «понял» ассистент из m4a и docx. */
const DEMO_MATERIALS = {
  title: 'заявки на отпуск в портале',
  where: 'портал, график отпусков HR',
  steps: [
    { screen: 'Портал — сотрудник', action: 'Подаю заявку на неделю', expect: 'Статус «На согласовании»', mock: 'заголовок: Мои отпуска; поле: Даты = 3–9 марта; кнопка: Подать заявку' },
    { screen: 'Портал — руководитель', action: 'Согласую заявку', expect: 'Статус «Согласовано»', mock: 'заголовок: Заявки команды; список: 2; кнопка: Согласовать' },
    { screen: 'График отпусков HR', action: 'Открываю график', expect: 'Неделя сотрудника в графике', mock: 'заголовок: График отпусков; плитки; отметка: Неделя в графике' },
  ],
  done: ['Подаю заявку на отпуск в портале', 'Вижу статус «Согласовано» после решения руководителя', 'Нахожу свою неделю в графике HR без ручного ввода'],
  asis: 'Заявки идут письмами, половина теряется; график сводят вручную в Excel — 2 дня в месяц [S1 00:00][S2]',
  gap: 'Потери заявок и ручной труд HR [S1 00:00]',
  tobe: 'Заявка и согласование в портале, график обновляется сам [S1 00:20]',
  unclear: ['Нужна ли интеграция с 1С:ЗУП уже в первой версии [S2]'],
}

const INTAKE = {
  title: 'Утренняя выгрузка отчётов в CSV',
  customerName: 'E2E Тестов', customerEmail: 'e2e@test.local',
  summary: 'Автоматическая утренняя выгрузка отчётов продаж в CSV',
  asis: 'Сотрудник вручную собирает отчёт в Excel около двух часов',
  gap: 'Долго и с ошибками, отчёт опаздывает к планёрке',
  tobe: 'Система сама формирует CSV к 9:00 и присылает его',
  howToDemo: DEMO.steps.map((s) => `${s.screen}: ${s.action} → ${s.expect}`),
  glossary: [{ term: 'BI', expansion: 'система бизнес-аналитики' }],
  links: [], openQuestions: ['Какие регионы входят в выгрузку'],
}

/** Быстрая версия БФТ по той же заявке (rev14): только сказанное в диалоге. */
const FAST = {
  title: INTAKE.title,
  want: { what: INTAKE.tobe, why: INTAKE.gap, quote: `Заказчик: «${INTAKE.tobe}»` },
  requirements: [
    { kind: 'зачем', text: 'Отчёт готов к планёрке без ручной сборки', quote: `Заказчик: «${INTAKE.gap}»` },
    { kind: 'система', text: 'Система сама формирует CSV к 9:00 и присылает его', quote: `Заказчик: «${INTAKE.tobe}»` },
  ],
  outOfScope: ['изменение отчёта в BI'],
  people: [{ name: 'E2E Тестов', role: 'Заказчик' }],
  openQuestions: INTAKE.openQuestions,
  achievable: {
    vision: 'выгрузку настроит BI-команда, без новых систем',
    teams: ['BI-команда'],
    specialists: ['PO', 'BE'],
    approvals: ['доступ к почтовому роботу'],
  },
}

/** Вторая версия после правки голосом: добавлено требование. */
const FAST_REVISED = { ...FAST, requirements: [...FAST.requirements, { kind: 'на экране', text: 'В письме видна дата отчёта', quote: 'Заказчик: «в письме видна дата отчёта»' }] }

/** Полный БФТ (bft-deep в портале, ADR-0012): канон по той же заявке — форма эталона навыка. */
const DEEP_CANON = `## Проблема которую решаем

| Срез | Содержание |
| --- | --- |
| **ДЛЯ КОГО** | Руководитель отдела продаж, сотрудник, который собирает отчёт |
| **ЧТО ДЕЛАЕМ** | Система сама формирует CSV с отчётом продаж к 9:00 и присылает его письмом |
| **ASIS** | Сотрудник вручную собирает отчёт в Excel около двух часов |
| **ПРОБЛЕМА** | Долго и с ошибками, отчёт опаздывает к планёрке |
| **TOBE** | Письмо с report.csv приходит к 9:00 (БТ-1, ФТ-1); в письме видна дата отчёта (ИТ-1) |

## Изменение в UJM

| Точка демо | Было (As-Is) | Стало (To-Be) |
| --- | --- | --- |
| Почта Outlook | Отчёта утром нет, его собирают вручную | В 9:00 приходит письмо «Отчёт продаж» с report.csv |
| Файл report.csv | Таблица Excel, собранная вручную | Строки по всем регионам за вчера |
| Отчёт в BI | Сверка вручную | Итог в файле совпадает с BI до рубля |

## План демонстрации

### Акторы

| Актор | Роль в сценарии |
| --- | --- |
| Заказчик | Открывает письмо и проверяет отчёт |
| Система выгрузки | Формирует report.csv и отправляет письмо к 9:00 |

### Сценарий приёмки (happy path + alt)

\`\`\`plantuml
@startuml
actor "Заказчик" as C
participant "Система выгрузки" as S
S -> C : письмо «Отчёт продаж» с report.csv к 9:00
C -> C : открывает report.csv, видит все регионы за вчера
alt выгрузка не сформировалась
  S -> C : письмо не пришло — [УТОЧНИТЬ у E2E Тестов] кому сообщать о сбое
end
@enduml
\`\`\`

## Бизнес-Требования

## Ценность разрабатываемого функционала для бизнес-заказчиков*

| Идентификатор | Наименование требования | Ценность разрабатываемого функционала для бизнес-заказчиков | Краткое описание доработки из данного БФТ | Связанные требования |
| --- | --- | --- | --- | --- |
| БТ-1 | Отчёт готов к планёрке без ручной сборки | Сотрудник не тратит около двух часов на сборку, отчёт не опаздывает | Ежедневная выгрузка отчёта продаж в CSV и отправка письмом к 9:00 | ФТ-1, ИТ-1 |

## Пользовательские требования*

| Идентификатор | Наименование требования | Story | Комментарий | Связанные требования |
| --- | --- | --- | --- | --- |
| ПТ-1 | Получить отчёт утром | **Когда** я (руководитель продаж) готовлюсь к планёрке **Я хочу** получить отчёт продаж письмом к 9:00 **Чтобы** не ждать ручной сборки | Регионы в выгрузке — [УТОЧНИТЬ у E2E Тестов] | БТ-1 |

## Требования к интерфейсам*

| Идентификатор | Наименование требования | Требование к пользовательскому интерфейсу | Предложения по элементам UI, механике и композиции | Связанные требования |
| --- | --- | --- | --- | --- |
| ИТ-1 | Дата отчёта в письме | В письме видна дата, за которую сформирован отчёт | [УТОЧНИТЬ] — формат письма не обсуждался | ПТ-1 |

## Макеты интерфейса*

[УТОЧНИТЬ — макет письма не обсуждался].

## Функциональные требования*

| Идентификатор | Наименование требования | Приоритет | Функциональные требования | Параметры, ограничения | Связанные требования |
| --- | --- | --- | --- | --- | --- |
| ФТ-1 | Ежедневная выгрузка в CSV | Высокий | Система сама формирует CSV с отчётом продаж и присылает его письмом | К 9:00 каждый рабочий день | БТ-1, ПТ-1 |

## Нефункциональные требования*

| Идентификатор | Наименование требования | Описание | Связанные требования |
| --- | --- | --- | --- |
| НФТ-1 | Точность итога | Итог в файле совпадает с BI до рубля | ФТ-1 |

## Зависимости

| Зависимость | Источник | Срок | Статус |
| --- | --- | --- | --- |
| Доступ к данным продаж в BI | Заявка | — | [УТОЧНИТЬ у E2E Тестов] |

## Риски

| Риск | Влияние | Митигация |
| --- | --- | --- |
| Выгрузка не сформировалась к 9:00 | Отчёт опаздывает к планёрке | [УТОЧНИТЬ у E2E Тестов] — уведомление о сбое |

## Якоря истины

| Факт в БФТ | Источник (якорь) | Ранг | Тип |
| --- | --- | --- | --- |
| CSV к 9:00 письмом | Заказчик в диалоге | R3 | Решение/утверждение заказчика |
| Итог совпадает с BI до рубля | Сценарий приёмки (согласован) | R3 | Решение/утверждение заказчика |
`

/** Следующий ход сценария по истории запроса. */
function nextTurn(messages) {
  const last = messages.at(-1)
  if (last?.role === 'tool') {
    const call = messages.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === last.tool_call_id)
    // «Согласую» на сценарии — полное согласие (rev16): «уже готовлю» пишет портал, модель сразу сдаёт заявку.
    // «#порядок» (tracker-recovery): как Haiku вживую — сначала сборка, потом сдача заявки.
    const reversed = messages.some((m) => m.role === 'user' && text(m).includes('#порядок'))
    const called = (name) => messages.some((m) => (m.tool_calls ?? []).some((c) => c.function.name === name))
    if (call?.function.name === 'confirm_acceptance_demo' && text(last).includes('нажал кнопку «Согласую»')) {
      return reversed ? { tool: { name: 'create_bft_fast', args: FAST }, delay: 2000 } : { tool: { name: 'submit_customer_request', args: INTAKE } }
    }
    if (call?.function.name === 'create_bft_fast' && reversed && !called('submit_customer_request')) {
      return { tool: { name: 'submit_customer_request', args: INTAKE } }
    }
    // Раскладка требований у настоящей модели идёт минуту-две: пауза, чтобы был виден экран ожидания.
    if (call?.function.name === 'submit_customer_request' && !called('create_bft_fast')) {
      return { tool: { name: 'create_bft_fast', args: FAST }, delay: 4000 }
    }
    if (call?.function.name === 'create_bft_fast' || call?.function.name === 'submit_customer_request') {
      const submitted = messages.find((m) => m.role === 'tool' && /tasks\/\d+/.test(text(m)))
      const url = /https?:\/\/\S+\/tasks\/\d+/.exec(submitted ? text(submitted) : '')?.[0] ?? ''
      const page = /https?:\/\/\S+\/api\/customer-form\.bftFast\?session=\S+/.exec(text(last))?.[0] ?? ''
      return { content: `БФТ-документ на проверку: [открыть документ](${page}). Отслеживание статуса: ${url}\n\nЕсли всё верно — нажмите «Да, согласен». Если что-то пропущено — «Добавить требования».` }
    }
    if (call?.function.name === 'read_customer_materials' && text(last).includes('Ещё разбираются')) {
      return { content: 'Запись длинная — пока она расшифровывается, один вопрос:', tool: { name: 'ask_user_question', args: TITLE_QUESTIONS } }
    }
    if (call?.function.name === 'read_customer_materials') {
      // Нет голосовой заметки (только текстовый файл) — уточняем формой, как без материалов.
      if (!/отдел\S* кадров/i.test(text(last))) return { content: 'Записала суть. Уточню пару моментов:', tool: { name: 'ask_user_question', args: QUESTIONS } }
      return { content: 'Изучила материалы, вот как я поняла задачу:', tool: { name: 'confirm_acceptance_demo', args: DEMO_MATERIALS } }
    }
    // После формы: если прошлое чтение материалов сказало «Ещё разбираются» — читаем снова.
    const reads = messages.filter((m) => m.role === 'tool' && messages.flatMap((x) => x.tool_calls ?? []).some((c) => c.id === m.tool_call_id && c.function.name === 'read_customer_materials'))
    if (call?.function.name === 'ask_user_question' && reads.length && text(reads.at(-1)).includes('Ещё разбираются')) {
      return { content: '', tool: { name: 'read_customer_materials', args: {} } }
    }
    if (call?.function.name === 'ask_user_question') {
      return { content: 'Собрала сценарий приёмки — посмотрите раскадровку:', tool: { name: 'confirm_acceptance_demo', args: DEMO } }
    }
    return { content: 'Поняла.' }
  }
  const said = messages.filter((m) => m.role === 'user').map(text)
  // Страница документа БФТ (rev15): замечания → пересборка, «Согласовать» → благодарность.
  if (/Замечания к документу БФТ|Добавь требования|Поправь в документе/.test(said.at(-1) ?? '')) {
    return { content: 'Учла замечания, пересобираю документ…', tool: { name: 'create_bft_fast', args: FAST_REVISED } }
  }
  if ((said.at(-1) ?? '').includes('Да, согласен с документом БФТ')) {
    return { content: 'Спасибо! Документ согласован, PO возьмёт его в проработку.' }
  }
  if (/подтвержда/i.test(said.at(-1) ?? '')) {
    return { tool: { name: 'submit_customer_request', args: INTAKE } }
  }
  // Сценарий микрофона (voice-terms.spec): поле ввода должно остаться свободным.
  if (said.some((t) => t.includes('#без-вопросов'))) return { content: 'Принято, записала.' }
  if (!messages.some((m) => m.role === 'assistant') && said.some((t) => t.includes('[File'))) {
    return { content: '', tool: { name: 'read_customer_materials', args: {} } }
  }
  if (!messages.some((m) => m.role === 'assistant')) {
    return { content: 'Записала суть. Уточню пару моментов:', tool: { name: 'ask_user_question', args: QUESTIONS } }
  }
  return { content: 'Поняла, дополнила постановку.' }
}

function sse(res, chunk) {
  res.write(`data: ${JSON.stringify(chunk)}\n\n`)
}

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  req.on('data', (d) => { raw += d })
  req.on('end', () => {
    const body = JSON.parse(raw)
    // «📌 Заявка …» — инъекция портала, а не реплика заказчика: сценарий её не видит.
    const messages = (body.messages ?? []).filter((m) => m.role !== 'system' && m.role !== 'developer'
      && !(m.role === 'user' && text(m).startsWith('📌')))
    // Полный БФТ (ADR-0012): системная инструкция bft-deep портала — канон; пауза, чтобы был виден экран ожидания.
    const deep = (body.messages ?? []).some((m) => m.role === 'system' && text(m).includes('доводит первичные требования'))
    // Запрос заголовка сессии — без инструментов: короткий ответ.
    const turn = deep ? { content: DEEP_CANON, delay: 8000 } : body.tools?.length ? nextTurn(messages) : { content: 'Заявка заказчика' }
    const last = messages.at(-1)
    console.log(`[llm-double] tools=${(body.tools ?? []).map((t) => t.function?.name).join(',')} last=${last?.role}:${text(last ?? {}).slice(0, 160)}`)
    if (turn.delay) { setTimeout(() => respond(turn, body), turn.delay); return }
    respond(turn, body)
  })
  function respond(turn, body) {
    const base = { id: `dbl-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model }
    const toolCall = turn.tool && { index: 0, id: `call_${Date.now()}`, type: 'function',
      function: { name: turn.tool.name, arguments: JSON.stringify(turn.tool.args) } }

    if (!body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0,
        message: { role: 'assistant', content: turn.content ?? null, ...(toolCall ? { tool_calls: [toolCall] } : {}) },
        finish_reason: toolCall ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })
    if (turn.content) sse(res, { ...base, choices: [{ index: 0, delta: { content: turn.content }, finish_reason: null }] })
    if (toolCall) sse(res, { ...base, choices: [{ index: 0, delta: { tool_calls: [toolCall] }, finish_reason: null }] })
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: toolCall ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
    res.write('data: [DONE]\n\n')
    res.end()
  }
}).listen(PORT, '0.0.0.0', () => console.log(`[llm-double] :${PORT}`))
