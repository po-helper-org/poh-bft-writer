/**
 * Маршруты «Планирования» (ADR-0025): экран, сохранение, файлы, бандл доски и
 * слой на странице полного БФТ (кнопка вверху, артефакт внизу). Отдельным
 * модулем, чтобы index.ts только подключал его.
 */
import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import type { Backlog } from './host.js'
import { FAST_ROOT, fastFiles, fastSlug } from './bft-fast.js'
import { deepFiles } from './bft-deep.js'
import { formTitle } from './forms.js'
import { appendToMain } from './form-page.js'
import { planArtifact, planButton, planFiles, planPage, readPlan, savePlan, validatePlan, type PlanLinks } from './plan.js'

type Register = (route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }) => () => void

export const PLAN_ROUTE = '/api/customer-form.plan'
const SAVE_ROUTE = '/api/customer-form.planSave'
const FILE_ROUTE = '/api/customer-form.planFile'
const ASSET_ROUTE = '/api/customer-form.planAsset'

/** Ссылки «Планирования» относительно страницы, на которой они стоят (страницы портала — в /api/). */
export function planLinks(sessionId: string): PlanLinks {
  const s = encodeURIComponent(sessionId)
  return {
    page: `customer-form.plan?session=${s}`,
    zip: `customer-form.planFile?session=${s}&f=zip`,
    pdf: `customer-form.planFile?session=${s}&f=pdf`,
    note: `customer-form.planFile?session=${s}&f=note`,
  }
}

async function requestOf(backlog: Backlog, sessionId: string) {
  const ticket = sessionId ? await backlog.find(sessionId).catch(() => undefined) : undefined
  if (!ticket) return undefined
  const slug = fastSlug(ticket.taskId)
  const files = fastFiles(FAST_ROOT, slug)
  const md = await readFile(deepFiles(files, slug).md, 'utf8').catch(() => readFile(files.md, 'utf8').catch(() => ''))
  const title = formTitle(/^# (.+)$/m.exec(md.replace(/^---\n[\s\S]*?\n---\n/, ''))?.[1] ?? `Заявка #${ticket.taskId}`)
  return { ticket, slug, dir: files.dir, title }
}

/** Страница полного БФТ + кнопка «Планирование» и артефакт, если сохранён. */
export async function withPlan(page: string, sessionId: string, requestDir: string): Promise<string> {
  const links = planLinks(sessionId)
  const art = planArtifact(await readPlan(requestDir).catch(() => undefined), links)
  const withArt = art ? appendToMain(page, art) : page
  const at = withArt.lastIndexOf('</body>')
  return at < 0 ? withArt + planButton(links) : withArt.slice(0, at) + planButton(links) + withArt.slice(at)
}

const BOARD_DIR = new URL('../board/dist/', import.meta.url)
const assets = new Map<string, { raw: Buffer; gz: Buffer }>()
async function asset(name: 'board.js' | 'board.css') {
  let got = assets.get(name)
  if (!got) {
    const raw = await readFile(new URL(name, BOARD_DIR))
    got = { raw, gz: gzipSync(raw, { level: 9 }) }
    assets.set(name, got)
  }
  return got
}

export function registerPlanRoutes(register: Register, backlog: Backlog): Array<() => void> {
  const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
  const notFound = () => html('<!doctype html><meta charset="utf-8"><p style="font:14px sans-serif;color:#888;padding:16px">Заявка не найдена.</p>', 404)
  return [
    register({
      path: PLAN_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        const req = await requestOf(backlog, sessionId)
        if (!req) return notFound()
        const s = encodeURIComponent(sessionId)
        return html(planPage({
          title: req.title,
          slug: req.slug,
          saved: await readPlan(req.dir),
          saveUrl: `customer-form.planSave?session=${s}`,
          bftUrl: `customer-form.bftFast?session=${s}`,
          assetUrl: (f) => `customer-form.planAsset?f=${f}`,
          links: planLinks(sessionId),
        }))
      },
    }),
    register({
      path: SAVE_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const sessionId = new URL(request.url).searchParams.get('session') ?? ''
        const req = await requestOf(backlog, sessionId)
        if (!req) return Response.json({ ok: false, error: 'заявка не найдена' }, { status: 404 })
        const input = validatePlan(await request.json().catch(() => undefined))
        if ('error' in input) return Response.json({ ok: false, error: input.error }, { status: 400 })
        try {
          const meta = await savePlan(req.dir, input, req.title)
          void backlog.comment(req.ticket, `<p><strong>🗂 Планирование сохранено</strong> — версия ${meta.rev}${meta.by ? `, ${meta.by.replace(/[<>&]/g, '')}` : ''}. Заметка и доска — на странице полного БФТ.</p>`).catch(() => undefined)
          return Response.json({ ok: true, rev: meta.rev, pdf: meta.pdf, savedAt: meta.savedAt })
        } catch (e) {
          console.error('[customer-form] планирование не сохранилось:', e)
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
        }
      },
    }),
    register({
      path: FILE_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const params = new URL(request.url).searchParams
        const req = await requestOf(backlog, params.get('session') ?? '')
        if (!req) return new Response('заявка не найдена', { status: 404 })
        const f = planFiles(req.dir)
        const kind = params.get('f')
        const pick = kind === 'pdf' ? { path: f.pdf, type: 'application/pdf', name: `${req.slug}-doska.pdf` }
          : kind === 'note' ? { path: f.note, type: 'text/markdown; charset=utf-8', name: `${req.slug}-zametka.md` }
            : { path: f.zip, type: 'application/zip', name: `${req.slug}-planirovanie.zip` }
        const body = await readFile(pick.path).catch(() => undefined)
        if (!body) return new Response('планирование ещё не сохранено', { status: 404 })
        return new Response(body, { headers: { 'content-type': pick.type, 'content-disposition': `attachment; filename="${pick.name}"`, 'cache-control': 'no-store' } })
      },
    }),
    register({
      path: ASSET_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        const f = new URL(request.url).searchParams.get('f')
        if (f !== 'board.js' && f !== 'board.css') return new Response('нет такого файла', { status: 404 })
        const got = await asset(f).catch(() => undefined)
        if (!got) return new Response('доска не собрана (customer-form/board)', { status: 503 })
        const gzip = /\bgzip\b/.test(request.headers.get('accept-encoding') ?? '')
        return new Response(gzip ? got.gz : got.raw, {
          headers: {
            'content-type': f === 'board.js' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
            'cache-control': 'public, max-age=3600',
            vary: 'accept-encoding',
            ...(gzip ? { 'content-encoding': 'gzip' } : {}),
          },
        })
      },
    }),
  ]
}
