/**
 * Уровень сигнала записи микрофона: голосовой ввод dsh присылает канонический
 * WAV 16 кГц моно PCM16. Нужен, чтобы отличать «микрофон передал тишину»
 * (не то устройство, выключен в системе, браузер без доступа) от «речь не
 * распознана» — первое заказчик может исправить сам.
 */
export interface Level {
  seconds: number
  /** Пик по модулю, 0…1. */
  peak: number
  /** Среднеквадратичный уровень, дБFS (−∞ для цифровой тишины). */
  rmsDb: number
}

/** Пик ниже этого — тишина: −50 дБFS, ниже шума любого живого микрофона. */
export const SILENCE_PEAK = 10 ** (-50 / 20)

export function level(wav: Uint8Array): Level {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  const tag = (at: number) => String.fromCharCode(wav[at], wav[at + 1], wav[at + 2], wav[at + 3])
  if (wav.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('запись не в формате WAV')
  let sampleRate = 16000
  let channels = 1
  for (let at = 12; at + 8 <= wav.byteLength;) {
    const size = view.getUint32(at + 4, true)
    if (tag(at) === 'fmt ') {
      channels = view.getUint16(at + 10, true)
      sampleRate = view.getUint32(at + 12, true)
    } else if (tag(at) === 'data') {
      const end = Math.min(at + 8 + size, wav.byteLength)
      let peak = 0
      let sum = 0
      let n = 0
      for (let i = at + 8; i + 1 < end; i += 2, n++) {
        const v = view.getInt16(i, true) / 32768
        const a = Math.abs(v)
        if (a > peak) peak = a
        sum += v * v
      }
      const rms = n ? Math.sqrt(sum / n) : 0
      return { seconds: n / channels / sampleRate, peak, rmsDb: rms > 0 ? 20 * Math.log10(rms) : -Infinity }
    }
    at += 8 + size + (size & 1)
  }
  throw new Error('в WAV нет данных')
}
