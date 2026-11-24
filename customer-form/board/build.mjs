// Бандл доски «Планирование» (ADR-0025): React + Excalidraw одним файлом board.js и board.css.
// Страница не ходит в CDN: шрифты Excalidraw (кроме китайского Xiaolai, 12 МБ) встраиваются data-URL —
// маршрут портала с ?f= не умеет относительных путей, которыми Excalidraw их грузит.
import { build } from 'esbuild'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const FONTS = 'node_modules/@excalidraw/excalidraw/dist/prod/'
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })
await build({
  entryPoints: { board: 'src/board.tsx' },
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  outdir: 'dist',
  conditions: ['production'],
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.IS_PREACT': '"false"' },
  loader: { '.woff2': 'dataurl', '.ttf': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl' },
  logLevel: 'warning',
})
const js = readFileSync('dist/board.js', 'utf8')
let inlined = 0
const out = js.replace(/"\.\/(fonts\/(?!Xiaolai)[\w./-]+\.woff2)"/g, (_, path) => {
  inlined++
  return `"data:font/woff2;base64,${readFileSync(FONTS + path).toString('base64')}"`
})
writeFileSync('dist/board.js', out)
console.log(`board: dist/board.js (${(out.length / 1e6).toFixed(1)} МБ, шрифтов встроено ${inlined}), dist/board.css`)
