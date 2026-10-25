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
    private vkHeaders;
    private projectId;
    private submit;
}
export {};
