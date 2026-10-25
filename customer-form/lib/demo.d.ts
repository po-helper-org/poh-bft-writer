/**
 * Сценарий приёмки (HowToDemo) как раскадровка по экранам.
 *
 * Модель заполняет только структуру шагов — это быстро даже на Haiku;
 * картинку рисует код: Markdown с «экраном» на каждый шаг. Документ уходит
 * в штатную карточку согласования dsh (intent plan-review) и открывается
 * в правом сайдбаре — заказчик сам жмёт «Согласую» (ADR-0007 rev7).
 */
export interface DemoStep {
    /** Экран или место, где заказчик находится на этом шаге. */
    screen: string;
    /** Что заказчик делает. */
    action: string;
    /** Что должен увидеть — проверяемый результат. */
    expect: string;
}
export interface AcceptanceDemo {
    title: string;
    where: string;
    steps: DemoStep[];
    done: string;
}
/**
 * Документ на согласование. Первая строка — заголовок карточки, первый абзац —
 * её двухстрочное описание (так карточку plan-review строит dsh).
 */
export declare function storyboardMarkdown(demo: AcceptanceDemo): string;
/** Шаги одной строкой каждый — в поле howToDemo постановки. */
export declare function demoSteps(demo: AcceptanceDemo): string[];
