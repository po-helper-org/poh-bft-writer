export declare const name = "customer-form-tool";
export declare const inject: string[];
export interface BlockLike {
    type: string;
    text?: string;
    attachment?: {
        name?: string;
        mediaType?: string;
        attachmentId: string;
    };
}
export interface AgentLike {
    session: {
        id: string;
        deriveMessages(): readonly {
            role: string;
            content: readonly BlockLike[];
        }[];
    };
    inject(message: {
        id: string;
        role: 'user';
        source: {
            kind: string;
        };
        content: readonly BlockLike[];
    }): void;
}
interface ToolContext {
    get(name: string): unknown;
    effect(fn: () => (() => void) | void, label?: string): void;
}
export declare function apply(ctx: ToolContext): void;
export {};
