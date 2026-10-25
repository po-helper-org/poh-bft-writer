/**
 * Голосовой ввод ↔ диалог заказчика (ADR-0008): тексты диалога для подсказки
 * терминов распознавателю speech-ru.
 *
 * Штатный API распознавания dsh получает только запись — без сессии. Поэтому
 * клиент customer-form перед распознаванием сообщает узлу ключ записи и свою
 * сессию (POST /api/customer-form.voiceContext), а источник подсказок
 * (ctx.speechHints.register) по ключу находит диалог и отдаёт его тексты:
 * сообщения заказчика и ассистента и разобранные материалы. Чужие диалоги в
 * подсказку не попадают — только тот, из окна которого пришла запись.
 */
import type { Materials } from './materials.js'
import type { AgentLike } from './tool.js'

const KEY_TTL_MS = 5 * 60_000
const MAX_AGENTS = 200
const MAX_TEXT = 20_000

export class VoiceContext {
  private agents = new Map<string, AgentLike>()
  private keys = new Map<string, { sessionId: string; at: number }>()

  constructor(private readonly materials: Materials) {}

  /** Агент сессии — из agent/inbox/claimed: через него читаются сообщения. */
  remember(agent: AgentLike): void {
    this.agents.delete(agent.session.id)
    this.agents.set(agent.session.id, agent)
    if (this.agents.size > MAX_AGENTS) this.agents.delete(this.agents.keys().next().value!)
  }

  /** Клиент: эта запись — из такой-то сессии. */
  announce(audioKey: string, sessionId: string): void {
    const now = Date.now()
    for (const [key, entry] of this.keys) if (now - entry.at > KEY_TTL_MS) this.keys.delete(key)
    this.keys.set(audioKey, { sessionId, at: now })
  }

  /** Источник подсказок speech-ru: тексты диалога этой записи. */
  texts(audioKey: string): string[] | undefined {
    const entry = this.keys.get(audioKey)
    if (!entry) {
      console.log(`[customer-form] запись ${audioKey}: окно не сообщило диалог — без терминов`)
      return undefined
    }
    this.keys.delete(audioKey)
    const texts: string[] = []
    const agent = this.agents.get(entry.sessionId)
    for (const message of agent?.session.deriveMessages() ?? []) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      const text = message.content.map((b) => b.text ?? '').join('\n').trim()
      if (text) texts.push(text.slice(0, MAX_TEXT))
    }
    for (const markdown of this.materials.texts(entry.sessionId)) texts.push(markdown.slice(0, MAX_TEXT))
    return texts
  }
}
