#!/usr/bin/env node
// Метрики качества полного БФТ по папкам заявок (план качества, C0).
//
//   node scripts/quality-metrics.mjs <папка> [<папка> …]  → JSON { <папка>: { metrics, details } }
//
// Папка — каталог заявки портала (<slug>.md, <slug>-fast.md, sources.md, …) или
// out/ прогона качества (fast.md, <имя>.md, sources.md, deep.json, primary.json).
// Раунды сравниваются diff'ом вывода. Нужна сборка: npm test (lib-test) или npm run build (lib).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const built = ['../lib-test/quality-metrics.js', '../lib/quality-metrics.js'].map((p) => join(here, p)).find(existsSync)
if (!built) {
  console.error('quality-metrics: нет сборки — сначала npm test (lib-test) или npm run build (lib)')
  process.exit(2)
}
const { qualityMetrics } = await import(built)

const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)
// Канон эталона навыка — для golden_ngram_leaks (как в портале: без шапки и «Продолжить»).
const goldenMd = read(join(here, '..', '..', 'skills/bft-deep-swarm/examples/golden_deep_document.md'))
const deepLib = ['../lib-test/bft-deep.js', '../lib/bft-deep.js'].map((p) => join(here, p)).find(existsSync)
const golden = goldenMd && deepLib ? (await import(deepLib)).goldenCanon(goldenMd) : undefined
const json = (path) => { const t = read(path); return t ? JSON.parse(t) : undefined }

function metricsFor(dir) {
  const files = readdirSync(dir)
  const fastName = files.find((f) => f === 'fast.md') ?? files.find((f) => f.endsWith('-fast.md'))
  const skip = new Set([fastName, 'sources.md', 'context_map.md'])
  const deepName = files.find((f) => f.endsWith('.md') && !skip.has(f) && !f.endsWith('-fast.md') && !f.includes('istochniki'))
  if (!fastName || !deepName) throw new Error(`${dir}: нет fast.md/<slug>-fast.md или документа deep`)
  const deep = json(join(dir, 'deep.json'))
  const metricsJson = json(join(dir, 'metrics.json'))
  const primary = json(join(dir, 'primary.json')) ?? json(join(dir, '..', 'primary.json'))
  const intake = json(join(dir, 'intake.json')) ?? json(join(dir, '..', 'intake.json'))
  const reconMs = metricsJson?.metrics?.recon_ms ?? undefined
  return qualityMetrics({
    doc: read(join(dir, deepName)),
    fastMd: read(join(dir, fastName)),
    sourcesMd: read(join(dir, 'sources.md')) ?? '',
    contextMd: read(join(dir, 'context_map.md')) ?? read(join(dir, '..', 'context_map.md')) ?? '',
    ...(primary ? { primary } : {}),
    ...(intake ? { intake } : {}),
    ...(deep?.quality ? { quality: deep.quality } : {}),
    ...(deep?.stage ? { stage: deep.stage } : {}),
    ...(typeof reconMs === 'number' ? { reconMs } : {}),
    ...(golden ? { golden } : {}),
  })
}

const dirs = process.argv.slice(2)
if (!dirs.length) {
  console.error('использование: node scripts/quality-metrics.mjs <папка заявки> [<папка> …]')
  process.exit(2)
}
const out = {}
for (const dir of dirs) {
  const abs = resolve(dir)
  const name = basename(abs) === 'out' ? basename(dirname(abs)) : basename(abs)
  out[name] = metricsFor(abs)
}
console.log(JSON.stringify(out, null, 2))
