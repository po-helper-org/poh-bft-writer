/**
 * customer-form · узловая точка входа (cordis apply).
 *
 * Регистрирует канал (те же маршруты /api, что у poh-bft-plugin) и бинарный
 * маршрут выгрузки файлов. Никаких слотов кроме оверлея не занимает: экран
 * заказчика один.
 */
import { cfDispatch, CF_ENDPOINTS } from './channel.js';
import { cfgFromEnv, CustomerForm } from './host.js';
export const name = 'customer-form';
export function apply(ctx) {
    const form = new CustomerForm(cfgFromEnv(process.env));
    const deps = {
        health: () => form.health(),
        upload: (name, bytes) => form.upload(name, bytes),
        submit: (input) => form.submit(input),
        chat: (taskId, message) => form.chat(taskId, message),
        finalize: (taskId) => form.finalize(taskId),
    };
    ctx.inject(['connection'], (scoped) => {
        const connection = scoped.get('connection');
        const handler = (endpoint, payload) => cfDispatch(deps, endpoint, payload);
        const register = connection.fetch?.register;
        if (typeof register === 'function') {
            for (const endpoint of CF_ENDPOINTS) {
                scoped.effect(() => register({
                    path: `/api/customer-form.${endpoint}`,
                    methods: ['POST'],
                    requestBody: 'buffered',
                    fetch: async (request) => {
                        let body = null;
                        try {
                            body = await request.json();
                        }
                        catch {
                            body = null;
                        }
                        const envelope = body;
                        if (!envelope || envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string') {
                            return new Response('invalid request envelope', { status: 400 });
                        }
                        const result = await handler(endpoint, envelope.payload);
                        return Response.json({ type: 'server-response', rpcId: envelope.rpcId, result });
                    },
                }), `customer-form: /api/customer-form.${endpoint}`);
            }
            // Бинарная выгрузка файлов (мимо JSON-конверта, как intakeUpload).
            scoped.effect(() => register({
                path: '/api/customer-form.uploadFile',
                methods: ['POST'],
                requestBody: 'buffered',
                fetch: async (request) => {
                    const name = decodeURIComponent(request.headers.get('x-cf-filename') ?? 'file');
                    const bytes = new Uint8Array(await request.arrayBuffer());
                    if (bytes.byteLength === 0)
                        return Response.json({ error: 'Пустой файл' }, { status: 400 });
                    if (bytes.byteLength > 50 * 1024 * 1024)
                        return Response.json({ error: 'Больше 50 МБ' }, { status: 413 });
                    return Response.json(await form.upload(name, bytes));
                },
            }), 'customer-form: /api/customer-form.uploadFile');
            return;
        }
        scoped.effect(() => connection.rpc.handle('/customer-form', handler), 'customer-form: канал /customer-form');
    });
}
