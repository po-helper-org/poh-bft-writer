/**
 * customer-form · браузерная половина: стартовый экран в каноне dsh.
 *
 * Переиспользуем визуал хоума харнесса (центрированный композер, приветствие,
 * кнопки вложений внутри поля) на примитивах и CSS-переменных dsh — своя
 * дизайн-система не заводится (решение владельца). Полноэкранный оверлей
 * закрывает хром харнесса: заказчик видит только экран заявки.
 */
// Type-only: слоты и примитивы харнесса.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { useEffect, useRef, useState } from 'react'

export const inject = ['@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-primitives']

/** Стиль канона dsh: переменные темы харнесса, скругления как у композера. */
const s = {
  screen: {
    position: 'fixed', inset: 0, zIndex: 90, overflow: 'auto',
    background: 'var(--dsh-bg, #fff)', color: 'var(--dsh-fg, inherit)',
    fontFamily: 'inherit', display: 'flex', flexDirection: 'column',
  } as React.CSSProperties,
  center: {
    width: 'min(720px, calc(100vw - 32px))', margin: '0 auto',
    flex: '1', display: 'flex', flexDirection: 'column', justifyContent: 'center',
    padding: '48px 0 32px',
  } as React.CSSProperties,
  brandRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 26 } as React.CSSProperties,
  brandMark: {
    width: 30, height: 30, borderRadius: 9, fontSize: 15, fontWeight: 800,
    background: 'var(--dsh-accent, #0f62fe)', color: '#fff',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
  brandName: { fontSize: 15, fontWeight: 700, letterSpacing: '-.01em' } as React.CSSProperties,
  h1: { fontSize: 28, fontWeight: 800, letterSpacing: '-.02em', margin: '0 0 8px' } as React.CSSProperties,
  sub: { fontSize: 14.5, opacity: 0.65, margin: '0 0 26px', lineHeight: 1.6 } as React.CSSProperties,
  who: { display: 'flex', gap: 8, margin: '0 0 10px' } as React.CSSProperties,
  input: {
    flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent',
    color: 'inherit', font: 'inherit', fontSize: 14,
    padding: '9px 12px', borderRadius: 9,
    borderBottom: '1px solid var(--dsh-border, #d5dbe4)',
  } as React.CSSProperties,
  composer: {
    border: '1px solid var(--dsh-border, #d5dbe4)', borderRadius: 18,
    background: 'var(--dsh-bg-elevated, var(--dsh-bg, #fff))',
    padding: '12px 14px 10px', boxShadow: '0 1px 3px rgba(16,24,40,0.06)',
  } as React.CSSProperties,
  area: {
    width: '100%', border: 'none', outline: 'none', resize: 'vertical', minHeight: 120,
    background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 15.5, lineHeight: 1.6,
  } as React.CSSProperties,
  composerBar: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 } as React.CSSProperties,
  iconBtn: {
    border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 17,
    padding: '7px 9px', borderRadius: 9, color: 'inherit', opacity: 0.8,
  } as React.CSSProperties,
  chips: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } as React.CSSProperties,
  chip: {
    display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5,
    border: '1px solid var(--dsh-border, #d5dbe4)', borderRadius: 8, padding: '4px 9px',
    background: 'var(--dsh-bg, #fff)', opacity: 0.9, maxWidth: 260, overflow: 'hidden',
    textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  } as React.CSSProperties,
  status: { fontSize: 12.5, opacity: 0.6, marginTop: 10, textAlign: 'center' } as React.CSSProperties,
  taskPill: {
    display: 'inline-block', marginTop: 12, padding: '9px 14px', borderRadius: 10,
    background: 'var(--dsh-accent-soft, #eef4ff)', color: 'var(--dsh-accent, #1d4ed8)',
    fontWeight: 700, fontSize: 13.5, textDecoration: 'none',
  } as React.CSSProperties,
  // чат
  chat: { display: 'flex', flexDirection: 'column', minHeight: 0 } as React.CSSProperties,
  msgs: { overflowY: 'auto', flex: 1, minHeight: 120, maxHeight: '44vh', padding: '4px 2px' } as React.CSSProperties,
  msg: {
    maxWidth: '86%', margin: '7px 0', padding: '10px 14px', borderRadius: 14,
    fontSize: 14.5, lineHeight: 1.6, whiteSpace: 'pre-wrap',
  } as React.CSSProperties,
  msgUser: {
    alignSelf: 'flex-end',
    background: 'var(--dsh-accent, #0f62fe)', color: '#fff',
    borderBottomRightRadius: 5,
  } as React.CSSProperties,
  msgBot: {
    alignSelf: 'flex-start',
    border: '1px solid var(--dsh-border, #d5dbe4)',
    background: 'var(--dsh-bg-elevated, var(--dsh-bg, #fff))',
    borderBottomLeftRadius: 5,
  } as React.CSSProperties,
  widget: {
    border: '1px solid var(--dsh-border, #d5dbe4)', borderRadius: 14,
    background: 'var(--dsh-bg-elevated, var(--dsh-bg, #fff))',
    padding: '12px 15px', margin: '10px 0',
  } as React.CSSProperties,
  wTitle: {
    fontSize: 11.5, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase',
    opacity: 0.55, margin: '0 0 8px',
  } as React.CSSProperties,
  srow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, margin: '5px 0' } as React.CSSProperties,
  dot: (filled: boolean) => ({
    width: 15, height: 15, borderRadius: '50%', flex: '0 0 15px', fontSize: 10, color: '#fff',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: filled ? 'var(--dsh-ok, #0c7a43)' : 'var(--dsh-border, #d5dbe4)',
  }) as React.CSSProperties,
  qbtn: {
    display: 'block', width: '100%', textAlign: 'left', fontSize: 13.5, cursor: 'pointer',
    border: '1px solid var(--dsh-border, #d5dbe4)', borderRadius: 10, background: 'transparent',
    color: 'inherit', padding: '8px 12px', margin: '5px 0', font: 'inherit',
  } as React.CSSProperties,
  think: { display: 'inline-flex', gap: 4, alignSelf: 'flex-start', margin: '8px 2px' } as React.CSSProperties,
  thinkDot: (i: number) => ({
    width: 7, height: 7, borderRadius: '50%', background: 'var(--dsh-border, #c9d2de)',
    animation: `cfblink 1s ${i * 0.2}s infinite`,
  }) as React.CSSProperties,
  sync: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
    justifyContent: 'center', flex: 1, opacity: 0.85,
  } as React.CSSProperties,
  ring: {
    width: 42, height: 42, borderRadius: '50%',
    border: `4px solid var(--dsh-accent-soft, #eef4ff)`,
    borderTopColor: 'var(--dsh-accent, #0f62fe)',
    animation: 'cfspin 0.9s linear infinite',
  } as React.CSSProperties,
  finalTitle: { fontSize: 20, fontWeight: 800, margin: '0 0 6px' } as React.CSSProperties,
  link: { color: 'var(--dsh-accent, #1d4ed8)', fontWeight: 650, textDecoration: 'none' } as React.CSSProperties,
}

type Phase = 'form' | 'chat' | 'sync' | 'done'
interface Widget { rows: { key: string; title: string; filled: boolean }[]; done: number; total: number }

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'customer-form' },
    CustomerScreen,
  ))
}

function CustomerScreen(): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] = useState<{ name: string; ref: string }[]>([])
  const [links, setLinks] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [taskUrl, setTaskUrl] = useState('')
  const taskId = useRef<number>(0)
  const [msgs, setMsgs] = useState<{ who: 'user' | 'bot'; text: string }[]>([])
  const [reply, setReply] = useState('')
  const [widget, setWidget] = useState<Widget | null>(null)
  const [glossary, setGlossary] = useState<{ term: string; expansion: string }[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  const [finalLinks, setFinalLinks] = useState<{ url: string; board: string } | null>(null)
  const [listening, setListening] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const msgsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = '@keyframes cfblink{50%{opacity:.25}}@keyframes cfspin{to{transform:rotate(360deg)}}'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  useEffect(() => { msgsRef.current?.scrollTo({ top: msgsRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs])

  const call = async (endpoint: string, payload?: unknown): Promise<{ ok: boolean; value?: unknown; error?: { message: string } }> => {
    const res = await fetch(`/api/customer-form.${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), payload: payload ?? {} }),
    })
    return ((await res.json()) as { result: { ok: boolean; value?: unknown; error?: { message: string } } }).result
  }

  const onText = (v: string): void => {
    setText(v)
    const found = v.match(/https?:\/\/[^\s]+/g) ?? []
    setLinks(new Set(found.map((u) => u.replace(/[.,;)]+$/, ''))))
  }

  const upload = async (list: FileList | null): Promise<void> => {
    if (!list) return
    for (const f of Array.from(list)) {
      setStatus(`⏳ ${f.name}…`)
      const res = await fetch('/api/customer-form.uploadFile', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-cf-filename': encodeURIComponent(f.name) },
        body: await f.arrayBuffer(),
      })
      const json = (await res.json()) as { ref?: string; name?: string; error?: string }
      if (json.ref) setFiles((prev) => [...prev, { name: json.name ?? f.name, ref: json.ref as string }])
      else setStatus(json.error ?? 'не удалось загрузить')
    }
    setStatus('')
  }

  const mic = (): void => {
    const w = window as unknown as { webkitSpeechRecognition?: new () => any; SpeechRecognition?: new () => any }
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
    if (!Ctor || listening) { if (!Ctor) setStatus('Браузер не поддерживает диктовку — напишите текстом'); return }
    const rec = new Ctor()
    rec.lang = 'ru-RU'; rec.interimResults = false; rec.continuous = true
    rec.onresult = (e: any) => {
      let chunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript
      onText(text + (text ? ' ' : '') + chunk.trim())
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    rec.start(); setListening(true)
  }

  const submit = async (): Promise<void> => {
    if (!text.trim() && files.length === 0) { setStatus('Напишите хотя бы пару слов'); return }
    setBusy(true); setStatus('Создаём задачу…')
    const t0 = performance.now()
    const res = await call('submit', { name: name.trim(), email: email.trim(), text,
                                      links: [...links], files: files.map((f) => f.ref) })
    setBusy(false)
    if (!res.ok || !res.value) { setStatus(res.error?.message ?? 'не ушло'); return }
    const v = res.value as { taskId: number; url: string }
    taskId.current = v.taskId
    setTaskUrl(v.url)
    setStatus(performance.now() - t0 < 1000 ? '' : 'задача создана (чуть дольше секунды)')
    setPhase('chat')
    void turn('Здравствуйте! Изучаю то, что вы прислали. Сразу уточню главное, чтобы PO не приходил с вопросами…')
  }

  const turn = async (first?: string): Promise<void> => {
    if (first) {
      setMsgs((m) => [...m, { who: 'bot', text: first }])
      setWidget({ rows: [], done: 0, total: 7 })
    }
    setBusy(true)
    const res = await call('chat', { taskId: taskId.current, message: text })
    setBusy(false)
    if (!res.ok || !res.value) { setMsgs((m) => [...m, { who: 'bot', text: res.error?.message ?? 'связь споткнулась, повторите' }]); return }
    const v = res.value as { reply: string; questions: string[]; scorecard: Widget; glossary: { term: string; expansion: string }[] }
    setMsgs((m) => [...m, { who: 'user', text }, { who: 'bot', text: v.reply }])
    setWidget(v.scorecard); setQuestions(v.questions ?? []); setGlossary(v.glossary ?? [])
    setText('')
  }

  const sendChat = async (): Promise<void> => {
    if (!reply.trim() || busy) return
    const message = reply
    setReply('')
    setMsgs((m) => [...m, { who: 'user', text: message }])
    setBusy(true)
    const res = await call('chat', { taskId: taskId.current, message })
    setBusy(false)
    if (!res.ok || !res.value) { setMsgs((m) => [...m, { who: 'bot', text: res.error?.message ?? 'связь споткнулась' }]); return }
    const v = res.value as { reply: string; questions: string[]; scorecard: Widget; glossary: { term: string; expansion: string }[] }
    setMsgs((m) => [...m, { who: 'bot', text: v.reply }])
    setWidget(v.scorecard); setQuestions(v.questions ?? []); setGlossary(v.glossary ?? [])
  }

  const finalize = async (): Promise<void> => {
    setPhase('sync')
    const res = await call('finalize', { taskId: taskId.current })
    if (res.ok && res.value) setFinalLinks(res.value as { url: string; board: string })
    setTimeout(() => setPhase('done'), 1100)
  }

  return (
    <div style={s.screen}>
      <style>{`@keyframes cfblink{50%{opacity:.25}}@keyframes cfspin{to{transform:rotate(360deg)}}`}</style>
      <div style={s.center}>
        {phase === 'form' && (
          <>
            <div style={s.brandRow}>
              <span style={s.brandMark}>Б</span>
              <span style={s.brandName}>Система БФТ</span>
            </div>
            <h1 style={s.h1}>Введите свои мысли</h1>
            <p style={s.sub}>Опишите инициативу как удобно: текстом, голосом, файлами.
            Ассистент задаст пару уточняющих вопросов — и постановка уйдёт в работу без встреч.</p>
            <div style={s.who}>
              <input style={s.input} placeholder="ФИО" value={name} onChange={(e) => setName(e.target.value)} />
              <input style={s.input} placeholder="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div style={s.composer}>
              <textarea ref={areaRef} style={s.area} value={text}
                placeholder="Что нужно, зачем и когда хотите результат…"
                onChange={(e) => onText(e.target.value)} />
              {(files.length > 0 || links.size > 0) && (
                <div style={s.chips}>
                  {[...links].map((l) => <span key={l} style={s.chip}>🔗 {l.replace(/^https?:\/\//, '').slice(0, 34)}</span>)}
                  {files.map((f) => <span key={f.ref} style={s.chip}>📎 {f.name}</span>)}
                </div>
              )}
              <div style={s.composerBar}>
                <button type="button" style={{ ...s.iconBtn, opacity: listening ? 1 : undefined, color: listening ? '#c0392b' : undefined }}
                        title="Прикрепить файлы, фото, документы" onClick={() => fileRef.current?.click()}>📎</button>
                <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.currentTarget.value = '' }} />
                <button type="button" style={s.iconBtn} title="Диктовка" onClick={mic}>{listening ? '⏹' : '🎤'}</button>
                <span style={{ flex: 1 }} />
                <Button variant="primary" disabled={busy} onClick={() => void submit()}>Отправить →</Button>
              </div>
            </div>
            <div style={s.status}>{status}</div>
          </>
        )}

        {phase === 'chat' && (
          <div style={s.chat}>
            <div style={{ ...s.brandRow, marginBottom: 14 }}>
              <span style={s.brandMark}>Б</span>
              <span style={s.brandName}>Система БФТ · постановка</span>
              <span style={{ flex: 1 }} />
              <a href={taskUrl} target="_blank" rel="noreferrer" style={{ ...s.taskPill, marginTop: 0 }}>✓ Запрос создан</a>
            </div>
            <div ref={msgsRef} style={s.msgs}>
              {msgs.map((m, i) => <div key={i} style={{ ...s.msg, ...(m.who === 'user' ? s.msgUser : s.msgBot) }}>{m.text}</div>)}
              {busy && <div style={s.think}><i style={s.thinkDot(0)} /><i style={s.thinkDot(1)} /><i style={s.thinkDot(2)} /></div>}
            </div>
            {widget && widget.rows.length > 0 && (
              <div style={s.widget}>
                <p style={s.wTitle}>Постановка · {widget.done}/{widget.total}</p>
                {widget.rows.map((r) => (
                  <div key={r.key} style={s.srow}>
                    <span style={s.dot(r.filled)}>{r.filled ? '✓' : ''}</span>{r.title}
                  </div>
                ))}
                {glossary.length > 0 && (
                  <p style={{ ...s.status, textAlign: 'left', marginTop: 8 }}>
                    Глоссарий: {glossary.map((g) => `${g.term} — ${g.expansion}`).join('; ')}
                  </p>
                )}
                {questions.map((q) => (
                  <button key={q} type="button" style={s.qbtn} onClick={() => setReply(q)}>❓ {q}</button>
                ))}
              </div>
            )}
            <div style={s.composer}>
              <textarea style={{ ...s.area, minHeight: 56 }} value={reply}
                placeholder="Ответьте текстом или нажмите вопрос выше…"
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat() } }} />
              <div style={s.composerBar}>
                <span style={{ fontSize: 12.5, opacity: 0.55 }}>ссылки и файлы — в следующем сообщении текстом</span>
                <span style={{ flex: 1 }} />
                <Button variant="ghost" onClick={() => void finalize()}>Завершить сбор →</Button>
                <Button variant="primary" disabled={busy || !reply.trim()} onClick={() => void sendChat()}>→</Button>
              </div>
            </div>
          </div>
        )}

        {phase === 'sync' && (
          <div style={s.sync}>
            <div style={s.ring} />
            <span style={{ opacity: 0.7 }}>Синхронизируем данные…</span>
          </div>
        )}

        {phase === 'done' && finalLinks && (
          <>
            <div style={s.brandRow}><span style={s.brandMark}>✓</span><span style={s.brandName}>Готово</span></div>
            <h1 style={s.h1}>Постановка собрана</h1>
            <p style={s.sub}>
              Отслеживание: <a href={finalLinks.url} target="_blank" rel="noreferrer" style={s.link}>задача</a> ·{' '}
              <a href={finalLinks.board} target="_blank" rel="noreferrer" style={s.link}>доска запросов</a>
            </p>
            <p style={{ ...s.sub, marginTop: -14 }}>
              Summary и полный контекст — в комментариях задачи. Дальше за PO и командой:
              статус смотрите на доске.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
