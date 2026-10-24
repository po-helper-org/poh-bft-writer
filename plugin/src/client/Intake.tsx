/**
 * Интейк (US-9–13): главная форма ввода требования.
 *
 * Строка-текстарея, голос (браузерный по умолчанию, локальный — запись файлом,
 * расшифровка на стороне скилла), вложения и ссылки-чипы. Файлы грузятся
 * сразу (/api/bft.intakeUpload) и становятся «путями в воркспейсе» — контракт
 * скилла bft-fast: источник = путь. Отправка в fast-сессию — Т8; здесь
 * «Отправить» фиксирует собранный ввод и показывает, что готово к запуску.
 */
import { useEffect, useRef, useState } from 'react'

import type { RpcResult } from '../channel.js'
import { dictationFilename, parseLinks, validateIntake } from '../intake.js'
import { panelClassNames as css } from './Panel.styles.js'

export type IntakeCall = (endpoint: string, payload?: unknown) => Promise<RpcResult<unknown>>

interface Upload { name: string; path?: string; error?: string; uploading: boolean }

export interface IntakeProps {
  call: IntakeCall
  onBack: () => void
}

async function uploadFile(call: IntakeCall, slug: string, file: File): Promise<Upload> {
  const headers: Record<string, string> = {
    'content-type': 'application/octet-stream',
    'x-bft-filename': encodeURIComponent(file.name),
    'x-bft-slug': slug,
  }
  try {
    const res = await fetch('/api/bft.intakeUpload', {
      method: 'POST', headers, body: await file.arrayBuffer(),
    })
    const json = (await res.json()) as { path?: string; error?: string }
    if (!res.ok || !json.path) return { name: file.name, uploading: false, error: json.error ?? `HTTP ${res.status}` }
    return { name: file.name, path: json.path, uploading: false }
  } catch (e) {
    return { name: file.name, uploading: false, error: String(e) }
  }
}

/** Слаг для папки вложений: первые слова ввода или 'intake'. */
function slugOf(text: string): string {
  const words = text.trim().toLowerCase().split(/\s+/).slice(0, 4).join('-')
  return words || 'intake'
}

export function Intake({ call, onBack }: IntakeProps) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Upload[]>([])
  const [dictation, setDictation] = useState<'browser' | 'local'>('browser')
  const [listening, setListening] = useState(false)
  const [recording, setRecording] = useState(false)
  const [submitted, setSubmitted] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void (async () => {
      const res = await call('onboardingState')
      if (res.ok) {
        const st = res.value as { dictation?: 'browser' | 'local' }
        if (st.dictation) setDictation(st.dictation)
      }
    })()
  }, [call])

  const links = parseLinks(text)
  const verdict = validateIntake(text, files.filter((f) => f.path).map((f) => f.path!))

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const incoming = Array.from(list)
    setFiles((prev) => [...prev, ...incoming.map((f) => ({ name: f.name, uploading: true }))])
    const slug = slugOf(text)
    void Promise.all(incoming.map(async (f, i) => {
      const done = await uploadFile(call, slug, f)
      setFiles((prev) => prev.map((p, j) => {
        // Последние len(incoming) — наши; мэтчим по имени и позиции добавления.
        const idx = prev.length - incoming.length + i
        return j === idx ? done : p
      }))
    }))
  }

  const toggleListening = () => {
    // Браузерный режим: Web Speech; аудио уходит в сервис распознавания —
    // онбординг предупредил, локальный режим ниже пишет файл.
    const w = window as unknown as { webkitSpeechRecognition?: new () => any; SpeechRecognition?: new () => any }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor) { setText((t) => t + (t ? ' ' : '') + '[браузер не поддерживает распознавание: приложите запись]'); return }
    if (listening) return
    const rec = new Ctor()
    rec.lang = 'ru-RU'
    rec.interimResults = false
    rec.continuous = true
    rec.onresult = (e: any) => {
      let chunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript
      setText((t) => (t ? t + ' ' : '') + chunk.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.start()
    setListening(true)
  }

  const toggleRecording = async () => {
    if (recording) { recorder.current?.stop(); setRecording(false); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      const chunks: Blob[] = []
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const file = new File([blob], dictationFilename(), { type: 'audio/webm' })
        addFiles({ [Symbol.iterator]: function* () { yield file } } as unknown as FileList)
      }
      recorder.current = mr
      mr.start()
      setRecording(true)
    } catch {
      setText((t) => t + ' [микрофон недоступен]')
    }
  }

  const submit = () => {
    if (!verdict.ok) return
    const ready = files.filter((f) => f.path)
    setSubmitted(
      `Готово к запуску: ${ready.length} файл(ов) в воркспейсе, ссылок: ${links.length}. ` +
      'Fast-прогон подключается следующим шагом (Т8).',
    )
  }

  return (
    <>
      <div className={css.header}>
        <button type="button" className={css.iconButton} aria-label="К списку" onClick={onBack}>←</button>
        <h2>Новая инициатива</h2>
      </div>
      <div className={css.body}>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setSubmitted(null) }}
          placeholder="Опишите требование: текст, вставьте ссылку, надиктуйте или прикрепите файлы…"
          rows={5}
          style={{ width: '100%', resize: 'vertical', padding: '10px', borderRadius: '8px', border: '1px solid var(--dsh-border, #cbd5e1)', background: 'var(--dsh-bg, #fff)', color: 'inherit', fontSize: '13.5px', fontFamily: 'inherit' }}
        />

        <div style={{ display: 'flex', gap: '8px', margin: '8px 0', flexWrap: 'wrap' }}>
          <button type="button" className={css.iconButton} title="Прикрепить файлы, фото, PDF" onClick={() => fileInput.current?.click()}>📎</button>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.currentTarget.value = '' }} />
          {dictation === 'browser'
            ? <button type="button" className={css.iconButton} title="Диктовка (браузерное распознавание)" onClick={toggleListening}>{listening ? '⏹' : '🎤'}</button>
            : <button type="button" className={css.iconButton} title="Запись локально (файлом)" onClick={() => void toggleRecording()}>{recording ? '⏹' : '🎙'}</button>}
          <span style={{ flex: 1 }} />
          <button type="button" className={css.iconButton} style={{ fontWeight: 700 }} disabled={!verdict.ok} title={verdict.reason ?? ''} onClick={submit}>Отправить →</button>
        </div>

        {files.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0', fontSize: '12.5px' }}>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} style={{ opacity: f.error ? 1 : 0.85, color: f.error ? '#b91c1c' : 'inherit' }}>
                {f.uploading ? `⏳ ${f.name}` : f.error ? `✗ ${f.name}: ${f.error}` : `✓ ${f.name}`}
                {f.path && <code style={{ marginLeft: 6, fontSize: 11 }}>{f.path}</code>}
              </li>
            ))}
          </ul>
        )}

        {links.length > 0 && (
          <p style={{ fontSize: '12.5px', opacity: 0.85, margin: '6px 0' }}>
            Источники: {links.map((l) => <code key={l} style={{ marginRight: 6 }}>{l}</code>)}
          </p>
        )}

        {!verdict.ok && text.trim() === '' && files.length === 0 && (
          <p style={{ fontSize: '12.5px', color: '#b45309', margin: '6px 0' }}>{verdict.reason}</p>
        )}
        {submitted && <p style={{ fontSize: '13px', fontWeight: 600, margin: '10px 0' }}>{submitted}</p>}

        <p style={{ fontSize: '11.5px', opacity: 0.65, marginTop: '12px' }}>
          Голос: {dictation === 'browser' ? 'браузерное распознавание' : 'локальная запись файлом'}. Файлы остаются в вашей системе.
        </p>
      </div>
    </>
  )
}
