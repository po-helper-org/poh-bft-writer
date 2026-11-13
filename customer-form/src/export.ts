/**
 * Выгрузка документа БФТ (ADR-0012, шаг 5) для заказчика: .md — текст без
 * служебного, .docx — pandoc, .pdf — pandoc (html) и WeasyPrint (html → pdf).
 *
 * В .docx и .pdf не попадают служебные блоки для PO: открытое поле
 * «⏳ Полный БФТ — в проработке» (bft-fast) и «Продолжить / уточнить БФТ»
 * (bft-deep) — это промты для Claude Code, заказчику они не нужны.
 * Готовые файлы кэшируются рядом с документом и пересобираются, когда .md новее.
 */
import { execFile } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export type ExportFormat = 'md' | 'docx' | 'pdf'

export const EXPORT_TYPES: Record<ExportFormat, string> = {
  md: 'text/markdown; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
}

const SERVICE_HEADS = ['## ⏳ Полный БФТ — в проработке', '## Продолжить / уточнить БФТ']

/** Документ без frontmatter и служебных блоков для PO — то, что читает заказчик. */
export function customerMarkdown(markdown: string): string {
  let body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '')
  body = body.replace(/<!-- BFT-HEAD-END[^>]*-->\n?/g, '')
  // «Общая информация» — служебные поля для PO (rev21): заказчику не нужна.
  body = body.replace(/^### Общая информация\n[\s\S]*?(?=^#{2,3} )/m, '')
  for (const head of SERVICE_HEADS) {
    const at = body.indexOf(head)
    if (at >= 0) body = body.slice(0, at)
  }
  return `${body.trimEnd()}\n`
}

const PDF_CSS = `@page { size: A4; margin: 18mm 16mm; @bottom-right { content: counter(page) " / " counter(pages); font: 9pt sans-serif; color: #888; } }
body { font: 10.5pt/1.45 "DejaVu Serif", Georgia, serif; color: #111; }
h1 { font-size: 17pt; margin: 0 0 10pt; }
h2 { font-size: 13pt; margin: 16pt 0 6pt; border-bottom: 1px solid #ccc; padding-bottom: 2pt; }
h3 { font-size: 11pt; margin: 12pt 0 4pt; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9pt; }
th, td { border: 1px solid #bbb; padding: 3pt 4pt; vertical-align: top; text-align: left; }
th { background: #f2f2f2; }
code, pre { font: 8.5pt "DejaVu Sans Mono", monospace; }
pre { background: #f6f6f6; padding: 6pt; white-space: pre-wrap; }
img { max-width: 100%; height: auto; display: block; margin: 6pt auto; }
`

function run(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 120_000, maxBuffer: 8 << 20, ...(env ? { env } : {}) }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${cmd}: ${(stderr || error.message).toString().slice(0, 600)}`))
      else resolve()
    })
  })
}

/**
 * Схемы PlantUML (сценарий приёмки bft-deep) — картинкой: каждый блок
 * ```plantuml рендерится в PNG рядом с документом (plantuml в образе, локально)
 * и заменяется ссылкой на него. Не отрендерился — остаётся кодом, как раньше.
 */
async function renderDiagrams(markdown: string, dir: string, base: string): Promise<string> {
  let out = markdown
  let index = 0
  for (const match of markdown.matchAll(/```plantuml\n([\s\S]*?)\n```/g)) {
    index += 1
    const name = `${base}.diagram-${index}`
    const source = match[1]!.replace(/^@startuml.*$/m, (head) => `${head}\nskinparam dpi 150\nskinparam defaultFontName "DejaVu Sans"`)
    await writeFile(join(dir, `${name}.puml`), source, 'utf8')
    try {
      await run('plantuml', ['-tpng', '-charset', 'UTF-8', `${name}.puml`], dir, { ...process.env, JAVA_TOOL_OPTIONS: '-Djava.awt.headless=true' })
      out = out.replace(match[0], `![Сценарий приёмки](${name}.png)`)
    } catch (e) {
      console.error('[customer-form] схема PlantUML не отрендерилась, в выгрузке останется кодом:', e)
    }
  }
  return out
}

/** Версия выгрузки: меняется — кэш .docx/.pdf собирается заново (v2 — схемы картинками). */
const EXPORT_VERSION = 'v2'

const mtime = (path: string) => stat(path).then((s) => s.mtimeMs, () => 0)

/**
 * Путь к файлу выгрузки документа `mdPath` в формате `format`; собирает при
 * первом запросе и после изменения документа.
 */
export async function exportDocument(mdPath: string, format: ExportFormat): Promise<string> {
  const dir = dirname(mdPath)
  const base = basename(mdPath, '.md')
  // .md заказчику — тот же текст, что в .docx и .pdf: без frontmatter и служебных блоков PO.
  const source = join(dir, `${base}.customer.md`)
  const out = format === 'md' ? source : join(dir, `${base}.export-${EXPORT_VERSION}.${format}`)
  if (await mtime(out) >= await mtime(mdPath)) return out
  await writeFile(source, customerMarkdown(await readFile(mdPath, 'utf8')), 'utf8')
  if (format === 'md') return source
  // Для .docx/.pdf — схемы картинками; .md остаётся с исходным PlantUML.
  const rendered = join(dir, `${base}.render.md`)
  await writeFile(rendered, await renderDiagrams(await readFile(source, 'utf8'), dir, base), 'utf8')
  const from = ['-f', 'gfm']
  if (format === 'docx') {
    await run('pandoc', [...from, '-o', out, rendered], dir)
  } else {
    const css = join(dir, 'export.css')
    const html = join(dir, `${base}.print.html`)
    await writeFile(css, PDF_CSS, 'utf8')
    // pagetitle, не title: заголовок документа — его собственный «# [БФТ] …», без дубля сверху.
    await run('pandoc', [...from, '-s', '--metadata', `pagetitle=${base}`, '-c', 'export.css', '-o', html, rendered], dir)
    await run('weasyprint', [html, out], dir)
  }
  return out
}
