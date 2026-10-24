export interface Cfg {
    trackerUrl: string;
    trackerPublicUrl: string;
    trackerUser: string;
    trackerPassword: string;
    zaiKey: string;
    model: string;
    dataDir: string;
}
export declare function cfgFromEnv(env: NodeJS.ProcessEnv): Cfg;
/** Канон постановки БФТ — что собирает диалог (задание владельца). */
export declare const FIELDS: readonly ["customer", "summary", "asis", "gap", "tobe", "howtodemo", "glossary"];
export type FieldKey = (typeof FIELDS)[number];
export declare const FIELD_TITLES: Record<FieldKey, string>;
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
export interface RequestState {
    messages: {
        role: string;
        content: string;
    }[];
    fields: Partial<Record<FieldKey, string>>;
    glossary: {
        term: string;
        expansion: string;
    }[];
    email: string;
    name: string;
    initial?: {
        text: string;
        links: string[];
        files: string[];
    };
}
export declare class CustomerForm {
    private readonly cfg;
    private readonly fetchImpl;
    private vkToken;
    private vkProject;
    constructor(cfg: Cfg, fetchImpl?: FetchLike);
    health(): Promise<{
        model: boolean;
        tracker: boolean;
    }>;
    private vkHeaders;
    private projectId;
    private stateFile;
    loadState(taskId: number): Promise<RequestState>;
    private saveState;
    private mergeFields;
    scorecard(st: RequestState): {
        rows: {
            key: FieldKey;
            title: string;
            filled: boolean;
        }[];
        done: number;
        total: number;
    };
    upload(name: string, bytes: Uint8Array): Promise<{
        ref: string;
        name: string;
    }>;
    submit(input: {
        name: string;
        email: string;
        text: string;
        links: string[];
        files: string[];
    }): Promise<{
        taskId: number;
        url: string;
    }>;
    private attach;
    chat(taskId: number, message: string): Promise<{
        reply: string;
        questions: string[];
        scorecard: ReturnType<CustomerForm['scorecard']>;
        glossary: RequestState['glossary'];
    }>;
    /** Summary-комментарий + файл полного контекста в задачу. */
    finalize(taskId: number): Promise<{
        url: string;
        board: string;
    }>;
}
export {};
