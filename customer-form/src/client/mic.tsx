/**
 * Потоковый микрофон портала (ADR-0008 rev4) — вместо штатного голосового
 * ввода dsh, который отправляет запись целиком после «Стоп».
 *
 * Звук идёт в AudioContext 16 кГц; речь режется на куски по паузам (2–7 с) прямо
 * во время записи, каждый кусок сразу уходит на узел
 * (/api/customer-form.dictate → speech-ru: облако, резерв GigaAM), а ответы по
 * порядку встают в строку ввода — текст появляется, пока заказчик говорит.
 * После «Стоп» остаётся дораспознать только последний кусок.
 */
import * as Primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { useEffect, useRef, useState, type ComponentType, type ReactElement } from 'react'
import type { InputActionsLike } from './panels.js'

const SR = 16000
const BLOCK = 4096 // ≈256 мс на 16 кГц
const MIN_CHUNK = 2 * SR
const MAX_CHUNK = 7 * SR
const PAUSE_BLOCKS = 2 // ≈0,5 с тишины — граница куска
const MAX_SECONDS = 600
/** Пик ниже этого — тишина (−50 дБFS); громкость паузы — от уровня шума. */
const SILENCE_PEAK = 10 ** (-50 / 20)

const P = Primitives as unknown as Record<string, ComponentType<Record<string, unknown>>>
const Button = P.Button
const MicIcon = P.IconMicrophoneOutlineRegular
const StopIcon = P.IconStopFillRegular

function wav(samples: Float32Array): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buffer)
  const put = (at: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)) }
  put(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); put(8, 'WAVE'); put(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true)
  v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true)
  return new Blob([buffer], { type: 'audio/wav' })
}

interface Props {
  sessionId?: string
  inputActions?: InputActionsLike
  locked?: boolean
  onActiveChange?: (active: boolean) => void
}

type Phase = 'idle' | 'recording' | 'finishing'

export function StreamingMic({ sessionId, inputActions, locked, onActiveChange }: Props): ReactElement {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [notice, setNotice] = useState<string>()
  const run = useRef<{ stop(): void } | undefined>(undefined)

  useEffect(() => () => run.current?.stop(), [])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(undefined), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  const start = async () => {
    if (phase !== 'idle' || !sessionId) return
    setNotice(undefined)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    } catch {
      setNotice('Нет доступа к микрофону. Разрешите его в настройках браузера и системы.')
      return
    }
    const audio = new AudioContext({ sampleRate: SR })
    const source = audio.createMediaStreamSource(stream)
    const processor = audio.createScriptProcessor(BLOCK, 1, 1)
    const startedAt = Date.now()

    let chunk: Float32Array[] = []
    let chunkLength = 0
    let chunkPeak = 0
    let quietBlocks = 0
    let overallPeak = 0
    let noiseFloor = 1
    let seq = 0
    let next = 0
    let inFlight = 0
    let said = '' // уже вставленный текст — хвост идёт подсказкой следующему куску
    const results = new Map<number, string>()
    let stopped = false
    let failed = 0

    const insert = (text: string) => {
      if (!text || !inputActions) return
      const piece = said ? ` ${text}` : text
      if (!inputActions.insertText(piece, inputActions.captureInsertion())) setNotice('Черновик занят — текст не вставлен.')
      said += piece
    }
    const flush = () => {
      while (results.has(next)) {
        insert(results.get(next)!)
        results.delete(next)
        next++
      }
      if (stopped && inFlight === 0) finish()
    }
    const send = (samples: Float32Array, peak: number) => {
      const id = seq++
      if (peak < SILENCE_PEAK) { results.set(id, ''); flush(); return } // пауза — в сеть не шлём
      inFlight++
      const url = `/api/customer-form.dictate?session=${encodeURIComponent(sessionId)}&prev=${encodeURIComponent(said.slice(-200))}`
      fetch(url, { method: 'POST', body: wav(samples) })
        .then(async (res) => {
          const reply = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
          if (!res.ok) throw new Error(reply.error ?? `HTTP ${res.status}`)
          results.set(id, (reply.text ?? '').trim())
        })
        .catch((e: Error) => { failed++; results.set(id, ''); setNotice(`Кусок не распознан: ${e.message}`) })
        .finally(() => { inFlight--; flush() })
    }
    const cut = () => {
      if (!chunkLength) return
      const samples = new Float32Array(chunkLength)
      let at = 0
      for (const part of chunk) { samples.set(part, at); at += part.length }
      send(samples, chunkPeak)
      chunk = []; chunkLength = 0; chunkPeak = 0; quietBlocks = 0
    }

    processor.onaudioprocess = (event) => {
      if (stopped) return
      const input = event.inputBuffer.getChannelData(0)
      const block = new Float32Array(input)
      let peak = 0, sum = 0
      for (let i = 0; i < block.length; i++) { const a = Math.abs(block[i]); if (a > peak) peak = a; sum += block[i] * block[i] }
      const rms = Math.sqrt(sum / block.length)
      noiseFloor = Math.min(noiseFloor * 1.02 + 1e-5, Math.max(rms, 1e-4)) // медленно поднимается, быстро падает
      overallPeak = Math.max(overallPeak, peak)
      chunk.push(block); chunkLength += block.length; chunkPeak = Math.max(chunkPeak, peak)
      quietBlocks = rms < Math.max(noiseFloor * 2.5, SILENCE_PEAK) ? quietBlocks + 1 : 0
      setLevel(Math.min(1, rms * 12))
      if ((chunkLength >= MIN_CHUNK && quietBlocks >= PAUSE_BLOCKS) || chunkLength >= MAX_CHUNK) cut()
    }
    source.connect(processor)
    processor.connect(audio.destination)

    const tick = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000)
      setSeconds(s)
      if (s >= MAX_SECONDS) stop()
    }, 250)

    const finish = () => {
      setPhase('idle')
      onActiveChange?.(false)
      run.current = undefined
      if (overallPeak < SILENCE_PEAK) setNotice('Микрофон передал тишину. Проверьте, что в браузере и в системе выбран нужный микрофон и он не выключен.')
      else if (!said && !failed) setNotice('Речь не распознана.')
    }
    const stop = () => {
      if (stopped) return
      stopped = true
      clearInterval(tick)
      processor.disconnect(); source.disconnect()
      stream.getTracks().forEach((t) => t.stop())
      void audio.close()
      cut()
      setPhase('finishing')
      flush()
    }
    run.current = { stop }
    setSeconds(0)
    setPhase('recording')
    onActiveChange?.(true)
  }

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }} data-streaming-mic={phase}>
      {phase === 'idle'
        ? <Button size="sm" disabled={locked || !sessionId} aria-label="Начать запись" title="Надиктовать"
            onMouseDown={(e: MouseEvent) => e.preventDefault()} onClick={() => { void start() }}>
            <MicIcon size={18} />
          </Button>
        : <>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: phase === 'recording' ? '#e5484d' : '#888' }} />
            <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, opacity: 0.8 }}>{phase === 'recording' ? clock : 'Дописываю…'}</span>
            {phase === 'recording' && (
              <span aria-hidden style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
                {[0.35, 0.7, 1].map((k) => <span key={k} style={{ width: 3, borderRadius: 1, background: 'currentColor', opacity: 0.7, height: `${Math.max(3, Math.min(14, level * 14 / k))}px` }} />)}
              </span>
            )}
            <Button size="sm" disabled={phase !== 'recording'} aria-label="Остановить и распознать" title="Стоп"
              onMouseDown={(e: MouseEvent) => e.preventDefault()} onClick={() => run.current?.stop()}>
              <StopIcon size={16} />
            </Button>
          </>}
      {notice && (
        <span role="status" style={{ position: 'absolute', right: 0, bottom: 'calc(100% + 8px)', width: 280, padding: '6px 10px', borderRadius: 8, fontSize: 12, lineHeight: 1.4, background: 'var(--dsw-alias-bg-l2, #222)', color: 'inherit', boxShadow: '0 4px 14px rgba(0,0,0,.25)' }}>
          {notice}
        </span>
      )}
    </span>
  )
}
