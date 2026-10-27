/**
 * Модель-ДВОЙНИК для E2E микродиалога портала (не ИИ): OpenAI-совместимый
 * /v1/chat/completions со стримингом и tool-calls, проигрывающий сценарий
 * «вопросы формой → раскадровка на согласование → ИТОГ → подтверждение →
 * submit_customer_request → ссылка».
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
  smart: { s: INTAKE.tobe, m: DEMO.done[0], r: INTAKE.gap },
  boundaries: ['Отчёт продаж по регионам за вчера', 'Не входит: изменение отчёта в BI'],
  personas: [{ name: 'E2E Тестов', role: 'Заказчик', influence: 'Принимает работу по сценарию приёмки' }],
  requirements: [
    { id: 'БТ-1', asis: INTAKE.asis, tobe: 'Отчёт готов к планёрке без ручной сборки', source: `Заказчик: «${INTAKE.gap}»` },
    { id: 'ФТ-1', tobe: INTAKE.tobe, related: ['БТ-1'], source: `Заказчик: «${INTAKE.tobe}»` },
  ],
  openQuestions: INTAKE.openQuestions,
}

/** Следующий ход сценария по истории запроса. */
function nextTurn(messages) {
  const last = messages.at(-1)
  if (last?.role === 'tool') {
    const call = messages.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === last.tool_call_id)
    if (call?.function.name === 'submit_customer_request') {
      return { content: 'Собираю быструю версию БФТ…', tool: { name: 'create_bft_fast', args: FAST } }
    }
    if (call?.function.name === 'create_bft_fast') {
      const submitted = messages.find((m) => m.role === 'tool' && /tasks\/\d+/.test(text(m)))
      const url = /https?:\/\/\S+\/tasks\/\d+/.exec(submitted ? text(submitted) : '')?.[0] ?? ''
      const page = /https?:\/\/\S+\/api\/customer-form\.bftFast\?session=\S+/.exec(text(last))?.[0] ?? ''
      return { content: `Спасибо! Заявка сдана, PO возьмёт её в работу. Отслеживание статуса: ${url}\n\nБыстрая версия БФТ на согласование: [открыть документ](${page})` }
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
    return { content: 'ИТОГ по заявке:\n1. Заказчик: E2E Тестов, e2e@test.local\n2. Суть: утренняя выгрузка отчётов в CSV\n'
      + '3. ASIS: вручную в Excel\n4. GAP: долго, опаздывает\n5. TOBE: CSV к 9:00 сам\n6. HowToDemo (согласован): письмо в 9:00, CSV, сверка с BI\n'
      + '7. Глоссарий: BI — система бизнес-аналитики\nВсё верно? Напишите «подтверждаю».' }
  }
  const said = messages.filter((m) => m.role === 'user').map(text)
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
    // Запрос заголовка сессии — без инструментов: короткий ответ.
    const turn = body.tools?.length ? nextTurn(messages) : { content: 'Заявка заказчика' }
    const last = messages.at(-1)
    console.log(`[llm-double] tools=${(body.tools ?? []).map((t) => t.function?.name).join(',')} last=${last?.role}:${text(last ?? {}).slice(0, 160)}`)
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
  })
}).listen(PORT, '0.0.0.0', () => console.log(`[llm-double] :${PORT}`))
