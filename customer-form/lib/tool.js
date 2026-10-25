/**
 * customer-form/tool · инструмент сдачи заявки внутри пресета агента «customer».
 *
 * Пресет — изолированная группа плагинов: глобально зарегистрированный
 * инструмент агенту не виден, поэтому submit_customer_request монтируется
 * строкой пресета (customer.patch.yml), а Backlog берёт общий с узлом
 * customer-form (заявку тот создал по первому сообщению).
 */
import { sharedBacklog } from './host.js';
// defineTool — значение из dsh-tools профиля (не из devDependencies плагина).
const DSH_TOOLS = '@deepseek-ai/dsh-tools';
const { defineTool } = (await import(DSH_TOOLS));
export const name = 'customer-form-tool';
export const inject = ['tools'];
export function apply(ctx) {
    const tools = ctx.get('tools');
    ctx.effect(() => tools.register(defineTool(submitTool(sharedBacklog()))), 'customer-form: submit_customer_request');
}
/** Диалог как текст: файл полного контекста для PO. */
function transcriptOf(agent, ticket, intake) {
    const lines = [`# Полный контекст заявки #${ticket.taskId}`, '', `Заказчик: ${intake.customerName} <${intake.customerEmail}>`, '', '## Диалог', ''];
    for (const message of agent.session.deriveMessages()) {
        if (message.role !== 'user' && message.role !== 'assistant')
            continue;
        const text = message.content.map((b) => b.text ?? (b.attachment ? `[вложение: ${b.attachment.name ?? b.type}]` : '')).join('\n').trim();
        if (text)
            lines.push(`**${message.role === 'user' ? 'Заказчик' : 'Ассистент'}:** ${text}`, '');
    }
    return lines.join('\n');
}
const text = (description) => ({ type: 'string', required: true, description });
const strings = (description) => ({ type: 'array', required: true, items: { type: 'string' }, description });
function submitTool(backlog) {
    return {
        name: 'submit_customer_request',
        description: 'Сдать подтверждённую заказчиком постановку в заявку беклога: описание, сводку и полный контекст. Вызывай один раз, после подтверждения ИТОГА.',
        parameters: {
            title: text('Короткое название заявки для доски, до 8 слов'),
            customerName: text('ФИО заказчика'),
            customerEmail: text('Email заказчика'),
            summary: text('Суть инициативы, 1–2 предложения'),
            asis: text('ASIS: как работает сейчас'),
            gap: text('GAP: почему текущее решение не устраивает'),
            tobe: text('TOBE: как должно работать'),
            howToDemo: strings('HowToDemo: шаги приёмки, по одному на элемент'),
            glossary: {
                type: 'array', required: true, description: 'Расшифровки сокращений',
                items: { type: 'object', additionalProperties: false, properties: { term: text('Сокращение'), expansion: text('Расшифровка') } },
            },
            links: strings('Ссылки на материалы, которые дал заказчик (JIRA, Confluence, внешние); ссылку на саму заявку не добавляй'),
            openQuestions: strings('Что осталось невыясненным — для PO'),
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args, exec) {
            const agent = exec.agent;
            if (!agent)
                throw new Error('нет сессии заказчика');
            const ticket = await backlog.find(agent.session.id);
            if (!ticket)
                throw new Error('заявка этой сессии ещё не зарегистрирована — повтори через пару секунд');
            await backlog.finalize(ticket, args, transcriptOf(agent, ticket, args));
            return `Заявка #${ticket.taskId} обновлена: постановка, сводка и полный контекст сохранены. Отслеживание статуса: ${ticket.url}`;
        },
    };
}
