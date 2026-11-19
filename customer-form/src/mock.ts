/**
 * Упрощённый экран для раскадровки приёмки — перенос BPK.mockSVG из
 * poh-blueprint-writer (skills/bft-blueprint/scripts/page_kit.js): рамка
 * устройства и элементы экрана из короткого описания (DSL), 150×250.
 *
 * DSL — как «Состав» экранов blueprint: части через «;», сверху вниз:
 *   заголовок: …   отметка: … (✓ в шапке)   текст: …   оффер: …   кнопка: …
 *   кнопка-контур: …   ссылка: …   плитки   список: N   список-оффер: N
 *   фильтры: a, b   поле: ключ = значение   картинка   успех: …   отказ: …
 *   уведомление: от / заголовок / текст   отправитель: …
 */

type Element =
  | ['from' | 'hdr' | 'text' | 'offer' | 'cta' | 'cta2' | 'link' | 'ok' | 'no', string]
  | ['tiles' | 'img']
  | ['rows' | 'rowsOffer', number]
  | ['chips', string[]]
  | ['kv', string, string]
  | ['notif', string, string, string]

export type Device = 'web' | 'mail' | 'lock' | 'app'

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

function wrapT(text: string, n: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of String(text).split(' ')) {
    if ((line + ' ' + word).trim().length > n) {
      if (line) out.push(line)
      line = word
    } else line = (line + ' ' + word).trim()
  }
  if (line) out.push(line)
  return out
}

/** Устройство по слову заказчика или по названию экрана. */
export function deviceOf(device: string | undefined, screen: string): Device {
  const s = `${device ?? ''} ${screen}`.toLowerCase()
  if (/письм|почт|email|e-mail|outlook|gmail/.test(s)) return 'mail'
  if (/уведомл|push|пуш|смс|sms|оповещ/.test(s)) return 'lock'
  if (/приложен|мобильн|телефон|iphone|android/.test(s)) return 'app'
  return 'web'
}

/** «заголовок: Корзина; список: 2; кнопка: Оплатить» → элементы экрана. */
export function parseMock(dsl: string): Element[] {
  const out: Element[] = []
  for (const raw of dsl.split(';')) {
    const part = raw.trim()
    if (!part) continue
    const at = part.indexOf(':')
    const key = (at < 0 ? part : part.slice(0, at)).trim().toLowerCase()
    const value = at < 0 ? '' : part.slice(at + 1).trim()
    const count = Math.max(1, Math.min(4, Number.parseInt(value, 10) || 2))
    if (key === 'заголовок') out.push(['hdr', value])
    else if (key === 'отметка') out.push(['hdr', `✓ ${value}`])
    else if (key === 'текст') out.push(['text', value])
    else if (key === 'оффер') out.push(['offer', value])
    else if (key === 'кнопка') out.push(['cta', value])
    else if (key === 'кнопка-контур') out.push(['cta2', value])
    else if (key === 'ссылка') out.push(['link', value])
    else if (key === 'плитки') out.push(['tiles'])
    else if (key === 'список') out.push(['rows', count])
    else if (key === 'список-оффер') out.push(['rowsOffer', count])
    else if (key === 'фильтры') out.push(['chips', value.split(',').map((v) => v.trim()).filter(Boolean)])
    else if (key === 'поле') {
      const [k, v = ''] = value.split('=').map((x) => x.trim())
      out.push(['kv', k, v])
    } else if (key === 'картинка') out.push(['img'])
    else if (key === 'успех') out.push(['ok', value])
    else if (key === 'отказ') out.push(['no', value])
    else if (key === 'уведомление') {
      const [from = '', title = '', text = ''] = value.split('/').map((x) => x.trim())
      out.push(['notif', from, title, text])
    } else if (key === 'отправитель') out.push(['from', value])
    else out.push(['text', part])
  }
  return out
}

/** Экран, если модель описание не дала: шапка — экран, ниже — что должны увидеть. */
export function defaultMock(screen: string, expect: string): Element[] {
  return [['hdr', screen], ['text', expect], ['img']]
}

export function mockSVG(device: Device, elements: Element[], label: string): string {
  const W = 150, H = 250, ink = '#1f1f1f', g = '#9a958c', OF = '#6b3fd4', P = 11, IW = W - 2 * P
  const T = (x: number, yy: number, s: string, fs: number, fw = 400, fill = ink, a?: string) =>
    `<text x="${x}" y="${yy}" font-size="${fs}" font-weight="${fw}" fill="${fill}"${a ? ` text-anchor="${a}"` : ''}>${esc(s)}</text>`
  let y: number
  let frame: string
  let out = ''
  if (device === 'web') {
    y = 26
    frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10" fill="#fff" stroke="#2b2b2b" stroke-width="1.5"/><path d="M1,11 a10,10 0 0 1 10,-10 h${W - 22} a10,10 0 0 1 10,10 v7 h-${W - 2}z" fill="#efede8"/>`
      + [0, 1, 2].map((i) => `<circle cx="${10 + i * 7}" cy="10" r="2.2" fill="#bdb8af"/>`).join('')
  } else if (device === 'mail') {
    y = 12
    frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="10" fill="#fff" stroke="#2b2b2b" stroke-width="1.5"/>`
  } else if (device === 'lock') {
    y = 78
    frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="22" fill="#e6e2db" stroke="#2b2b2b" stroke-width="1.5"/><rect x="${W / 2 - 20}" y="7" width="40" height="7" rx="3.5" fill="#2b2b2b"/>`
      + T(W / 2, 56, '09:41', 30, 300, '#555', 'middle')
  } else {
    y = 24
    frame = `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="22" fill="#fff" stroke="#2b2b2b" stroke-width="1.5"/><rect x="${W / 2 - 20}" y="7" width="40" height="7" rx="3.5" fill="#2b2b2b"/>`
  }
  for (const it of elements) {
    if (y > H - 30) break // не вылезаем за рамку
    const k = it[0]
    if (k === 'from') { out += `<path d="M${P},${y} h18 v12 h-18z M${P},${y} l9,7 l9,-7" fill="none" stroke="${g}" stroke-width="1.3"/>` + T(P + 24, y + 10, it[1], 10, 600, g); y += 22 }
    else if (k === 'hdr') {
      const ok = it[1].startsWith('✓ ')
      const text = wrapT(ok ? it[1].slice(2) : it[1], ok ? 17 : 20)[0] ?? ''
      out += ok ? `<circle cx="${P + 7}" cy="${y + 7}" r="7" fill="${ink}"/><path d="M${P + 3.5},${y + 7} l2.5,2.5 l4.5,-5" fill="none" stroke="#fff" stroke-width="1.8"/>` + T(P + 19, y + 11.5, text, 12, 700) : T(P, y + 11.5, text, 12, 700)
      y += 22
    } else if (k === 'text') { wrapT(it[1], 22).slice(0, 6).forEach((l) => { out += T(P, y + 11, l, 10.5, 400, g); y += 13 }); y += 5 }
    else if (k === 'offer') { const ls = wrapT(it[1], 13).slice(0, 3), h = ls.length * 16 + 16; out += `<rect x="${P}" y="${y}" width="${IW}" height="${h}" rx="9" fill="${OF}"/>`; ls.forEach((l, i) => { out += T(P + 10, y + 20 + i * 16, l, 13, 800, '#fff') }); y += h + 9 }
    else if (k === 'cta' || k === 'cta2') { const label2 = it[1].length > 24 ? it[1].slice(0, 23) + '…' : it[1]; const fs = label2.length > 16 ? 9.5 : 11; out += `<rect x="${P}" y="${y}" width="${IW}" height="26" rx="13" fill="${k === 'cta' ? ink : '#fff'}" stroke="${ink}" stroke-width="1.2"/>` + T(W / 2, y + 17, label2, fs, 700, k === 'cta' ? '#fff' : ink, 'middle'); y += 32 }
    else if (k === 'link') { out += T(P, y + 12, it[1], 11, 700, ink) + `<line x1="${P}" y1="${y + 15}" x2="${P + Math.min(IW, it[1].length * 6)}" y2="${y + 15}" stroke="${ink}"/>`; y += 22 }
    else if (k === 'tiles') { const tw = (IW - 8) / 2; [0, 1].forEach((i) => { const x = P + i * (tw + 8); out += `<rect x="${x}" y="${y}" width="${tw}" height="58" rx="7" fill="#fff" stroke="#d6d2ca"/><rect x="${x + 5}" y="${y + 5}" width="${tw - 10}" height="24" rx="4" fill="#ece9e3"/><rect x="${x + 5}" y="${y + 35}" width="${tw - 22}" height="6" rx="3" fill="#cfcac0"/><rect x="${x + 5}" y="${y + 46}" width="${tw - 34}" height="5" rx="2.5" fill="#e3dfd8"/>` }); y += 66 }
    else if (k === 'rows' || k === 'rowsOffer') { for (let i = 0; i < it[1]; i++) { out += `<rect x="${P}" y="${y}" width="26" height="26" rx="5" fill="#ece9e3"/><rect x="${P + 33}" y="${y + 5}" width="58" height="6" rx="3" fill="#cfcac0"/><rect x="${P + 33}" y="${y + 16}" width="40" height="5" rx="2.5" fill="#e3dfd8"/>`; if (k === 'rowsOffer') out += `<rect x="${W - P - 28}" y="${y + 6}" width="28" height="14" rx="7" fill="${OF}"/>`; y += 34 } }
    else if (k === 'chips') { let x = P; it[1].forEach((c) => { const w = c.length * 6 + 14; if (x + w > W - P) return; out += `<rect x="${x}" y="${y}" width="${w}" height="20" rx="10" fill="#fff" stroke="#9a958c"/>` + T(x + 7, y + 14, c, 10, 600); x += w + 5 }); y += 30 }
    else if (k === 'kv') { out += T(P, y + 12, it[1], 10.5, 400, g) + T(W - P, y + 12, it[2], 11, 700, ink, 'end') + `<line x1="${P}" y1="${y + 19}" x2="${W - P}" y2="${y + 19}" stroke="#eee"/>`; y += 24 }
    else if (k === 'img') { out += `<rect x="${P}" y="${y}" width="${IW}" height="56" rx="7" fill="#ece9e3"/><path d="M${P + 20},${y + 44} l18,-20 l14,14 l10,-9 l18,15z" fill="#d6d1c8"/>`; y += 64 }
    else if (k === 'ok' || k === 'no') {
      const cx = W / 2, cy = y + 30, col = k === 'ok' ? '#2f6b2a' : '#c0392b'
      out += `<circle cx="${cx}" cy="${cy}" r="24" fill="${col}"/>` + (k === 'ok'
        ? `<path d="M${cx - 11},${cy} l8,8 l14,-15" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M${cx - 9},${cy - 9} l18,18 M${cx + 9},${cy - 9} l-18,18" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/>`)
      y += 64
      wrapT(it[1], 18).slice(0, 2).forEach((l) => { out += T(cx, y + 6, l, 12, 800, k === 'ok' ? ink : '#c0392b', 'middle'); y += 15 })
      y += 7
    } else if (k === 'notif') {
      const tl = wrapT(it[2], 17).slice(0, 2), ls = wrapT(it[3], 20).slice(0, 3), h = 34 + tl.length * 15 + ls.length * 13
      out += `<rect x="${P - 3}" y="${y}" width="${IW + 6}" height="${h}" rx="12" fill="#fff"/><rect x="${P + 5}" y="${y + 8}" width="16" height="16" rx="4" fill="${OF}"/>` + T(P + 26, y + 20, it[1], 9.5, 600, g)
      tl.forEach((l, i) => { out += T(P + 5, y + 42 + i * 15, l, 11.5, 800) })
      ls.forEach((l, i) => { out += T(P + 5, y + 42 + tl.length * 15 + i * 13, l, 10.5, 400, '#444') })
      y += h + 10
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" font-family="Inter,-apple-system,Helvetica,Arial,sans-serif">${frame}${out}</svg>`
}
