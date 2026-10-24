/**
 * Онбординг первого запуска (US-5–8): полноэкранный оверлей поверх шелла.
 *
 * Показывается решением самого компонента: стейт приходит RPC `onboardingState`,
 * и `done` (пройден или пропущен) гасит оверлей навсегда — без отдельного флага
 * «показан» в сторе. Слайды — данные из src/onboarding.ts, здесь только рендер.
 * Стили инлайном: оверлей живёт поверх чужого шелла один раз при первом запуске,
 * тянуть его в Panel.styles незачем.
 */
import { useEffect, useState } from 'react'

import type { RpcResult } from '../channel.js'
import {
  ONBOARDING_SLIDES, type DictationMode, type OnboardingState,
} from '../onboarding.js'

export type OnboardingCall = (endpoint: string, payload?: unknown) => Promise<RpcResult<unknown>>

interface CheckOutcome { ok: boolean; message: string }

const s = {
  veil: {
    position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
  } as React.CSSProperties,
  card: {
    width: 'min(680px, calc(100vw - 48px))', background: 'var(--dsh-bg-elevated, #fff)',
    color: 'inherit', borderRadius: '14px', padding: '28px 30px', boxShadow: '0 24px 64px rgba(2,6,23,0.35)',
  } as React.CSSProperties,
  title: { fontSize: '19px', fontWeight: 700, margin: '0 0 10px' } as React.CSSProperties,
  body: { fontSize: '14px', lineHeight: 1.6, margin: '0 0 18px', opacity: 0.9 } as React.CSSProperties,
  row: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '18px' } as React.CSSProperties,
  input: {
    flex: 1, padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsh-border, #cbd5e1)',
    background: 'var(--dsh-bg, #fff)', color: 'inherit', fontSize: '13px', fontFamily: 'ui-monospace, monospace',
  } as React.CSSProperties,
  btn: {
    padding: '8px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px',
    fontWeight: 600, background: '#0f62fe', color: '#fff',
  } as React.CSSProperties,
  ghost: {
    padding: '8px 10px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px',
    background: 'transparent', color: 'inherit', opacity: 0.75,
  } as React.CSSProperties,
  dots: { display: 'flex', gap: '6px', marginTop: '22px' } as React.CSSProperties,
  dot: (active: boolean) => ({
    width: active ? 18 : 7, height: 7, borderRadius: '4px', transition: 'width .2s',
    background: active ? '#0f62fe' : 'var(--dsh-border, #cbd5e1)',
  }) as React.CSSProperties,
  note: { fontSize: '12.5px', marginTop: '12px', opacity: 0.8 } as React.CSSProperties,
  warn: { color: '#b91c1c' } as React.CSSProperties,
}

export function Onboarding({ call }: { call: OnboardingCall }) {
  const [state, setState] = useState<OnboardingState | null>(null)
  const [ready, setReady] = useState(false)
  const [slide, setSlide] = useState(0)
  const [key, setKey] = useState('')
  const [check, setCheck] = useState<CheckOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [dictation, setDictation] = useState<DictationMode>('browser')
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [finalHint, setFinalHint] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await call('onboardingState')
      if (res.ok) setState(res.value as OnboardingState)
      setReady(true)
    })()
  }, [call])

  if (!ready || !state || state.done) return null

  const last = slide === ONBOARDING_SLIDES.length - 1

  const doCheck = async () => {
    setBusy(true); setCheck(null)
    const res = await call('onboardingCheckKey', { key })
    if (res.ok) setCheck(res.value as CheckOutcome)
    else setCheck({ ok: false, message: res.error.message })
    setBusy(false)
  }

  const doComplete = async () => {
    setBusy(true)
    const res = await call('onboardingComplete', { key, dictation })
    setBusy(false)
    if (res.ok) setFinalHint((res.value as { restartHint: string }).restartHint)
    else setCheck({ ok: false, message: res.error.message })
  }

  const doSkip = async () => {
    await call('onboardingSkip')
    setState({ ...state, done: true })
  }

  const chooseDictation = async (mode: DictationMode) => {
    setDictation(mode)
    await call('onboardingDictation', { mode })
  }

  if (finalHint) {
    return (
      <div style={s.veil}>
        <div style={s.card}>
          <h3 style={s.title}>Готово</h3>
          <p style={s.body}>{finalHint}</p>
          <button style={s.btn} onClick={() => setState({ ...state, done: true })}>Понятно</button>
        </div>
      </div>
    )
  }

  const current = ONBOARDING_SLIDES[slide]

  return (
    <div style={s.veil}>
      <div style={s.card}>
        <h3 style={s.title}>{current.title}</h3>
        <p style={s.body}>{current.body}</p>

        {last && (
          <>
            <div style={s.row}>
              <input
                style={s.input}
                type="password"
                placeholder="API-ключ Z.AI (форма id.secret)"
                value={key}
                onChange={(e) => { setKey(e.target.value); setCheck(null) }}
                spellCheck={false}
              />
              <button style={s.btn} disabled={busy || !key.trim()} onClick={() => void doCheck()}>Проверить</button>
            </div>
            {check && <p style={{ ...s.note, ...(check.ok ? {} : s.warn) }}>{check.message}</p>}

            <p style={s.note}>Голосовой ввод:
              {' '}
              <button style={{ ...s.ghost, ...(dictation === 'browser' ? { opacity: 1, fontWeight: 700 } : {}) }} onClick={() => void chooseDictation('browser')}>
                браузерный (быстро; аудио идёт в сервис распознавания)
              </button>
              {' · '}
              <button style={{ ...s.ghost, ...(dictation === 'local' ? { opacity: 1, fontWeight: 700 } : {}) }} onClick={() => void chooseDictation('local')}>
                локальный (whisper; приватно)
              </button>
            </p>
          </>
        )}

        <div style={s.row}>
          {slide > 0 && <button style={s.ghost} onClick={() => setSlide(slide - 1)}>Назад</button>}
          <span style={{ flex: 1 }} />
          {!last
            ? <button style={s.btn} onClick={() => setSlide(slide + 1)}>Дальше</button>
            : <button style={s.btn} disabled={busy || !check?.ok} onClick={() => void doComplete()}>Готово</button>}
          {!last && (
            confirmSkip
              ? <button style={{ ...s.ghost, ...s.warn }} onClick={() => void doSkip()}>
                  Точно пропустить? Без ключа fast-прогон не работает
                </button>
              : <button style={s.ghost} onClick={() => setConfirmSkip(true)}>Пропустить</button>
          )}
        </div>

        <div style={s.dots}>
          {ONBOARDING_SLIDES.map((sl, i) => (
            <span key={sl.id} style={s.dot(i === slide)} />
          ))}
        </div>
      </div>
    </div>
  )
}
