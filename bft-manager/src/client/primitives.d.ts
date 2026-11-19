/**
 * Типы примитивов DSH UI, которыми пользуется страница, — выписка из
 * @deepseek-ai/dsh-client-ui-primitives 0.1.7-rc.2 (рантайм профиля). Пакет —
 * модуль оболочки (CLIENT_EXTERNALS в tsdown.config.ts): в бандл не входит,
 * поэтому и в devDependencies его нет — dev-сборка 0.1.2 не знает Tag/Menu.
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ButtonHTMLAttributes, ForwardRefExoticComponent, InputHTMLAttributes, ReactNode, ReactPortal, RefAttributes } from 'react'

  export const Button: ForwardRefExoticComponent<{
    variant?: 'primary' | 'ghost' | 'outline' | 'toolbar'
    size?: 'md' | 'sm'
    icon?: ReactNode
    className?: string
    children?: ReactNode
  } & ButtonHTMLAttributes<HTMLButtonElement> & RefAttributes<HTMLButtonElement>>

  export type TagTone = 'outline' | 'solid' | 'neutral' | 'quiet' | 'success' | 'info' | 'warning' | 'danger'
  export function Tag(props: { tone?: TagTone; className?: string; children?: ReactNode }): JSX.Element

  export function Pill(props: { active?: boolean; className?: string; children?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element

  export interface SegmentedTab<Value extends string = string> { value: Value; label: ReactNode; id: string; panelId: string }
  export function SegmentedTabs<Value extends string>(props: {
    items: readonly [SegmentedTab<Value>, ...SegmentedTab<Value>[]]
    value: Value
    onChange: (value: Value) => void
    label: string
    className?: string
  }): ReactNode

  export function SegmentedControl<Value extends string>(props: {
    id: string
    value: Value
    options: readonly { value: Value; label: string; disabled?: boolean; title?: string }[]
    onChange: (next: Value) => void
    label: string
    disabled?: boolean
    className?: string
  }): JSX.Element

  export function Input(props: { icon?: ReactNode; className?: string } & InputHTMLAttributes<HTMLInputElement>): JSX.Element

  export function Modal(props: {
    open: boolean
    onClose: () => void
    title: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
    closeLabel: string
  }): ReactPortal | null

  export interface MenuItem { id: string; label: ReactNode; disabled?: boolean; icon?: ReactNode; danger?: boolean }
  export interface MenuSeparator { type: 'separator'; id: string }
  export interface MenuLabel { type: 'label'; id: string; text: string }
  export type MenuEntry = MenuItem | MenuSeparator | MenuLabel
  export function Menu(props: {
    open: boolean
    anchor: ReactNode
    items?: readonly MenuEntry[]
    selectedId?: string
    onSelect?: (id: string) => void
    onClose: () => void
    align?: 'start' | 'end'
    side?: 'bottom' | 'top' | 'right'
    portal?: boolean
    dense?: boolean
    selection?: 'check' | 'fill'
    className?: string
  }): JSX.Element

  export function StateDot(props: { state: 'done' | 'warning' | 'ongoing' | 'error' | 'idle'; size?: number; className?: string }): JSX.Element

  export function Tooltip(props: { label: string; side?: 'right' | 'bottom' | 'top'; children: JSX.Element }): JSX.Element
}
