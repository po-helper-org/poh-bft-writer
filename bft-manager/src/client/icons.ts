/**
 * Иконки DSH UI по имени 0.1.7 (`…OutlineRegular`). Нет такой в рантайме —
 * пустой узел: undefined в JSX роняет весь слот (React #130, урок poh-bft-plugin).
 */
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComponentType } from 'react'

type Icon = ComponentType<{ size?: number; className?: string }>

const table = (primitives ?? {}) as unknown as Record<string, Icon | undefined>
const Missing: Icon = () => null
const pick = (name: string): Icon => table[name] ?? Missing

export const IconMenu = pick('IconPanelLeftOutlineRegular')
export const IconBack = pick('IconChevronLeftOutlineRegular')
export const IconRefresh = pick('IconRefreshOutlineRegular')
export const IconSearch = pick('IconSearchOutlineRegular')
export const IconExternal = pick('IconRightUpOutlineRegular')
export const IconUser = pick('IconUserOutlineRegular')
export const IconMore = pick('IconEllipsisOutlineRegular')
export const IconChat = pick('IconNewChatOutlineRegular')
export const IconBoard = pick('IconPlanOutlineRegular')
export const IconLink = pick('IconLinkOutlineRegular')
export const IconDoc = pick('IconDeliverDocRegular')
