/**
 * Выгрузка документа БФТ (ADR-0012, шаг 5): .md как есть, .docx и .pdf для
 * заказчика — pandoc (docx, html) и WeasyPrint (html → pdf).
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
`

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 120_000, maxBuffer: 8 << 20 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${cmd}: ${(stderr || error.message).toString().slice(0, 600)}`))
      else resolve()
    })
  })
}

const mtime = (path: string) => stat(path).then((s) => s.mtimeMs, () => 0)

/**
 * Путь к файлу выгрузки документа `mdPath` в формате `format`; собирает при
 * первом запросе и после изменения документа.
 */
export async function exportDocument(mdPath: string, format: ExportFormat): Promise<string> {
  if (format === 'md') return mdPath
  const dir = dirname(mdPath)
  const base = basename(mdPath, '.md')
  const out = join(dir, `${base}.export.${format}`)
  if (await mtime(out) >= await mtime(mdPath)) return out
  const source = join(dir, `${base}.customer.md`)
  await writeFile(source, customerMarkdown(await readFile(mdPath, 'utf8')), 'utf8')
  const from = ['-f', 'gfm']
  if (format === 'docx') {
    await run('pandoc', [...from, '-o', out, source], dir)
  } else {
    const css = join(dir, 'export.css')
    const html = join(dir, `${base}.print.html`)
    await writeFile(css, PDF_CSS, 'utf8')
    // pagetitle, не title: заголовок документа — его собственный «# [БФТ] …», без дубля сверху.
    await run('pandoc', [...from, '-s', '--metadata', `pagetitle=${base}`, '-c', 'export.css', '-o', html, source], dir)
    await run('weasyprint', [html, out], dir)
  }
  return out
}
