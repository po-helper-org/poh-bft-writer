/**
 * Доска экрана «Планирование» (ADR-0025): Excalidraw в духе FigJam для быстрых
 * зарисовок. Своя нижняя панель — Выбор, Рука, Стикер, Текст, Стрелка (V H S T A);
 * панели Excalidraw (свойства, цвета, толщина, меню, библиотека, подсказки) скрыты.
 * Линии ровные (без «рукописного» эффекта), шрифт Nunito. Стикер — клик по доске:
 * жёлтая карточка, сразу ввод текста; стрелки цепляются к стикерам.
 * Страница (plan.ts) кладёт в window.PLAN сохранённую сцену, а при «Сохранить»
 * берёт у window.planBoard сцену (JSON .excalidraw) и SVG доски.
 */
import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, exportToSvg, FONT_FAMILY, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import './figjam.css'
import { createElement as h, useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

type Tool = 'selection' | 'hand' | 'sticky' | 'text' | 'arrow'

interface Api {
  getSceneElements(): readonly { id: string; isDeleted?: boolean }[]
  getAppState(): Record<string, unknown>
  getFiles(): Record<string, unknown>
  setActiveTool(tool: { type: string } | { type: 'custom'; customType: string }): void
  updateScene(scene: { elements?: readonly unknown[]; appState?: Record<string, unknown>; captureUpdate?: unknown }): void
}

interface PlanWindow {
  PLAN?: { scene?: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> } | null; readOnly?: boolean }
  planBoard?: { scene(): string; svg(): Promise<string>; empty(): boolean; onChange?: () => void }
}

const w = window as unknown as PlanWindow
let api: Api | null = null

const STICKY = { w: 200, h: 140, fill: '#fff3bf' }
/** Новые элементы — ровные, шрифт без засечек: доска для рабочих зарисовок, а не скетч. */
const CLEAN = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT_FAMILY.Nunito,
  currentItemFontSize: 20,
  currentItemStrokeWidth: 1,
  currentItemStrokeColor: '#1e1e1e',
  currentItemRoundness: 'round',
  currentItemArrowType: 'round',
  currentItemEndArrowhead: 'arrow',
}

const ICONS: Record<Tool, string> = {
  selection: 'M5 3l13 7-6 1.5L9.5 18z',
  hand: 'M8 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6.5 7S5 17.5 4 15l-1.5-3a1.5 1.5 0 0 1 2.6-1.5L8 14',
  sticky: 'M5 4h14v10l-5 5H5zM14 19v-5h5',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  arrow: 'M4 20L20 4M11 4h9v9',
}
const TOOLS: Array<{ id: Tool; label: string; key: string }> = [
  { id: 'selection', label: 'Выбор', key: 'V' },
  { id: 'hand', label: 'Рука', key: 'H' },
  { id: 'sticky', label: 'Стикер', key: 'S' },
  { id: 'text', label: 'Текст', key: 'T' },
  { id: 'arrow', label: 'Стрелка', key: 'A' },
]

function setTool(tool: Tool): void {
  if (!api) return
  api.setActiveTool(tool === 'sticky' ? { type: 'custom', customType: 'sticky' } : { type: tool })
}

/** Стикер в точке клика: карточка без обводки, выделена и сразу в режиме ввода текста. */
function placeSticky(x: number, y: number): void {
  if (!api) return
  const [rect] = convertToExcalidrawElements([{
    type: 'rectangle', x: x - STICKY.w / 2, y: y - STICKY.h / 2, width: STICKY.w, height: STICKY.h,
    backgroundColor: STICKY.fill, fillStyle: 'solid', strokeColor: 'transparent', strokeWidth: 1, roughness: 0, roundness: null,
  } as never]) as unknown as Array<{ id: string }>
  if (!rect) return
  api.updateScene({
    elements: [...api.getSceneElements(), rect],
    appState: { selectedElementIds: { [rect.id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
  api.setActiveTool({ type: 'selection' })
  // Двойной клик по карточке — штатный вход Excalidraw в ввод подписи: печатать можно сразу.
  const at = lastPointer
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const canvas = document.querySelector('.excalidraw canvas.interactive') ?? document.querySelector('.excalidraw canvas:last-of-type')
    if (!canvas || !at) return
    canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, view: window }))
  }))
}

/** Где на экране нажали в последний раз: туда ставится стикер и туда же — двойной клик для ввода текста. */
let lastPointer: { x: number; y: number } | null = null
document.addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY } }, true)

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function Toolbar({ active }: { active: Tool }): ReactElement {
  return h('div', { className: 'fj-bar', role: 'toolbar', 'aria-label': 'Инструменты доски' },
    TOOLS.map((t) => h('button', {
      key: t.id, type: 'button', className: `fj-tool${active === t.id ? ' on' : ''}`, title: `${t.label} · ${t.key}`, 'aria-label': t.label, 'aria-pressed': active === t.id,
      onClick: () => setTool(t.id),
    }, h('svg', { viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d: ICONS[t.id] })), h('span', null, t.label))))
}

function Board(): ReactElement {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const [active, setActive] = useState<Tool>('selection')
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    const keys: Record<string, Tool> = { s: 'sticky', ы: 'sticky' }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const tool = keys[e.key.toLowerCase()]
      if (tool) { e.preventDefault(); e.stopPropagation(); setTool(tool) }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])
  const saved = w.PLAN?.scene ?? null
  const appState = { ...CLEAN, ...(saved?.appState ?? {}), ...CLEAN, collaborators: new Map() }
  return h('div', { className: 'fj' },
    h(Excalidraw as never, {
      excalidrawAPI: (a: Api) => { api = a },
      initialData: { elements: saved?.elements ?? [], appState, files: saved?.files ?? {} },
      theme: dark ? 'dark' : 'light',
      langCode: 'ru-RU',
      viewModeEnabled: !!w.PLAN?.readOnly,
      onChange: (_els: unknown, state: { activeTool?: { type: string; customType?: string } }) => {
        const t = state.activeTool
        const now: Tool = t?.type === 'custom' && t.customType === 'sticky' ? 'sticky' : (['hand', 'text', 'arrow'].includes(t?.type ?? '') ? t!.type as Tool : 'selection')
        setActive((prev) => (prev === now ? prev : now))
        w.planBoard?.onChange?.()
      },
      onPointerDown: (tool: { type: string; customType?: string }, down: { origin: { x: number; y: number } }) => {
        if (tool.type === 'custom' && tool.customType === 'sticky') placeSticky(down.origin.x, down.origin.y)
      },
      UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false, changeViewBackgroundColor: false, clearCanvas: false }, tools: { image: false } },
    }),
    h(Toolbar, { active }))
}

w.planBoard = {
  ...w.planBoard,
  scene: () => (api ? serializeAsJSON(api.getSceneElements() as never, api.getAppState() as never, api.getFiles() as never, 'local') : '{}'),
  empty: () => !api || api.getSceneElements().filter((e) => !e.isDeleted).length === 0,
  svg: async () => {
    if (!api) return ''
    const svg = await exportToSvg({
      elements: api.getSceneElements() as never,
      appState: { ...api.getAppState(), exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: '#ffffff' } as never,
      files: api.getFiles() as never,
      exportPadding: 24,
    })
    return svg.outerHTML
  },
}

const root = document.getElementById('board')
if (root) createRoot(root).render(h(Board))
