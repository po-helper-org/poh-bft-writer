/**
 * Интейк (US-9–13): строка ввода требования — текст, голос, вложения, ссылки.
 *
 * Чистая половина: куда ложатся файлы, как чистятся имена, что считается
 ссылкой, сколько можно. Файлы — «пути в воркспейсе» (контракт скилла bft-fast:
 источник = путь), поэтому интейк ничего не знает о сессиях: это делает Т8.
 */
import { join } from 'node:path'

/** Каталог вложений внутри воркспейса БФТ (docsPath — рядом, у артефактов). */
export const INTAKE_UPLOAD_DIR = 'bft/uploads'

/** Один файл — не больше: аудиозапись встречи тяжёлая, но не безразмерная. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Слаг папки вложений: `< utc-таймстамп>-<slug>`; мусор из слага вычищается. */
export function uploadDir(slug: string, now = new Date()): string {
  return join(INTAKE_UPLOAD_DIR, `${Math.floor(now.getTime() / 1000)}-${sanitizeSlug(slug)}`)
}

/** Слаг: нижний регистр, дефисы, буквы-цифры (включая кириллицу) остаются. */
export function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^a-z0-9а-яё-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return cleaned || 'intake'
}

/**
 * Имя файла: без каталогов (path traversal — ошибка запроса, а не «почистили»),
 * без управляющих символов, до 96 знаков. Пустое имя — null: файл без имени
 * не сохраняем, вызывающий отвечает ошибкой.
 */
export function sanitizeFilename(raw: string): string | null {
  const base = raw.split(/[/\\]/).pop() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 96)
  return cleaned || null
}

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g

/** Ссылки из текста: http/https, дубликаты сняты, порядок — появления. */
export function parseLinks(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)]+$/, '')
    if (url.length > 'https://'.length && !seen.has(url)) seen.add(url)
  }
  return [...seen]
}

/** Вердикт ввода до отправки: пустота — ошибка, норма — без замечаний. */
export function validateIntake(text: string, files: readonly string[]): { ok: boolean; reason?: string } {
  const hasText = text.trim().length > 0
  const hasLinks = parseLinks(text).length > 0
  if (!hasText && files.length === 0) return { ok: false, reason: 'Пусто: вставьте текст, надиктуйте или прикрепите файл' }
  if (!hasText && !hasLinks && files.length > 0) {
    // Файл без ни слова — можно: транскрипт встречи сам себе вводная.
    return { ok: true }
  }
  return { ok: true }
}

/** Имя аудиозаписи диктовки (локальный режим): расширение webm у MediaRecorder. */
export function dictationFilename(now = new Date()): string {
  return `dictation-${Math.floor(now.getTime() / 1000)}.webm`
}
