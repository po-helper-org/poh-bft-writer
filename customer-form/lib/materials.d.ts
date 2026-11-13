export interface Ingested {
    ok: boolean;
    /** Чем является источник для модели: «голосовая запись 3:42 — расшифровка». */
    label: string;
    markdown: string;
    error?: string;
    elapsedMs?: number;
}
export interface Material {
    id: string;
    name: string;
    result: Promise<Ingested>;
}
export interface WebLike {
    fetch(request: {
        url: string;
    }, signal?: AbortSignal): Promise<{
        url: string;
        statusCode: number;
        body: {
            kind: 'html' | 'text';
            content: string;
        };
        truncated: boolean;
    }>;
}
export declare class Materials {
    private readonly ingestUrl;
    private sessions;
    web?: WebLike;
    constructor(ingestUrl: string);
    private bucket;
    private add;
    private ingest;
    /** Вложение заказчика: разбор начинается сразу. */
    addFile(sessionId: string, name: string, path: string): Material;
    /** Ссылка из сообщения: публичная страница через ctx.web dsh. */
    addLink(sessionId: string, url: string): Material;
    has(sessionId: string): boolean;
    /** Новые материалы сессии, дождавшись разбора. */
    take(sessionId: string): Promise<{
        material: Material;
        result: Ingested;
    }[]>;
}
/** Пакет материалов для модели: теги <source>, бюджет, недоверенные данные. */
export declare function materialsPack(items: {
    material: Material;
    result: Ingested;
}[]): string;
/** Один реестр на процесс: его наполняет узел, читает инструмент пресета. */
export declare function sharedMaterials(): Materials;
