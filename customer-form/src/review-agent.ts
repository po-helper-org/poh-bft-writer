/**
 * Агент полного ревью БФТ (ADR-0024) — внешний агент через шлюз агентов
 * (Responses API: `instructions` + `input`, ответ — `output[].content[]`
 * с `output_text`). Адрес, имя модели и ключ — только в окружении сервера:
 *   BFT_REVIEW_AGENT_URL   — полный адрес метода ответа (nginx, точный location)
 *   BFT_REVIEW_AGENT_KEY   — Bearer-ключ агента (кладёт владелец)
 *   BFT_REVIEW_AGENT_MODEL — необязательно: модель/псевдоним для шлюза
 * Агент должен быть без инструментов: в документе — текст заказчика.
 */
import type { TextModel } from './bft-revise.js'

export interface ReviewAgent { url: string; key: string; model?: string }

export function reviewAgentFromEnv(env: NodeJS.ProcessEnv = process.env): ReviewAgent | undefined {
  const url = env.BFT_REVIEW_AGENT_URL?.trim()
  const key = env.BFT_REVIEW_AGENT_KEY?.trim()
  if (!url || !key || !/^https?:\/\//.test(url)) return undefined
  const model = env.BFT_REVIEW_AGENT_MODEL?.trim()
  return { url, key, ...(model ? { model } : {}) }
}

/** Текст ответа Responses API: output_text или части output_text в сообщениях. */
export function responseText(body: unknown): string {
  const b = body as { output_text?: unknown; output?: unknown }
  if (typeof b?.output_text === 'string' && b.output_text) return b.output_text
  if (!Array.isArray(b?.output)) return ''
  return b.output.flatMap((item: { type?: string; content?: unknown }) =>
    item?.type === 'message' && Array.isArray(item.content)
      ? item.content.flatMap((part: { type?: string; text?: unknown }) => (part?.type === 'output_text' || part?.type === 'text') && typeof part.text === 'string' ? [part.text] : [])
      : []).join('')
}

export function reviewAgentModel(agent: ReviewAgent, fetchImpl: typeof fetch = fetch): TextModel {
  return {
    label: 'агент полного ревью',
    complete: async (prompt, signal, onChars) => {
      const res = await fetchImpl(agent.url, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${agent.key}` },
        body: JSON.stringify({ ...(agent.model ? { model: agent.model } : {}), instructions: prompt.system, input: prompt.user, store: false }),
      })
      const raw = await res.text()
      if (!res.ok) throw new Error(`агент полного ревью: HTTP ${res.status} ${raw.slice(0, 300)}`)
      let body: unknown
      try { body = JSON.parse(raw) } catch { throw new Error('агент полного ревью: ответ не JSON') }
      const text = responseText(body)
      if (!text.trim()) throw new Error('агент полного ревью вернул пустой ответ')
      onChars(text.length)
      return text
    },
  }
}
