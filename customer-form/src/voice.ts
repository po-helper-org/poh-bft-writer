/**
 * Потоковая диктовка заказчика (ADR-0008 rev4): микрофон портала режет речь
 * на куски по паузам прямо во время записи и шлёт каждый сюда
 * (POST /api/customer-form.dictate). Кусок распознаёт speech-ru — облако
 * Requesty, резерв GigaAM — с подсказкой: термины этого диалога и хвост уже
 * надиктованного текста, чтобы куски склеивались связно. После «Стоп»
 * остаётся дораспознать только последний кусок.
 */
import type { Materials } from './materials.js'
import type { AgentLike } from './tool.js'

const MAX_AGENTS = 200
const MAX_TEXT = 20_000
const SPEECH_RU = 'speech-ru'

interface SpeechRuModule {
  resolveConfig(config?: object): object
  recognize(config: object, audio: Uint8Array, signal: AbortSignal, log?: (line: string) => void,
    sources?: Iterable<(request: { audioKey: string }) => readonly string[] | undefined>): Promise<{ text: string }>
}

export class VoiceContext {
  private agents = new Map<string, AgentLike>()

  constructor(private readonly materials: Materials) {}

  /** Агент сессии — из agent/inbox/claimed: через него читаются сообщения. */
  remember(agent: AgentLike): void {
    this.agents.delete(agent.session.id)
    this.agents.set(agent.session.id, agent)
    if (this.agents.size > MAX_AGENTS) this.agents.delete(this.agents.keys().next().value!)
  }

  /** Тексты диалога: сообщения заказчика и ассистента и разобранные материалы. */
  sessionTexts(sessionId: string): string[] {
    const texts: string[] = []
    for (const message of this.agents.get(sessionId)?.session.deriveMessages() ?? []) {
      if (message.role !== 'user' && message.role !== 'assistant') continue
      const text = message.content.map((b) => b.text ?? '').join('\n').trim()
      if (text) texts.push(text.slice(0, MAX_TEXT))
    }
    for (const markdown of this.materials.texts(sessionId)) texts.push(markdown.slice(0, MAX_TEXT))
    return texts
  }

  /**
   * Один кусок диктовки → текст. Тишина в куске (пауза) — пустой текст, а не
   * ошибка: в потоке паузы обычны; молчащий микрофон целиком видит клиент.
   */
  async dictate(wav: Uint8Array, sessionId: string, previous: string): Promise<string> {
    const speech = (await import(SPEECH_RU)) as SpeechRuModule
    const sources = [() => this.sessionTexts(sessionId), () => (previous ? [previous] : [])]
    try {
      const out = await speech.recognize(speech.resolveConfig(), wav, AbortSignal.timeout(30_000), (line) => console.log(`[speech-ru] ${line}`), sources)
      return out.text
    } catch (e) {
      if (/тишину/.test((e as Error).message)) return ''
      throw e
    }
  }
}
