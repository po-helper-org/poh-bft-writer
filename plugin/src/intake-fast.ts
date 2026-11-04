/**
 * Т8: сборка запуска fast-прогона (чистая половина).
 *
 * Команда скилла (commands/bft-fast.md): `/bft-fast <источник> [epic_slug]
 * [флаги]`. Источник — инлайн-текст или пути (вложения интейка уже легли в
 * воркспейс); слаг задаёт каталог документа, он же — ключ связки с инициативой.
 * Фоновые форки глушим: deep/recon/custdev у быстрых прогонов запускает
 * Коробка, а не соседняя сессия (ADR-0001: оркестрации в харнессе нет).
 */
import { join } from 'node:path'

export const FAST_FLAGS = '--no-deep --no-recon --no-custdev' as const

/** Путь fast-документа относительно docsPath (читается reader.readDocument). */
export function fastDocPath(slug: string): string {
  return join(slug, `${slug}-fast.md`)
}

/** Инлайн-текст в кавычках: однострочный, кавычки внутри — двойные. */
export function quoteInline(text: string): string {
  return `"${text.replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`
}

export interface FastCommandInput {
  text: string
  /** Пути вложений в воркспейсе (upload из интейка). */
  paths: readonly string[]
  slug: string
}

export function buildFastCommand(input: FastCommandInput): { ok: true; command: string } | { ok: false; reason: string } {
  const text = input.text.trim()
  const paths = input.paths.filter((p) => p.trim().length > 0)
  if (!text && paths.length === 0) return { ok: false, reason: 'Пустой запуск: нет ни текста, ни файлов' }
  const slug = input.slug.trim()
  if (!slug) return { ok: false, reason: 'Слаг обязателен: по нему живёт документ и связь с инициативой' }

  // Источник: файлы первыми (транскрипт/фото важнее пересказа), текст дополняет.
  const source = [paths.join(' '), quoteInline(text)].filter(Boolean).join(' ')
  return { ok: true, command: `/bft-fast ${source} ${slug} ${FAST_FLAGS}` }
}
