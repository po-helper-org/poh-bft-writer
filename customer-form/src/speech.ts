/**
 * customer-form/speech · микрофон композера по-русски (ADR-0007 rev9).
 *
 * Штатный распознаватель голосового ввода dsh — SenseVoice — русского не
 * знает. Этот узел регистрирует в ctx.speechToText провайдер «gigaam-local»:
 * запись микрофона (WAV 16 кГц, его собирает клиент dsh) уходит в тот же
 * context-ingest, что расшифровывает диктофон заказчика, — GigaAM v3 с
 * пунктуацией, офлайн, внутри compose-сети. Подготовки нет: модель прогрета
 * сервисом на старте, поэтому провайдер готов сразу.
 */
export const name = 'customer-form-speech'
export const inject = ['speechToText']

export const PROVIDER_ID = 'gigaam-local'

interface SpeechInput { audio: Uint8Array; language: string }
interface Transcript { text: string; audioSeconds: number; inferenceSeconds: number }

interface SpeechContext {
  speechToText: {
    register(provider: {
      info: { id: string; name: string; location: 'host-local' | 'cloud'; languages: readonly string[] }
      transcribe(input: SpeechInput, signal: AbortSignal): Promise<Transcript>
    }): () => Promise<void>
  }
  effect(fn: () => (() => unknown) | void, label?: string): void
}

/** Распознать одну запись через context-ingest. */
export async function transcribe(ingestUrl: string, input: SpeechInput, signal: AbortSignal): Promise<Transcript> {
  const res = await fetch(`${ingestUrl}/transcribe`, {
    method: 'POST', body: new Uint8Array(input.audio), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  })
  const reply = (await res.json()) as Partial<Transcript> & { error?: string }
  if (!res.ok) throw new Error(reply.error ?? `context-ingest ${res.status}`)
  return { text: reply.text ?? '', audioSeconds: reply.audioSeconds ?? 0, inferenceSeconds: reply.inferenceSeconds ?? 0 }
}

export function apply(ctx: SpeechContext): void {
  const ingestUrl = (process.env.INGEST_URL ?? 'http://context-ingest:8090').replace(/\/$/, '')
  ctx.effect(() => ctx.speechToText.register({
    info: { id: PROVIDER_ID, name: 'GigaAM v3 (русский)', location: 'host-local', languages: ['ru'] },
    transcribe: (input, signal) => transcribe(ingestUrl, input, signal),
  }), 'customer-form: распознавание речи GigaAM')
}
