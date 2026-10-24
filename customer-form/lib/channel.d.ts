/**
 * Канал customer-form: пять подкоманд + бинарная выгрузка файлов.
 * Транспорт — тот же, что у poh-bft-plugin (client-request → server-response).
 */
export declare const CF_CHANNEL = "/customer-form";
export declare const CF_ENDPOINTS: readonly string[];
export type RpcResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
        details: object;
    };
};
export interface CfDeps {
    health(): Promise<unknown>;
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
    chat(taskId: number, message: string): Promise<unknown>;
    finalize(taskId: number): Promise<{
        url: string;
        board: string;
    }>;
}
export declare function cfDispatch(deps: CfDeps, endpoint: string, payload: unknown): Promise<RpcResult<unknown>>;
