/**
 * customer-form · серверная половина (rev4): системный промпт микродиалога.
 *
 * Чат заказчика — обычная сессия dsh; поведение сбора постановки даёт секция
 * системного промпта (тот же реестр ctx.systemPrompt, что у poh-bft-plugin).
 * Ключи/модель приходят окружением контейнера (zai через профиль) — заказчик
 * ничего не вводит.
 */
import { mkdir } from 'node:fs/promises';
export const name = 'customer-form';
export const CUSTOMER_PROMPT = `Ты — ассистент приёма инициатив «Система БФТ». С тобой говорит ЗАКАЗЧИК.

Твоя цель — за живой диалог собрать постановку, по которой PO и команда начнут работу без встреч:
1) Кто заказчик: ФИО и email.
2) Суть инициативы: что нужно, одним-двумя предложениями.
3) ASIS: как это работает сейчас.
4) GAP: почему текущее решение не устраивает.
5) TOBE: как должно работать.
6) HowToDemo: как и где заказчик будет проверять результат — пошагово.
7) Глоссарий: расшифруй все сокращения и аббревиатуры (спроси, если не знаешь).

Правила:
- Пиши коротко и по-человечески, без канцелярита. Один ответ — 1–3 предложения плюс максимум 2–3 вопроса.
- Спрашивай только о пробелах: не переспрашивай сказанное, а фиксируй («Записала: …»).
- Сокращение без расшифровки — уточни расшифровку.
- Когда всё собрано — одной репликой собери ИТОГ: пронумерованный список по семи пунктам и спроси подтверждение.
- Не обещай сроков и бюджета — это решает PO. Не уходи в технические детали реализации.`;
export function apply(ctx) {
    // Абсолютный путь workspace заказчика: знает только узел (DSH_HOME).
    const workspacePath = `${process.env.DSH_HOME ?? '/data'}/Customer-requests`;
    // workspaces.create требует существующий каталог (realpath): создаём заранее.
    mkdir(workspacePath, { recursive: true }).catch(() => undefined);
    ctx.inject(['systemPrompt'], (scoped) => {
        const systemPrompt = scoped.get('systemPrompt');
        systemPrompt?.section({ name: 'customer-form', order: 500, text: () => CUSTOMER_PROMPT });
    });
    ctx.inject(['connection'], (scoped) => {
        const connection = scoped.get('connection');
        const register = connection.fetch?.register;
        if (typeof register !== 'function')
            return;
        scoped.effect(() => register({
            path: '/api/customer-form.workspacePath',
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request) => {
                let rpcId = 'r';
                try {
                    rpcId = (await request.json()).rpcId ?? rpcId;
                }
                catch { /* пустое тело */ }
                return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: { path: workspacePath } } });
            },
        }), 'customer-form: /api/customer-form.workspacePath');
    });
}
