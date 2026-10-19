/**
 * Иконки раздела поверх @deepseek-ai/dsh-client-ui-primitives — совместимо с ядром
 * 0.1.2 и 0.1.7.
 *
 * В 0.1.7 набор иконок переименован: размер ушёл из имени в проп `size`
 * (`IconChecklistOutline14` → `IconChecklistOutlineRegular`). Прямой импорт
 * старого имени под 0.1.7 даёт `undefined`, и React роняет весь слот (#130) —
 * иконка раздела в сайдбаре не появляется. Здесь каждая иконка берётся по новому
 * имени, затем по старому; нет ни того, ни другого — пустой узел вместо падения.
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

type IconComponent = ComponentType<{ size?: number; className?: string }>

const table = (primitives ?? {}) as unknown as Record<string, IconComponent | undefined>

const Missing: IconComponent = () => null

function pick(current: string, legacy: string): IconComponent {
  return table[current] ?? table[legacy] ?? Missing
}

export const IconArchiveOutline20 = pick('IconArchiveOutlineRegular', 'IconArchiveOutline20')
export const IconChecklistOutline14 = pick('IconChecklistOutlineRegular', 'IconChecklistOutline14')
export const IconChevronDownOutline14 = pick('IconChevronDownOutlineRegular', 'IconChevronDownOutline14')
export const IconChevronLeftOutline14 = pick('IconChevronLeftOutlineRegular', 'IconChevronLeftOutline14')
export const IconCloseOutline16 = pick('IconCloseOutlineRegular', 'IconCloseOutline16')
export const IconCodeOutline16 = pick('IconCodeOutlineRegular', 'IconCodeOutline16')
export const IconPlusOutline16 = pick('IconPlusOutlineRegular', 'IconPlusOutline16')
export const IconRefreshOutline16 = pick('IconRefreshOutlineRegular', 'IconRefreshOutline16')
export const IconSearchOutline16 = pick('IconSearchOutlineRegular', 'IconSearchOutline16')
export const IconWarningOutline16 = pick('IconWarningOutlineRegular', 'IconWarningOutline16')
