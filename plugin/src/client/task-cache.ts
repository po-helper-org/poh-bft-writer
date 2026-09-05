/**
 * Локальный кэш плоского списка требований (localStorage) — переживает перезагрузку страницы,
 * не только закрытие панели. PO: «открытие должно быть <1с, если данные уже загружены локально»
 * — backlog CLI поднимается секунды на каждый вызов (см. `load()` в Panel.tsx/Board.tsx),
 * поэтому первое открытие панели или доски за загрузку страницы этой стоимости не платит,
 * пока в браузере ещё жив кэш с прошлого раза.
 *
 * Общий для Panel.tsx (строит `queueGroups()`) и Board.tsx (строит `boardColumns()`) — обе
 * вьюхи выводят свою группировку из одного и того же плоского списка, кэш хранит только его.
 * Обе стороны читают кэш один раз при монтировании (моментальный первый рендер) и молча
 * перезаписывают его при каждой успешной фоновой загрузке — устаревание само лечится
 * следующим открытием любой из двух вьюх.
 */
import type { BftTaskSummary } from '../model.js'

const CACHE_KEY = 'poh-bft-plugin:tasks:v1'

export function readTaskCache(): BftTaskSummary[] | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as BftTaskSummary[] : undefined
  } catch {
    // Приватный режим, отключённый storage, битый JSON — кэша просто нет, не ошибка.
    return undefined
  }
}

export function writeTaskCache(tasks: BftTaskSummary[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(tasks))
  } catch {
    // Квота/приватный режим — кэш не переживёт эту загрузку страницы, не критично.
  }
}

/** Общий разбор ответа канала `list` — тот же провод для Panel.tsx и Board.tsx. */
export function toTaskSummaries(value: unknown): BftTaskSummary[] {
  if (!Array.isArray(value)) {
    console.error('[poh-bft-plugin] list ответил не массивом:', value)
    return []
  }
  return value as BftTaskSummary[]
}
