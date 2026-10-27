/**
 * bft-manager · узловая половина (ADR-0009): «Управление БФТ» для PO.
 *
 * Два маршрута на общем канале `/api` (тот же приём, что у customer-form):
 *  - bft-manager.overview — обе воронки, люди, адрес трекера;
 *  - bft-manager.move — смена статуса (и ответственного) задачи.
 * Источник и приёмник данных — только REST Vikunja.
 */
import { BadRequest, BftBoards } from './boards.js'
import type { MoveRequest } from './model.js'
import { Tracker, trackerCfgFromEnv } from './tracker.js'

export const name = 'bft-manager'

interface HarnessContext {
  get(name: string): unknown
  effect(fn: () => (() => void) | void, label?: string): void
  inject(names: string[], apply: (scoped: HarnessContext) => void): void
}

interface ConnectionLike {
  fetch?: { register: (route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }) => () => void }
}

type Handler = (payload: Record<string, unknown>) => Promise<unknown>

function fail(code: string, message: string) {
  return { ok: false, error: { code, message, details: {} } }
}

/** RPC-конверт харнесса: {rpcId, payload} → {type: server-response, rpcId, result}. */
function rpcRoute(path: string, handler: Handler) {
  return {
    path,
    methods: ['POST'],
    requestBody: 'buffered' as const,
    fetch: async (request: Request) => {
      let rpcId = 'r'
      let result: unknown
      try {
        const body = (await request.json().catch(() => ({}))) as { rpcId?: string; payload?: Record<string, unknown> }
        rpcId = body.rpcId ?? rpcId
        result = { ok: true, value: await handler(body.payload ?? {}) }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (!(e instanceof BadRequest)) console.error(`[bft-manager] ${path}:`, e)
        result = fail(e instanceof BadRequest ? 'bad-request' : 'tracker', message)
      }
      return Response.json({ type: 'server-response', rpcId, result })
    },
  }
}

function moveRequest(payload: Record<string, unknown>): MoveRequest {
  const { kind, taskId, status, assigneeId, attachTo } = payload
  if (kind !== 'requests' && kind !== 'bft') throw new BadRequest('kind: requests | bft')
  if (typeof taskId !== 'number' || typeof status !== 'string') throw new BadRequest('нужны taskId и status')
  return {
    kind,
    taskId,
    status,
    assigneeId: typeof assigneeId === 'number' ? assigneeId : undefined,
    attachTo: typeof attachTo === 'number' || attachTo === 'new' ? attachTo : undefined,
  }
}

export function apply(ctx: HarnessContext): void {
  const boards = new BftBoards(new Tracker(trackerCfgFromEnv(process.env)))
  ctx.inject(['connection'], (scoped) => {
    const register = (scoped.get('connection') as ConnectionLike).fetch?.register
    if (typeof register !== 'function') return
    scoped.effect(() => register(rpcRoute('/api/bft-manager.overview', () => boards.overview())), 'bft-manager: /api/bft-manager.overview')
    scoped.effect(() => register(rpcRoute('/api/bft-manager.move', (payload) => boards.move(moveRequest(payload)))), 'bft-manager: /api/bft-manager.move')
  })
}
