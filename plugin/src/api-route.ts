/**
 * Транспорт канала раздела на ядре 0.1.7+.
 *
 * В 0.1.7 `connection.rpc.handle` вешает маршрут через `webServer` контекста-владельца, а
 * сторонний плагин его не получает («cannot get property "webServer" without inject») — канал
 * `/bft` молча не регистрировался, и браузер получал 405 на каждый запрос. Штатный путь для
 * плагинов в этой версии — точные маршруты на общем канале `/api` (`connection.fetch.register`),
 * так же, как это делает dsh-plugin-subscriptions: `POST /api/bft.<endpoint>`, конверт
 * `client-request` → `server-response`, аутентификацию и Host/Origin-забор проходит сам `/api`.
 *
 * Модуль общий для узла и браузера и нарочно без зависимостей: браузер берёт отсюда только
 * префикс.
 */

/** Префикс методов раздела на общем канале `/api`. */
export const BFT_API_PREFIX = 'bft.'

/** Точный маршрут, который принимает `connection.fetch.register` ядра 0.1.7. */
export interface BftFetchRoute {
  path: string
  methods: string[]
  requestBody: 'buffered'
  fetch(request: Request): Promise<Response>
}

/**
 * Маршрут одного метода раздела.
 * @param endpoint - подкоманда канала (`list`, `task`, …).
 * @param handler - разбор подкоманды; наружу всегда отдаёт значение, не бросает.
 * @returns маршрут `POST /api/bft.<endpoint>`.
 */
export function bftFetchRoute(
  endpoint: string,
  handler: (endpoint: string, payload: unknown) => Promise<unknown>,
): BftFetchRoute {
  return {
    path: `/api/${BFT_API_PREFIX}${endpoint}`,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return new Response('invalid JSON body', { status: 400 })
      }
      const envelope = body as { type?: unknown, rpcId?: unknown, payload?: unknown } | null
      if (typeof envelope !== 'object' || envelope === null || envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string') {
        return new Response('invalid request envelope', { status: 400 })
      }
      const result = await handler(endpoint, envelope.payload)
      return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
    },
  }
}
