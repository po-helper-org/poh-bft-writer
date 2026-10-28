/**
 * Быстрая версия БФТ прямо в чате заказчика (ADR-0007 rev14).
 *
 * Модель портала раскладывает подтверждённый заказчиком запрос по полям
 * (SMART, границы, персоны, требования на цитатах), а скелет документа
 * собирает код — по контракту skills/bft-fast/resources/document_assembly.md,
 * байт-в-байт как у /bft-fast: тот же frontmatter, шапка, строка-граница и
 * открытое поле для /bft-deep. Дальше — штатные bft-lint.py и
 * bft-html-export.py навыка: документ и страница ревью те же, что у PO.
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface FastPersona { name: string; role?: string; influence?: string }
export interface FastRequirement { id: string; asis?: string; tobe: string; related?: string[] | string; source: string }

/** Что модель раскладывает из диалога; How to demo берётся из согласованного сценария. */
export interface FastInput {
  title: string
  smart: { s: string; m?: string; a?: string; r?: string; t?: string }
  boundaries: string[]
  documentation?: string[]
  personas: FastPersona[]
  requirements: FastRequirement[]
  openQuestions?: string[]
}

export interface FastContext {
  slug: string
  howToDemo: string[]
  /** Откуда взят текст запроса — строка «Источник Summary» открытого поля. */
  source: string
  skillsPath: string
  date?: string
}

/** Каталог навыков в образе (Dockerfile: COPY skills /opt/bft-skills). */
export const SKILLS_PATH = process.env.BFT_SKILLS_PATH ?? '/opt/bft-skills'
/** Документы fast по заявкам: <DSH_HOME>/bft-fast/<slug>/<slug>-fast.{md,html}. */
export const FAST_ROOT = `${process.env.DSH_HOME ?? '/data'}/bft-fast`
export const fastSlug = (taskId: number) => `zayavka-${taskId}`
/** Путь страницы документа на узле портала. */
export const fastPagePath = (sessionId: string) => `/api/customer-form.bftFast?session=${encodeURIComponent(sessionId)}`
/** Полный адрес для чата: относительную ссылку чат dsh показывает текстом, без перехода. */
export const portalUrl = (path: string) => `${(process.env.PORTAL_PUBLIC_URL ?? 'http://127.0.0.1:3080').replace(/\/+$/, '')}${path}`
export const fastPageUrl = (sessionId: string) => portalUrl(fastPagePath(sessionId))

/**
 * Ход сборки документа (rev16): от «Согласую» на сценарии до готовой страницы.
 * Правая панель показывает его заказчику, пока модель раскладывает требования.
 * В памяти: после рестарта сборки нет — показывается готовый документ.
 */
export type FastStage = 'approved' | 'submitted' | 'building' | 'ready'
export interface FastProgress { stage: FastStage; startedAt: string }

class ProgressRegistry {
  private readonly items = new Map<string, FastProgress>()
  start(sessionId: string): void {
    this.items.set(sessionId, { stage: 'approved', startedAt: new Date().toISOString() })
  }
  /** Следующий этап; пересборка по замечаниям начинает отсчёт заново. */
  stage(sessionId: string, stage: FastStage): void {
    const current = this.items.get(sessionId)
    const fresh = !current || current.stage === 'ready'
    this.items.set(sessionId, { stage, startedAt: fresh ? new Date().toISOString() : current.startedAt })
  }
  get(sessionId: string): FastProgress | undefined {
    return this.items.get(sessionId)
  }
}

let progress: ProgressRegistry | undefined
export const fastProgress = (progress ??= new ProgressRegistry())

const TYPES = ['БТ', 'ПТ', 'ИТ', 'ФТ', 'НФТ'] as const
const ID = /^(БТ|ПТ|ИТ|ФТ|НФТ)-([1-9]\d*)$/
const UNKNOWN = '[УТОЧНИТЬ]'
export const BORDER = '<!-- BFT-HEAD-END · ГРАНИЦА ШАПКИ · выше bft-fast, ниже bft-deep · шапку не затирать -->'

/** Ячейка таблицы: одна строка, без вертикальной черты. */
const cell = (value: string | undefined, fallback = UNKNOWN) =>
  (value ?? '').replace(/\s+/g, ' ').replace(/\|/g, '/').trim() || fallback

const relatedOf = (r: FastRequirement): string[] =>
  (Array.isArray(r.related) ? r.related : String(r.related ?? '').split(/[,;\s]+/)).map((x) => x.trim()).filter(Boolean)

/**
 * Требования в порядке БТ→ПТ→ИТ→ФТ→НФТ; ошибки формы — модели на исправление
 * (ID, пустой TOBE или цитата, связь на несуществующую строку).
 */
export function checkRequirements(input: FastInput): { rows: FastRequirement[]; errors: string[] } {
  const errors: string[] = []
  const rows = input.requirements ?? []
  if (!rows.length) errors.push('Нет ни одного требования: нужна хотя бы одна строка БТ из слов заказчика.')
  const ids = new Set<string>()
  for (const r of rows) {
    if (!ID.test(r.id ?? '')) errors.push(`ID «${r.id}» не по форме ТИП-N (БТ-1, ПТ-2, ИТ-1, ФТ-1, НФТ-1).`)
    if (ids.has(r.id)) errors.push(`ID ${r.id} повторяется.`)
    ids.add(r.id)
    if (!r.tobe?.trim()) errors.push(`${r.id}: пустой TOBE.`)
    if (!r.source?.trim()) errors.push(`${r.id}: нет цитаты-источника — строка без цитаты не пишется.`)
  }
  for (const r of rows) {
    for (const link of relatedOf(r)) if (!ids.has(link)) errors.push(`${r.id}: связь на ${link}, такой строки нет.`)
  }
  const rank = (id: string) => {
    const m = ID.exec(id)
    return m ? TYPES.indexOf(m[1] as typeof TYPES[number]) * 1000 + Number(m[2]) : 99999
  }
  return { rows: [...rows].sort((a, b) => rank(a.id) - rank(b.id)), errors }
}

/** Текст промта открытого поля — дословно из open_field.md навыка, подстановки — по таблице «Поля контекста». */
export function openFieldPrompt(template: string, ctx: FastContext): string {
  const body = /## Шаблон промта[\s\S]*?```text\n([\s\S]*?)\n```/.exec(template)?.[1]
  if (!body) throw new Error('open_field.md: не найден шаблон промта')
  return body
    .replaceAll('<skills_path>', ctx.skillsPath)
    .replace('- epic_slug: <epic_slug>', `- epic_slug: ${ctx.slug}`)
    .replace('<путь или URL источника>', ctx.source)
    .replace('<URL страницы | не опубликовано>', 'не опубликовано')
    .replace('<hash | [УТОЧНИТЬ]>', UNKNOWN)
}

export function fastDocument(input: FastInput, ctx: FastContext, prompt: string): string {
  const { rows } = checkRequirements(input)
  const date = ctx.date ?? new Date().toISOString().slice(0, 10)
  const title = cell(input.title, ctx.slug)
  const smart = input.smart ?? { s: '' }
  const personas = (input.personas ?? []).filter((p) => p.name?.trim())
  const lines = [
    '---',
    'source: "[УТОЧНИТЬ — не опубликовано]"',
    'space: "[wiki_space не задан]"',
    'pageId: pending',
    'version: 0.1',
    `synced: ${date}`,
    'jira: "[СОЗДАТЬ эпик]"',
    'status: Черновик 0.1 (fast — шапка; deep не запускался)',
    `epic_slug: ${ctx.slug}`,
    'stage: fast',
    'pin_commit: "[УТОЧНИТЬ]"',
    '---',
    '',
    `# [БФТ] ${ctx.slug}: ${title}`,
    '',
    '## Шапка (сутевое описание запроса)',
    '',
    '### Цель',
    '',
    '| SMART | Значение |',
    '|---|---|',
    `| S (Specific) | ${cell(smart.s)} |`,
    `| M (Measurable) | ${cell(smart.m)} |`,
    `| A (Achievable) | ${cell(smart.a)} |`,
    `| R (Relevant) | ${cell(smart.r)} |`,
    `| T (Time-bound) | ${cell(smart.t)} |`,
    '',
    '### How to demo',
    '',
    ...ctx.howToDemo.map((step, i) => `${i + 1}. ${step.replace(/\s+/g, ' ').trim()}`),
    '',
    '### Ограничения и договоренности',
    '',
    ...(input.boundaries?.length ? input.boundaries : [`Границы запроса заказчик не называл ${UNKNOWN}`]).map((b) => `* ${b.replace(/\s+/g, ' ').trim()}`),
    '',
  ]
  const docs = (input.documentation ?? []).map((d) => d.trim()).filter(Boolean)
  if (docs.length) lines.push('### Документация', '', ...docs.map((d) => `* ${d}`), '')
  lines.push(
    '### Критичные требования (скелет на цитатах)',
    '',
    'Персоны (домен знаний):',
    '',
    '| ФИО | Роль | Влияние |',
    '|---|---|---|',
    ...personas.map((p) => `| ${cell(p.name)} | ${cell(p.role, '[роль не подтверждена]')} | ${cell(p.influence, '[не указано]')} |`),
    '',
    'Роль/влияние — из сказанного заказчиком; неизвестное помечено. Вес цитаты зависит от роли.',
    '',
    'Требования:',
    '',
    '| ID | ASIS (сейчас) | TOBE (после) | Связанные | Источник (цитата) |',
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${cell(r.asis, '[ASIS не озвучен]')} | ${cell(r.tobe)} | ${relatedOf(r).join(', ')} | ${cell(r.source)} |`),
    '',
    'Только зафиксированное в диалоге с заказчиком. ASIS без реплики — [ASIS не озвучен]. Обогащение — на этапе глубокой проработки.',
    '',
    '### Общая информация',
    '',
    '| Поле | Значение |',
    '| --- | --- |',
    `| Название проекта | ${title} |`,
    `| Ответственный за продукт | ${UNKNOWN} |`,
    `| Ответственный за документ | ${UNKNOWN} |`,
    '| Задача/Epic Jira | [СОЗДАТЬ эпик] |',
    '| Статус | АНАЛИЗ |',
    `| Системные требования | ${UNKNOWN} |`,
    '',
    BORDER,
    '',
    '## ⏳ Полный БФТ — в проработке',
    '',
    'Собрана только шапка (bft-fast). Полный БФТ по корпоративному шаблону ещё не построен.',
    '',
    '<details>',
    '<summary>▶ Довести до полного БФТ — промт для Claude Code (скопируй в свою сессию)</summary>',
    '',
    '```text',
    prompt,
    '```',
    '',
    '</details>',
    '',
  )
  return lines.join('\n')
}

/** csv по requirements_table.md: UTF-8 с BOM, запятая, кавычки RFC-4180. */
function csv(rows: string[][]): string {
  const field = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  return '﻿' + rows.map((r) => r.map(field).join(',')).join('\r\n') + '\r\n'
}

export function personasCsv(input: FastInput): string {
  return csv([['ФИО', 'Роль', 'Влияние'], ...(input.personas ?? []).filter((p) => p.name?.trim())
    .map((p) => [cell(p.name), cell(p.role, '[роль не подтверждена]'), cell(p.influence, '[не указано]')])])
}

export function requirementsCsv(input: FastInput): string {
  return csv([['ID', 'ASIS (сейчас)', 'TOBE (после)', 'Связанные', 'Источник (цитата)'],
    ...checkRequirements(input).rows.map((r) => [r.id, cell(r.asis, '[ASIS не озвучен]'), cell(r.tobe), relatedOf(r).join(', '), cell(r.source)])])
}

export interface FastFiles { dir: string; md: string; html: string; personas: string; requirements: string; approval: string; input: string }

export function fastFiles(root: string, slug: string): FastFiles {
  const dir = join(root, slug)
  return {
    dir,
    md: join(dir, `${slug}-fast.md`),
    html: join(dir, `${slug}-fast.html`),
    personas: join(dir, 'personas.csv'),
    requirements: join(dir, 'requirements.csv'),
    approval: join(dir, 'approval.json'),
    input: join(dir, 'input.json'),
  }
}

/** Версия документа — хэш содержимого: согласование относится к одной версии. */
export function docHash(markdown: string): string {
  return createHash('sha1').update(markdown).digest('hex').slice(0, 12)
}

export interface FastState { rev: string; approvedAt?: string }

/** Что сейчас с документом: версия и согласование этой версии (пересборка его снимает). */
export async function fastState(files: FastFiles): Promise<FastState | undefined> {
  const markdown = await readFile(files.md, 'utf8').catch(() => undefined)
  if (markdown === undefined) return undefined
  const rev = docHash(markdown)
  const approval = await readFile(files.approval, 'utf8').then((s) => JSON.parse(s) as { rev?: string; approvedAt?: string }).catch(() => undefined)
  return approval?.rev === rev && approval.approvedAt ? { rev, approvedAt: approval.approvedAt } : { rev }
}

export async function approveFast(files: FastFiles): Promise<FastState> {
  const state = await fastState(files)
  if (!state) throw new Error('документ ещё не собран')
  if (state.approvedAt) return state
  const approved = { rev: state.rev, approvedAt: new Date().toISOString() }
  await writeFile(files.approval, JSON.stringify(approved), 'utf8')
  return approved
}

function python(script: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('python3', [script, ...args], { timeout: 60_000, maxBuffer: 4 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 127) : 0
      resolve({ code, out: `${stdout}${stderr}`.trim() || (error?.message ?? '') })
    })
  })
}

/**
 * Записать документ и csv, прогнать линтер (ошибки — модели на исправление,
 * файл с ошибками не остаётся «готовым») и собрать страницу ревью.
 */
export async function buildFast(input: FastInput, ctx: FastContext, root: string): Promise<
  { ok: true; files: FastFiles; markdown: string } | { ok: false; errors: string }
> {
  const { errors } = checkRequirements(input)
  if (!ctx.howToDemo.length) errors.push('Нет согласованного сценария приёмки: сначала confirm_acceptance_demo и «Согласую».')
  if (!input.smart?.s?.trim()) errors.push('SMART S (Specific) пустой: что именно делаем — словами заказчика.')
  if (errors.length) return { ok: false, errors: errors.join('\n') }
  const template = await readFile(join(ctx.skillsPath, 'bft-fast/resources/open_field.md'), 'utf8')
  const markdown = fastDocument(input, ctx, openFieldPrompt(template, ctx))
  const files = fastFiles(root, ctx.slug)
  await mkdir(files.dir, { recursive: true })
  await writeFile(files.md, markdown, 'utf8')
  await writeFile(files.personas, personasCsv(input), 'utf8')
  await writeFile(files.requirements, requirementsCsv(input), 'utf8')
  // Поля как есть — из них страница собирает сводку для заказчика (fast-page.ts).
  await writeFile(files.input, JSON.stringify({ ...input, requirements: checkRequirements(input).rows, howToDemo: ctx.howToDemo }), 'utf8')
  const lint = await python(join(ctx.skillsPath, 'bft-writer/scripts/bft-lint.py'), [files.md])
  if (lint.code !== 0) return { ok: false, errors: `bft-lint.py:\n${lint.out}` }
  const html = await python(join(ctx.skillsPath, 'bft-writer/scripts/bft-html-export.py'), [files.md])
  if (html.code !== 0) throw new Error(`страница ревью не собрана: ${html.out}`)
  return { ok: true, files, markdown }
}
