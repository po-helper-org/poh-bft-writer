/**
 * Канал customer-form: пять подкоманд + бинарная выгрузка файлов.
 * Транспорт — тот же, что у poh-bft-plugin (client-request → server-response).
 */
export const CF_CHANNEL = '/customer-form';
export const CF_ENDPOINTS = ['health', 'upload', 'submit', 'chat', 'finalize', 'state'];
function ok(value) { return { ok: true, value }; }
function fail(code, message) {
    return { ok: false, error: { code, message, details: {} } };
}
export async function cfDispatch(deps, endpoint, payload) {
    try {
        const p = (payload ?? {});
        switch (endpoint) {
            case 'health': return ok(await deps.health());
            case 'submit': {
                const str = (k) => (typeof p[k] === 'string' ? p[k] : '');
                const arr = (k) => (Array.isArray(p[k]) ? p[k].filter((x) => typeof x === 'string') : []);
                return ok(await deps.submit({ name: str('name'), email: str('email'), text: str('text'), links: arr('links'), files: arr('files') }));
            }
            case 'chat': {
                const taskId = typeof p.taskId === 'number' ? p.taskId : Number(p.taskId);
                const message = typeof p.message === 'string' ? p.message : '';
                if (!taskId || !message.trim())
                    return fail('bad-request', 'нужны taskId и message');
                return ok(await deps.chat(taskId, message));
            }
            case 'finalize': {
                const taskId = typeof p.taskId === 'number' ? p.taskId : Number(p.taskId);
                if (!taskId)
                    return fail('bad-request', 'нужен taskId');
                return ok(await deps.finalize(taskId));
            }
            default: return fail('unknown-endpoint', `нет подкоманды ${endpoint}`);
        }
    }
    catch (e) {
        return fail('cf-error', e instanceof Error ? e.message : String(e));
    }
}
