/**
 * Узловая половина customer-form: заявка в беклоге Vikunja (ADR-0007).
 *
 * Чат заказчика — обычная сессия dsh; здесь только то, чего у dsh нет:
 * фиксация обращения задачей с лейблом «запрос» и связь «сессия → задача»
 * (файл в DSH_HOME — том контейнера переживает рестарты).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export function cfgFromEnv(env) {
    return {
        trackerUrl: (env.TRACKER_URL ?? 'http://tracker:3456/api/v1').replace(/\/$/, ''),
        trackerPublicUrl: (env.TRACKER_PUBLIC_URL ?? 'http://127.0.0.1:3456').replace(/\/$/, ''),
        trackerUser: env.TRACKER_USER ?? 'bft-admin',
        trackerPassword: env.TRACKER_PASSWORD ?? '',
        ticketsFile: join(env.DSH_HOME ?? '/data', 'customer-form', 'tickets.json'),
    };
}
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
export class Backlog {
    cfg;
    fetchImpl;
    vkToken = '';
    vkProject = 0;
    tickets;
    /** Одна заявка на сессию даже при гонке «первое сообщение ↔ /request». */
    pending = new Map();
    constructor(cfg, fetchImpl = (u, i) => fetch(u, i)) {
        this.cfg = cfg;
        this.fetchImpl = fetchImpl;
        this.tickets = readFile(cfg.ticketsFile, 'utf8')
            .then((s) => JSON.parse(s))
            .catch(() => ({}));
    }
    async find(sessionId) {
        return (await this.tickets)[sessionId];
    }
    /** Заявка сессии: существующая или новая из текста первого обращения. */
    ensure(sessionId, text) {
        const inFlight = this.pending.get(sessionId);
        if (inFlight)
            return inFlight;
        const job = (async () => {
            const known = await this.find(sessionId);
            if (known)
                return known;
            const ticket = await this.submit(text);
            const all = await this.tickets;
            all[sessionId] = ticket;
            await mkdir(dirname(this.cfg.ticketsFile), { recursive: true });
            await writeFile(this.cfg.ticketsFile, JSON.stringify(all, undefined, 1), 'utf8');
            return ticket;
        })();
        this.pending.set(sessionId, job);
        job.catch(() => undefined).finally(() => this.pending.delete(sessionId));
        return job;
    }
    async vkHeaders() {
        if (!this.vkToken) {
            const res = await this.fetchImpl(`${this.cfg.trackerUrl}/login`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: this.cfg.trackerUser, password: this.cfg.trackerPassword }),
            });
            if (!res.ok)
                throw new Error(`трекер: вход ${res.status}`);
            this.vkToken = (await res.json()).token;
        }
        return { authorization: `Bearer ${this.vkToken}`, 'content-type': 'application/json' };
    }
    async projectId() {
        if (this.vkProject)
            return this.vkProject;
        const res = await this.fetchImpl(`${this.cfg.trackerUrl}/projects`, { headers: await this.vkHeaders() });
        const projects = (await res.json());
        const found = projects.find((p) => p.title.startsWith('БФТ'));
        if (!found)
            throw new Error('трекер: проект БФТ не найден (посейте: start.sh)');
        this.vkProject = found.id;
        return found.id;
    }
    async submit(text) {
        const body = text.trim();
        const email = EMAIL.exec(body)?.[0];
        const description = [
            '# Запрос инициативы (портал заказчика)', '',
            email ? `**Заказчик:** <${email}>` : '**Заказчик:** уточняется в диалоге', '',
            body || '(текст будет добавлен в диалоге)',
        ].join('\n');
        const pid = await this.projectId();
        const res = await this.fetchImpl(`${this.cfg.trackerUrl}/projects/${pid}/tasks`, {
            method: 'PUT',
            headers: await this.vkHeaders(),
            body: JSON.stringify({ title: body.split('\n')[0].slice(0, 80) || 'Запрос заказчика', description }),
        });
        if (res.status !== 201)
            throw new Error(`трекер: создание задачи ${res.status}`);
        const taskId = (await res.json()).id;
        // Лейбл «запрос» (грабля Vikunja: только отдельным PUT). Не роняет заявку.
        try {
            const labels = await this.fetchImpl(`${this.cfg.trackerUrl}/labels`, { headers: await this.vkHeaders() });
            const label = (await labels.json()).find((l) => l.title === 'запрос');
            if (label) {
                await this.fetchImpl(`${this.cfg.trackerUrl}/tasks/${taskId}/labels`, {
                    method: 'PUT', headers: await this.vkHeaders(), body: JSON.stringify({ label_id: label.id }),
                });
            }
        }
        catch { /* лейбл — косметика */ }
        return { taskId, url: `${this.cfg.trackerPublicUrl}/tasks/${taskId}` };
    }
}
