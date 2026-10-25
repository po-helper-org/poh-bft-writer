/**
 * speech-ru · распознавание русской речи для голосового ввода dsh (ADR-0008).
 *
 * Регистрирует в ctx.speechToText один провайдер «ru-speech» с цепочкой:
 *
 *  1. проверка уровня: цифровая тишина → понятная ошибка про микрофон, а не
 *     «Речь не распознана»;
 *  2. облако — Requesty (OpenAI-совместимый /audio/transcriptions),
 *     openai/gpt-4o-mini-transcribe с language=ru и подсказкой терминов
 *     (prompt): лучшее качество на живой речи, ≈2 с на фразу;
 *  3. резерв — локальный GigaAM v3 (context-ingest POST /transcribe), если
 *     облако не ответило вовремя, вернуло ошибку или нет ключа.
 *
 * Резерв — внутри одного провайдера: реестр dsh сам ничего не переключает
 * («no fallback sends audio elsewhere»), а выбор маршрута — решение этого
 * плагина и его конфигурации (mode: local-only — запись не покидает контур).
 */
import { level, SILENCE_PEAK } from './wave.js'

export const name = 'speech-ru'
export const inject = ['speechToText']

export interface Config {
  /** Идентификатор провайдера в ctx.speechToText. */
  providerId?: string
  /** cloud-first — Requesty, при сбое GigaAM; local-only — только GigaAM. */
  mode?: 'cloud-first' | 'local-only'
  baseURL?: string
  apiKeyEnv?: string
  model?: string
  /** Подсказка распознавателю: термины и имена, которые он должен писать верно. */
  prompt?: string
  cloudTimeoutMs?: number
  /** context-ingest; пусто — без локального резерва. */
  localUrl?: string
}

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

const DEFAULTS = {
  providerId: 'ru-speech',
  mode: 'cloud-first',
  baseURL: 'https://router.requesty.ai/v1',
  apiKeyEnv: 'REQUESTY_API_KEY',
  model: 'openai/gpt-4o-mini-transcribe',
  prompt: 'Заказчик диктует инициативу для системы БФТ: бизнес-функциональные требования, заявка, беклог, JIRA, Confluence, 1С, ЗУП, HowToDemo.',
  cloudTimeoutMs: 20_000,
  localUrl: process.env.INGEST_URL ?? 'http://context-ingest:8090',
} satisfies Required<Config>

export type Resolved = Required<Config>

export function resolveConfig(config: Config = {}): Resolved {
  const merged = { ...DEFAULTS, ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) } as Resolved
  return { ...merged, baseURL: merged.baseURL.replace(/\/$/, ''), localUrl: merged.localUrl.replace(/\/$/, '') }
}

/** Requesty → gpt-4o-mini-transcribe, язык зафиксирован: ru. */
export async function transcribeCloud(config: Resolved, apiKey: string, audio: Uint8Array, signal: AbortSignal): Promise<string> {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'speech.wav')
  form.set('model', config.model)
  form.set('language', 'ru')
  form.set('response_format', 'json')
  if (config.prompt) form.set('prompt', config.prompt)
  const res = await fetch(`${config.baseURL}/audio/transcriptions`, {
    method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form,
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.cloudTimeoutMs)]),
  })
  const reply = (await res.json().catch(() => ({}))) as { text?: string; error?: { message?: string } }
  if (!res.ok) throw new Error(`Requesty ${res.status}: ${reply.error?.message ?? 'ошибка распознавания'}`)
  return (reply.text ?? '').trim()
}

/** GigaAM v3 в context-ingest — офлайн, внутри compose-сети. */
export async function transcribeLocal(config: Resolved, audio: Uint8Array, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${config.localUrl}/transcribe`, {
    method: 'POST', body: new Uint8Array(audio), signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  })
  const reply = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
  if (!res.ok) throw new Error(reply.error ?? `context-ingest ${res.status}`)
  return (reply.text ?? '').trim()
}

/** Вся цепочка: уровень → облако → резерв. Экспортирована для тестов. */
export async function recognize(config: Resolved, audio: Uint8Array, signal: AbortSignal, log = (_: string) => {}): Promise<Transcript> {
  const started = performance.now()
  const sound = level(audio)
  const done = (text: string, route: string): Transcript => {
    const inferenceSeconds = (performance.now() - started) / 1000
    log(`${route}: ${sound.seconds.toFixed(1)} с, пик ${sound.peak.toFixed(3)} → ${text.length} симв. за ${inferenceSeconds.toFixed(2)} с`)
    return { text, audioSeconds: sound.seconds, inferenceSeconds }
  }
  if (sound.peak < SILENCE_PEAK) {
    log(`тишина: ${sound.seconds.toFixed(1)} с, пик ${sound.peak.toFixed(4)}, RMS ${sound.rmsDb.toFixed(0)} дБ`)
    throw new Error('микрофон передал тишину. Проверьте, что в браузере и в системе выбран нужный микрофон и он не выключен')
  }

  const apiKey = process.env[config.apiKeyEnv]
  let cloudError: Error | undefined
  if (config.mode === 'cloud-first' && apiKey) {
    try {
      const text = await transcribeCloud(config, apiKey, audio, signal)
      if (text) return done(text, 'облако')
      cloudError = new Error('облако вернуло пустой текст')
    } catch (e) {
      if (signal.aborted) throw e
      cloudError = e as Error
    }
    log(`облако не распознало (${cloudError.message}) — резерв GigaAM`)
  }
  if (!config.localUrl) throw cloudError ?? new Error(`нет ключа ${config.apiKeyEnv} и локального распознавателя`)
  return done(await transcribeLocal(config, audio, signal), cloudError ? 'резерв' : 'локально')
}

export function apply(ctx: SpeechContext, raw: Config = {}): void {
  const config = resolveConfig(raw)
  const cloud = config.mode === 'cloud-first' && !!process.env[config.apiKeyEnv]
  ctx.effect(() => ctx.speechToText.register({
    info: {
      id: config.providerId,
      name: cloud ? 'Русская речь (gpt-4o-mini-transcribe, резерв GigaAM)' : 'Русская речь (GigaAM, локально)',
      location: cloud ? 'cloud' : 'host-local',
      languages: ['ru'],
    },
    transcribe: (input, signal) => recognize(config, input.audio, signal, (line) => console.log(`[speech-ru] ${line}`)),
  }), 'speech-ru: распознавание русской речи')
}
