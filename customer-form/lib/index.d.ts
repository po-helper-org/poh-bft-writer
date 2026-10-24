export declare const name = "customer-form";
interface HarnessContext {
    get(name: string): unknown;
    effect(fn: () => (() => void) | void, label?: string): void;
    inject(names: string[], apply: (scoped: HarnessContext) => void): void;
}
export declare function apply(ctx: HarnessContext): void;
export {};
