/**
 * Модель-ДВОЙНИК для E2E микродиалога портала (не ИИ): OpenAI-совместимый
 * /v1/chat/completions со стримингом и tool-calls, проигрывающий сценарий
 * «вопросы формой → ИТОГ → подтверждение → submit_customer_request → ссылка».
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

const INTAKE = {
  title: 'Утренняя выгрузка отчётов в CSV',
  customerName: 'E2E Тестов', customerEmail: 'e2e@test.local',
  summary: 'Автоматическая утренняя выгрузка отчётов продаж в CSV',
  asis: 'Сотрудник вручную собирает отчёт в Excel около двух часов',
  gap: 'Долго и с ошибками, отчёт опаздывает к планёрке',
  tobe: 'Система сама формирует CSV к 9:00 и присылает его',
  howToDemo: ['Открыть почту в 9:00', 'Найти письмо с CSV', 'Сверить итоги с BI'],
  glossary: [{ term: 'BI', expansion: 'система бизнес-аналитики' }],
  links: [], openQuestions: ['Какие регионы входят в выгрузку'],
}

/** Следующий ход сценария по истории запроса. */
function nextTurn(messages) {
  const last = messages.at(-1)
  if (last?.role === 'tool') {
    const call = messages.flatMap((m) => m.tool_calls ?? []).find((c) => c.id === last.tool_call_id)
    if (call?.function.name === 'submit_customer_request') {
      const url = /https?:\/\/\S+\/tasks\/\d+/.exec(text(last))?.[0] ?? ''
      return { content: `Спасибо! Заявка сдана, PO возьмёт её в работу. Отслеживание статуса: ${url}` }
    }
    return { content: 'ИТОГ по заявке:\n1. Заказчик: E2E Тестов, e2e@test.local\n2. Суть: утренняя выгрузка отчётов в CSV\n'
      + '3. ASIS: вручную в Excel\n4. GAP: долго, опаздывает\n5. TOBE: CSV к 9:00 сам\n6. HowToDemo: письмо в 9:00, сверка с BI\n'
      + '7. Глоссарий: BI — система бизнес-аналитики\nВсё верно? Напишите «подтверждаю».' }
  }
  const said = messages.filter((m) => m.role === 'user').map(text)
  if (/подтвержда/i.test(said.at(-1) ?? '')) {
    return { tool: { name: 'submit_customer_request', args: INTAKE } }
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
