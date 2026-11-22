/**
 * Онбординг первого запуска (US-5–8, 42; R7-правки владельца):
 *
 *  — качественный слайдер: 5 шагов с иллюстрациями, прогресс-точками,
 *    заголовками; без зависимости от CSS-переменных харнесса (жёсткие
 *    фолбэки), чтобы пустых экранов не бывало;
 *  — «Пропустить» видно на каждом слайде (внизу, двухшаговое подтверждение
 *    с честным предупреждением про fast без ключа);
 *  — завершённость помним и в БРАУЗЕРЕ (localStorage `bft.onboarding.done`):
 *    повторное открытие в этом браузере не показывает оверлей, даже если
 *    хост ещё не записал флаг (или RPC недоступен). Хост-флаг остаётся
 *    авторитетом для других браузеров (ADR: onboarding.json в DSH_HOME).
 *
 * Если стейт не пришёл (RPC упал/таймаут 3с) — показываем всё равно:
 * пустой экран хуже лишнего слайда.
 */
import { useEffect, useRef, useState } from 'react'

import type { RpcResult } from '../channel.js'
import {
  ONBOARDING_SLIDES, type DictationMode, type OnboardingState,
} from '../onboarding.js'

export type OnboardingCall = (endpoint: string, payload?: unknown) => Promise<RpcResult<unknown>>

interface CheckOutcome { ok: boolean; message: string }

const LS_DONE = 'bft.onboarding.done'

/** Иллюстрации шагов: крупные, читаемые, без внешних ассетов. */
const ART: Record<string, string> = {
  intro: '📋', input: '🎙📎🔗', minute: '⚡', board: '📊', connect: '🔑',
}

const c = {
  veil: {
    position: 'fixed', inset: 0, zIndex: 90, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(9, 14, 26, 0.62)',
    backdropFilter: 'blur(3px)', fontFamily: 'inherit',
  } as React.CSSProperties,
  card: {
    width: 'min(720px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 60px)', overflow: 'auto',
    background: '#ffffff', color: '#1a2233', borderRadius: '16px', padding: '30px 34px 22px',
    boxShadow: '0 28px 80px rgba(2, 6, 23, 0.45)',
  } as React.CSSProperties,
  art: { fontSize: '44px', lineHeight: 1, margin: '0 0 14px' } as React.CSSProperties,
  step: { fontSize: '11px', fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: '#0f62fe', margin: '0 0 6px' } as React.CSSProperties,
  title: { fontSize: '21px', fontWeight: 800, letterSpacing: '-.01em', margin: '0 0 10px' } as React.CSSProperties,
  body: { fontSize: '14px', lineHeight: 1.65, margin: '0 0 6px', color: '#3d4759' } as React.CSSProperties,
  input: {
    width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #c9d2e0',
    background: '#ffffff', color: '#1a2233', fontSize: '13px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  } as React.CSSProperties,
  btn: {
    padding: '10px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer',
    fontSize: '14px', fontWeight: 700, background: '#0f62fe', color: '#ffffff',
  } as React.CSSProperties,
  btnGhost: {
    padding: '10px 14px', borderRadius: '10px', border: '1px solid #c9d2e0', cursor: 'pointer',
    fontSize: '13px', fontWeight: 600, background: 'transparent', color: '#1a2233',
  } as React.CSSProperties,
  row: { display: 'flex', gap: '10px', alignItems: 'center', marginTop: '18px' } as React.CSSProperties,
  dots: { display: 'flex', gap: '7px', alignItems: 'center', marginTop: '20px' } as React.CSSProperties,
  dot: (active: boolean) => ({
    width: active ? 22 : 8, height: 8, borderRadius: '4px',
    transition: 'width .18s ease', background: active ? '#0f62fe' : '#c9d2e0', border: 'none',
  }) as React.CSSProperties,
  note: { fontSize: '12.5px', marginTop: '10px', color: '#5b6572' } as React.CSSProperties,
  warn: { color: '#b91c1c', fontWeight: 600 } as React.CSSProperties,
  skipRow: { display: 'flex', justifyContent: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #e6eaf1' } as React.CSSProperties,
  skip: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '12.5px', color: '#8a94a3' } as React.CSSProperties,
}

function lsDone(): boolean {
  try { return window.localStorage.getItem(LS_DONE) === 'done' } catch { return false }
}
function lsMark(): void {
  try { window.localStorage.setItem(LS_DONE, 'done') } catch { /* приватный режим — переживём */ }
}

export function Onboarding({ call }: { call: OnboardingCall }) {
  // Браузерный факт завершённости: даже до ответа хоста.
  const [state, setState] = useState<OnboardingState | null>(lsDone() ? { done: true, hasKey: false, keyActive: false, dictation: 'browser' } : null)
  const [slide, setSlide] = useState(0)
  const [key, setKey] = useState('')
  const [check, setCheck] = useState<CheckOutcome | null>(null)
  const [busy, setBusy] = useState(false)
  const [dictation, setDictation] = useState<DictationMode>('browser')
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [finalHint, setFinalHint] = useState<string | null>(null)
  const settled = useRef(false)

  useEffect(() => {
    void (async () => {
      // Таймаут-фолбэк: RPC не ответил за 3с — показываем слайды без стейта
      // (лучше лишний показ, чем пустой экран — R7-правка владельца).
      const timer = window.setTimeout(() => { settled.current = true }, 3000)
      const res = await call('onboardingState')
      window.clearTimeout(timer)
      if (settled.current) return
      settled.current = true
      if (res.ok) {
        const st = res.value as OnboardingState
        setState(st)
        if (st.done) lsMark()   // хост уже сказал «пройден» — фиксируем и здесь
        setDictation(st.dictation ?? 'browser')
      } else {
        setState(prev => prev ?? { done: false, hasKey: false, keyActive: false, dictation: 'browser' })
      }
    })()
  }, [call])

  if (!state || state.done) return null

  const last = slide === ONBOARDING_SLIDES.length - 1
  const current = ONBOARDING_SLIDES[slide]

  const doCheck = async () => {
    setBusy(true); setCheck(null)
    const res = await call('onboardingCheckKey', { key })
    setCheck(res.ok ? res.value as CheckOutcome : { ok: false, message: res.error.message })
    setBusy(false)
  }

  const finish = async (mode: 'complete' | 'skip') => {
    if (mode === 'complete') {
      setBusy(true)
      const res = await call('onboardingComplete', { key, dictation })
      setBusy(false)
      if (res.ok) { lsMark(); setFinalHint((res.value as { restartHint: string }).restartHint); return }
      setCheck({ ok: false, message: res.error.message }); return
    }
    await call('onboardingSkip')
    lsMark()
    setState({ ...state, done: true })
  }

  const chooseDictation = async (mode: DictationMode) => {
    setDictation(mode)
    await call('onboardingDictation', { mode })
  }

  if (finalHint) {
    return (
      <div style={c.veil}>
        <div style={c.card}>
          <p style={c.art}>✅</p>
          <h3 style={c.title}>Готово — ключ сохранён</h3>
          <p style={c.body}>{finalHint}</p>
          <div style={c.row}>
            <button style={c.btn} onClick={() => setState({ ...state, done: true })}>Понятно</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={c.veil}>
      <div style={c.card}>
        <p style={c.step}>Шаг {slide + 1} из {ONBOARDING_SLIDES.length}</p>
        <p style={c.art}>{ART[current.id] ?? '📌'}</p>
        <h3 style={c.title}>{current.title}</h3>
        <p style={c.body}>{current.body}</p>

        {last && (
          <>
            <div style={{ ...c.row, marginTop: 12 }}>
              <input
                style={c.input}
                type="password"
                placeholder="API-ключ Z.AI — форма id.secret (z.ai → API-ключи)"
                value={key}
                onChange={(e) => { setKey(e.target.value); setCheck(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) void doCheck() }}
                spellCheck={false}
                autoFocus
              />
              <button style={{ ...c.btn, opacity: busy || !key.trim() ? 0.5 : 1 }} disabled={busy || !key.trim()} onClick={() => void doCheck()}>Проверить</button>
            </div>
            {check && <p style={{ ...c.note, ...(check.ok ? {} : c.warn) }}>{check.message}</p>}

            <p style={c.note}>
              Голосовой ввод:{' '}
              <button style={{ ...c.skip, fontWeight: dictation === 'browser' ? 800 : 400, color: dictation === 'browser' ? '#1a2233' : '#8a94a3' }} onClick={() => void chooseDictation('browser')}>браузерный — быстро</button>
              {' · '}
              <button style={{ ...c.skip, fontWeight: dictation === 'local' ? 800 : 400, color: dictation === 'local' ? '#1a2233' : '#8a94a3' }} onClick={() => void chooseDictation('local')}>локальный whisper — приватно</button>
            </p>
          </>
        )}

        <div style={c.row}>
          {slide > 0
            ? <button style={c.btnGhost} onClick={() => { setSlide(slide - 1); setConfirmSkip(false) }}>← Назад</button>
            : <span />}
          <span style={{ flex: 1 }} />
          {!last
            ? <button style={c.btn} onClick={() => setSlide(slide + 1)}>Далее →</button>
            : <button style={{ ...c.btn, opacity: !check?.ok || busy ? 0.5 : 1 }} disabled={!check?.ok || busy} onClick={() => void finish('complete')}>Готово</button>}
        </div>

        <div style={c.dots} role="tablist" aria-label="Шаги онбординга">
          {ONBOARDING_SLIDES.map((sl, i) => (
            <button key={sl.id} style={c.dot(i === slide)} aria-label={`Шаг ${i + 1}`} onClick={() => { setSlide(i); setConfirmSkip(false) }} />
          ))}
        </div>

        <div style={c.skipRow}>
          {confirmSkip ? (
            <button style={{ ...c.skip, ...c.warn, fontWeight: 700 }} onClick={() => void finish('skip')}>
              Да, пропустить — без ключа fast-прогон не заработает
            </button>
          ) : (
            <button style={c.skip} onClick={() => setConfirmSkip(true)}>Пропустить онбординг →</button>
          )}
        </div>
      </div>
    </div>
  )
}
