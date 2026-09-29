/**
 * Шторка заметки к разделу документа: PO надиктовывает правку, а не печатает.
 *
 * Распознавание — браузерное (Web Speech API, `ru-RU`, с промежуточным текстом): голосовой
 * ввод харнесса (SenseVoice) русского не знает. Где браузер распознавать не умеет (часть
 * установленных PWA на iOS), остаётся поле: у клавиатуры iOS свой микрофон, и диктовка
 * туда работает всегда. Текст в поле правится руками в любом случае — распознавание
 * ошибается в терминах.
 *
 * Запись не стартует сама: iOS даёт микрофон только по жесту, а шторка открывается по
 * таймеру долгого нажатия, не по касанию.
 */
import { useEffect, useRef, useState } from 'react'
import type { BftLocaleKey } from './locales.js'
import { panelClassNames as css } from './Panel.styles.js'

interface RecognitionResultLike { isFinal: boolean; 0: { transcript: string } }
interface RecognitionEventLike { resultIndex: number; results: { length: number; [index: number]: RecognitionResultLike } }
interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionCtor = new () => RecognitionLike

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export interface VoiceNoteSheetProps {
  t: (key: BftLocaleKey) => string
  section: string
  /** Уже записанная заметка к разделу — правится, а не пишется заново. */
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}

export function VoiceNoteSheet({ t, section, initialText, onSave, onCancel }: VoiceNoteSheetProps) {
  const [text, setText] = useState(initialText)
  const [interim, setInterim] = useState('')
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const baseRef = useRef(initialText)
  const supported = recognitionCtor() !== undefined

  useEffect(() => () => { recognitionRef.current?.abort() }, [])

  useEffect(() => {
    if (!recording) return
    setSeconds(0)
    const timer = window.setInterval(() => { setSeconds(s => s + 1) }, 1000)
    return () => { window.clearInterval(timer) }
  }, [recording])

  const stop = () => {
    recognitionRef.current?.stop()
  }

  const startRecording = () => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    setError(null)
    const recognition = new Ctor()
    recognition.lang = 'ru-RU'
    recognition.continuous = true
    recognition.interimResults = true
    baseRef.current = text
    let finals = ''
    recognition.onresult = (event) => {
      let pending = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result.isFinal) finals += result[0].transcript
        else pending += result[0].transcript
      }
      const base = baseRef.current
      const joined = [base, finals.trim()].filter(Boolean).join(base && finals.trim() ? ' ' : '')
      setText(joined)
      setInterim(pending)
    }
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setError(t('noteMicDenied'))
      else if (event.error && event.error !== 'aborted' && event.error !== 'no-speech') setError(t('noteMicFailed'))
    }
    recognition.onend = () => {
      setRecording(false)
      setInterim('')
      recognitionRef.current = null
    }
    try {
      recognition.start()
      recognitionRef.current = recognition
      setRecording(true)
    } catch {
      setError(t('noteMicFailed'))
    }
  }

  const save = () => {
    recognitionRef.current?.abort()
    const value = [text, interim].filter(Boolean).join(' ').trim()
    if (value) onSave(value)
    else onCancel()
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className={css.noteScrim} onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <div className={css.noteSheet} role="dialog" aria-label={`${t('noteTitle')}: ${section}`}>
        <span className={css.noteGrabber} aria-hidden="true" />
        <div className={css.noteHead}>
          <span className={css.noteCaption}>{t('noteTitle')}</span>
          <span className={css.noteSection}>{section}</span>
        </div>

        {recording && (
          <div className={css.noteRecording} role="status">
            <span className={css.noteDot} aria-hidden="true" />
            <span className={css.noteWave} aria-hidden="true" />
            <span className={css.noteTimer}>{mmss}</span>
          </div>
        )}

        <textarea
          className={css.noteText}
          value={interim ? `${text}${text ? ' ' : ''}${interim}` : text}
          placeholder={supported ? t('notePlaceholder') : t('notePlaceholderKeyboard')}
          aria-label={t('noteTitle')}
          readOnly={recording}
          rows={3}
          onChange={(event) => { setText(event.target.value) }}
        />
        {error && <p className={css.noteError} role="status">{error}</p>}

        <div className={css.noteActions}>
          <button type="button" className={css.noteSecondary} onClick={onCancel}>{t('noteCancel')}</button>
          {supported && (
            <button
              type="button"
              className={css.noteMic}
              data-recording={recording ? '' : undefined}
              aria-label={recording ? t('noteStop') : t('noteRecord')}
              onClick={recording ? stop : startRecording}
            >
              {recording
                ? <span className={css.noteStopGlyph} aria-hidden="true" />
                : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                  </svg>
                  )}
            </button>
          )}
          <button type="button" className={css.notePrimary} onClick={save}>{t('noteSave')}</button>
        </div>
      </div>
    </div>
  )
}
