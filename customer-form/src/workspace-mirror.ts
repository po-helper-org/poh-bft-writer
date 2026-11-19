/**
 * Заявки в «Файлах рабочей области» портала (правая панель «Старт»).
 *
 * Файловая вкладка dsh показывает только каталог workspace сессии
 * (<DSH_HOME>/Customer-requests), а документы заявки живут в
 * <DSH_HOME>/bft-fast/zayavka-N/. Ссылки наружу workspace dsh не читает
 * (последний симлинк пути отклоняется), поэтому здесь — настоящие копии:
 * на каждую заявку папка «Заявка N — <название>» с запросом заказчика,
 * сценарием приёмки, первичными требованиями, полным БФТ и картой источников.
 *
 * Зеркало идемпотентно: mirrorRequest пересобирает папку целиком из того, что
 * лежит на диске, и его зовут после каждого шага (заявка, сценарий, сдача,
 * fast, согласование, полный БФТ) и при старте узла — для старых заявок.
 * Запись — через временный файл вне workspace и rename: наблюдатель файлов не
 * видит полузаписанных файлов. Workspace общий для всех посетителей портала —
 * так же, как доска «Все заявки».
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FAST_ROOT, fastFiles, fastSlug, fastState } from './bft-fast.js'
import { deepFiles, readDeepState } from './bft-deep.js'
import { sharedDemos, storyboardMarkdown, type DemoRecord } from './demo.js'
import { moscowTime } from './host.js'
import type { IntakeFile } from './intake.js'

const HOME = () => process.env.DSH_HOME ?? '/data'
/** Каталог workspace заказчика — тот же, что отдаёт /api/customer-form.workspacePath. */
export const workspaceRoot = (): string => join(HOME(), 'Customer-requests')
/** Временные файлы зеркала: та же файловая система, что у workspace, но вне него. */
const tmpRoot = (): string => join(HOME(), 'customer-form', 'mirror-tmp')

/** Первое сообщение заказчика рядом с документами заявки (пишет узел при регистрации). */
export const requestTextPath = (taskId: number): string => join(fastFiles(FAST_ROOT, fastSlug(taskId)).dir, 'request.txt')

/** Файлы, которыми зеркало владеет в папке заявки: чужие оно не трогает. */
export const MIRROR_FILES = {
  request: 'Запрос заказчика.md',
  demo: 'Сценарий приёмки.md',
  fast: 'Первичные требования (bft-fast).md',
  deep: 'БФТ.md',
  sources: 'Источники (Jira, Confluence).md',
  context: 'Карта контекста (Кортекс).md',
  answers: 'Ответы на вопросы (форма).md',
} as const

/** Имя папки заявки: «Заявка N — название» без символов, которые не всякая ФС примет. */
export function folderName(taskId: number, title: string | undefined): string {
  const clean = (title ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '')
  const short = clean.length > 70 ? `${clean.slice(0, 70).replace(/\s+\S*$/, '')}…` : clean
  return short ? `Заявка ${taskId} — ${short}` : `Заявка ${taskId}`
}

/** Папка этой заявки среди уже созданных: «Заявка N» или «Заявка N — …» (не «Заявка N1…»). */
export function isFolderOf(taskId: number, name: string): boolean {
  return name === `Заявка ${taskId}` || name.startsWith(`Заявка ${taskId} — `)
}

/** Название заявки: из сдачи (intake), из документа fast, иначе — первая строка обращения. */
export function requestTitle(intake: IntakeFile | undefined, primaryTitle: string | undefined, firstText: string | undefined): string | undefined {
  const fromIntake = typeof intake?.title === 'string' ? intake.title.trim() : ''
  if (fromIntake) return fromIntake
  if (primaryTitle?.trim()) return primaryTitle.trim()
  const line = (firstText ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  if (!line) return undefined
  return line.length > 60 ? `${line.slice(0, 60).replace(/\s+\S*$/, '')}…` : line
}

export interface RequestSnapshot {
  taskId: number
  title?: string | undefined
  firstText?: string | undefined
  intake?: IntakeFile | undefined
  demo?: DemoRecord | undefined
  fastApprovedAt?: string | undefined
  fastBuilt: boolean
  deepStage?: string | undefined
}

const list = (items: readonly unknown[] | undefined): string[] =>
  (items ?? []).map((v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')).filter(Boolean)

/** «Запрос заказчика.md»: что он просил (дословно) и как это понял ассистент; где сейчас заявка. */
export function requestMarkdown(s: RequestSnapshot): string {
  const intake = s.intake ?? {}
  const quote = (s.firstText ?? '').trim()
  const section = (head: string, body: string | undefined) => (body?.trim() ? [`## ${head}`, '', body.trim(), ''] : [])
  const bullets = (head: string, items: string[]) => (items.length ? [`## ${head}`, '', ...items.map((i) => `- ${i}`), ''] : [])
  const glossary = Array.isArray(intake.glossary) ? intake.glossary.map((g) => `**${g.term}** — ${g.meaning}`) : []
  const status = [
    s.demo ? `- Сценарий приёмки: ${s.demo.approvedAt ? `согласован ${moscowTime(s.demo.approvedAt)}` : 'на согласовании'}` : '- Сценарий приёмки: ещё не составлен',
    s.fastBuilt ? `- Первичные требования: ${s.fastApprovedAt ? `согласованы ${moscowTime(s.fastApprovedAt)}` : 'на согласовании'}` : '- Первичные требования: ещё не собраны',
    `- Полный БФТ: ${s.deepStage === 'ready' ? 'готов' : s.deepStage === 'building' ? 'собирается' : s.deepStage === 'failed' ? 'не собран (сбой сборки)' : 'соберётся после согласования первичных требований'}`,
  ]
  return [
    `# Заявка ${s.taskId}${s.title ? ` — ${s.title}` : ''}`,
    '',
    '## Что попросил заказчик',
    '',
    quote ? quote.split('\n').map((l) => `> ${l}`).join('\n') : '_Текст обращения не сохранился — смотрите диалог заявки._',
    '',
    ...section('Суть', typeof intake.summary === 'string' ? intake.summary : undefined),
    ...section('ASIS — как сейчас', intake.asis),
    ...section('GAP — что не устраивает', intake.gap),
    ...section('TOBE — как должно стать', intake.tobe),
    ...bullets('Глоссарий', glossary),
    ...bullets('Ссылки', list(intake.links)),
    ...bullets('Открытые вопросы', list(intake.openQuestions)),
    '## Где сейчас заявка',
    '',
    ...status,
    '',
  ].join('\n')
}

/** «Сценарий приёмки.md»: раскадровка и чек-лист — тот же текст, что в карточке согласования. */
export function demoMarkdown(record: DemoRecord): string {
  const stamp = record.approvedAt ? `> Согласован заказчиком ${moscowTime(record.approvedAt)} (версия ${record.rev}).` : `> На согласовании у заказчика (версия ${record.rev}).`
  return `${stamp}\n\n${storyboardMarkdown(record.demo)}\n`
}

async function readJson<T>(path: string): Promise<T | undefined> {
  return readFile(path, 'utf8').then((t) => JSON.parse(t) as T, () => undefined)
}

/** Записать файл без промежуточного состояния и без записи, если содержимое то же. */
async function put(path: string, content: string): Promise<void> {
  if (await readFile(path, 'utf8').then((old) => old === content, () => false)) return
  await mkdir(tmpRoot(), { recursive: true })
  const tmp = join(tmpRoot(), `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

const queues = new Map<number, Promise<unknown>>()

/**
 * Пересобрать папку заявки в workspace. Вызовы по одной заявке идут по
 * очереди; сбой пишется в журнал и не роняет вызывающего.
 * @param firstText - первое сообщение заказчика: при регистрации сохраняется рядом с документами.
 * @returns путь папки или undefined при сбое.
 */
export function mirrorRequest(taskId: number, sessionId: string, firstText?: string): Promise<string | undefined> {
  const previous = queues.get(taskId) ?? Promise.resolve()
  const job = previous.catch(() => undefined).then(() => mirrorNow(taskId, sessionId, firstText)).catch((e) => {
    console.error(`[customer-form] папка заявки ${taskId} в workspace не обновилась:`, e)
    return undefined
  })
  queues.set(taskId, job)
  void job.finally(() => { if (queues.get(taskId) === job) queues.delete(taskId) })
  return job
}

async function mirrorNow(taskId: number, sessionId: string, firstText?: string): Promise<string> {
  const slug = fastSlug(taskId)
  const files = fastFiles(FAST_ROOT, slug)
  const textPath = requestTextPath(taskId)
  if (firstText?.trim() && !existsSync(textPath)) {
    await mkdir(files.dir, { recursive: true })
    await writeFile(textPath, firstText.trim(), 'utf8')
  }
  const saved = await readFile(textPath, 'utf8').catch(() => undefined)
  const intake = await readJson<IntakeFile>(join(files.dir, 'intake.json'))
  const primary = await readJson<{ args?: { title?: string } }>(files.primary)
  const fast = await fastState(files)
  const deep = fast?.approvedAt ? await readDeepState(deepFiles(files, slug)) : undefined
  const demo = sharedDemos().get(sessionId)
  const title = requestTitle(intake, primary?.args?.title, saved ?? firstText)

  const root = workspaceRoot()
  await mkdir(root, { recursive: true })
  const wanted = folderName(taskId, title)
  const existing = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory() && isFolderOf(taskId, e.name)).map((e) => e.name)
  const dir = join(root, wanted)
  if (!existing.includes(wanted)) {
    // Название уточнилось — переименовать старую папку; лишние копии (гонка) убрать.
    const [old, ...extra] = existing
    if (old) await rename(join(root, old), dir)
    for (const name of extra) await rm(join(root, name), { recursive: true, force: true })
  }
  await mkdir(dir, { recursive: true })

  const copy = async (name: string, source: string | undefined) => {
    const content = source ? await readFile(source, 'utf8').catch(() => undefined) : undefined
    if (content?.trim()) await put(join(dir, name), content)
    else await rm(join(dir, name), { force: true })
  }
  await put(join(dir, MIRROR_FILES.request), requestMarkdown({
    taskId, title, firstText: saved ?? firstText, intake, demo, fastApprovedAt: fast?.approvedAt, fastBuilt: !!fast, deepStage: deep?.stage,
  }))
  if (demo) await put(join(dir, MIRROR_FILES.demo), demoMarkdown(demo))
  else await rm(join(dir, MIRROR_FILES.demo), { force: true })
  await copy(MIRROR_FILES.fast, fast ? files.md : undefined)
  await copy(MIRROR_FILES.deep, deep?.stage === 'ready' ? deepFiles(files, slug).md : undefined)
  await copy(MIRROR_FILES.sources, join(files.dir, 'sources.md'))
  await copy(MIRROR_FILES.context, files.contextMap)
  await copy(MIRROR_FILES.answers, join(files.dir, 'form-answers.md'))
  return dir
}

/** При старте узла: папки для всех заявок, заведённых до зеркала. */
export async function mirrorAll(tickets: readonly { taskId: number; sessionId: string }[]): Promise<void> {
  for (const { taskId, sessionId } of tickets) await mirrorRequest(taskId, sessionId)
}
