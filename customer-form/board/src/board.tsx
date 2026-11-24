/**
 * Доска экрана «Планирование» (ADR-0025): Excalidraw на всю правую половину.
 * Страница (plan-page.ts) кладёт в window.PLAN сохранённую сцену и путь к шрифтам,
 * а при «Сохранить» берёт у window.planBoard сцену (JSON .excalidraw) и SVG доски.
 */
import { Excalidraw, exportToSvg, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import { createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

type Api = {
  getSceneElements(): readonly unknown[]
  getAppState(): Record<string, unknown>
  getFiles(): Record<string, unknown>
}

interface PlanWindow {
  PLAN?: { scene?: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> } | null; readOnly?: boolean }
  planBoard?: { scene(): string; svg(): Promise<string>; empty(): boolean; onChange?: () => void }
}

const w = window as unknown as PlanWindow
let api: Api | null = null

function Board() {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const m = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const saved = w.PLAN?.scene ?? null
  return createElement(Excalidraw as never, {
    excalidrawAPI: (a: Api) => { api = a },
    initialData: saved ? { elements: saved.elements ?? [], appState: { ...(saved.appState ?? {}), collaborators: new Map() }, files: saved.files ?? {} } : null,
    theme: dark ? 'dark' : 'light',
    langCode: 'ru-RU',
    viewModeEnabled: !!w.PLAN?.readOnly,
    onChange: () => w.planBoard?.onChange?.(),
    UIOptions: { canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: true } },
  })
}

w.planBoard = {
  ...w.planBoard,
  scene: () => (api ? serializeAsJSON(api.getSceneElements() as never, api.getAppState() as never, api.getFiles() as never, 'local') : '{}'),
  empty: () => !api || api.getSceneElements().filter((e) => !(e as { isDeleted?: boolean }).isDeleted).length === 0,
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
if (root) createRoot(root).render(createElement(Board))
