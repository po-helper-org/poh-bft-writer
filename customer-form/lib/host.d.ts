export interface Cfg {
    trackerUrl: string;
    trackerPublicUrl: string;
    trackerUser: string;
    trackerPassword: string;
    ticketsFile: string;
}
export declare function cfgFromEnv(env: NodeJS.ProcessEnv): Cfg;
export interface Ticket {
    taskId: number;
    url: string;
}
/** Постановка, собранная микродиалогом (задание владельца: 7 пунктов). */
export interface Intake {
    title: string;
    customerName: string;
    customerEmail: string;
    summary: string;
    asis: string;
    gap: string;
    tobe: string;
    howToDemo: string[];
    glossary: {
        term: string;
        expansion: string;
    }[];
    links: string[];
    openQuestions: string[];
}
/** Описание задачи в согласованном формате первичной постановки БФТ. */
export declare function intakeHtml(intake: Intake, taskId: number): string;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export declare class Backlog {
    private readonly cfg;
    private readonly fetchImpl;
    private vkToken;
    private vkProject;
    private tickets;
    /** Одна заявка на сессию даже при гонке «первое сообщение ↔ /request». */
    private pending;
    constructor(cfg: Cfg, fetchImpl?: FetchLike);
    find(sessionId: string): Promise<Ticket | undefined>;
    /** Заявка сессии: существующая или новая из текста первого обращения. */
    ensure(sessionId: string, text: string): Promise<Ticket>;
    /** Вложение заказчика → файл задачи (грабля Vikunja: multipart PUT, поле files). */
    attach(ticket: Ticket, name: string, bytes: Uint8Array): Promise<void>;
    /**
     * Итог микродиалога: описание задачи — постановка в формате БФТ, комментарий —
     * краткая сводка, вложение — файл полного контекста (HowToDemo п.10).
     */
    finalize(ticket: Ticket, intake: Intake, transcript: string): Promise<void>;
    private vkHeaders;
    private projectId;
    private submit;
}
/**
 * Один Backlog на процесс: им пользуются и узел customer-form (заявка по первому
 * сообщению), и инструмент сдачи внутри пресета агента (customer-form/tool).
 */
export declare function sharedBacklog(): Backlog;
export {};
