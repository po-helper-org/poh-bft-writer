/**
 * «Баланс закончился» у провайдера модели: распознать ошибку, запомнить на
 * время и сказать человеку понятно. Пока провайдер помечен, ИИ-агент правок
 * сразу берёт запасную модель, а не ждёт отказа на каждой правке; через
 * `ttlMs` (или после смены модели в настройках) пробует снова — вдруг пополнили.
 */

const BALANCE_TEXT = /insufficient[_ ]?(balance|credits?|funds|quota)|not enough (credits?|balance|funds)|balance (is )?(too low|exhausted|insufficient)|credit balance|out of credits|payment required|exceeded your current quota|недостаточно средств|баланс/i

/** Ошибка — «закончился баланс» (HTTP 402 или текст провайдера об оплате)? */
export function isBalanceError(e: unknown): boolean {
  const seen = new Set<unknown>()
  const walk = (x: unknown, depth: number): boolean => {
    if (!x || depth > 4 || seen.has(x)) return false
    seen.add(x)
    if (typeof x === 'string') return BALANCE_TEXT.test(x) || /\b(HTTP|status|code)[\s:=]*402\b/i.test(x)
    if (typeof x !== 'object') return false
    const o = x as Record<string, unknown>
    if (o.statusCode === 402 || o.status === 402) return true
    for (const key of ['message', 'responseBody', 'body', 'data', 'error', 'cause', 'lastError']) {
      if (key in o && walk(o[key], depth + 1)) return true
    }
    return Array.isArray(o.errors) && o.errors.some((y) => walk(y, depth + 1))
  }
  return walk(e, 0)
}

/** Текст для человека: что случилось и где поправить. */
export function balanceMessage(provider: string): string {
  return `У провайдера ${provider} закончился баланс. Пополните его или выберите другую модель: «Настройки → Портал».`
}

export interface ProviderMark { provider: string; at: string }

export class ProviderHealth {
  private marks = new Map<string, number>()
  constructor(private readonly ttlMs = 10 * 60_000, private readonly now: () => number = Date.now) {}

  /** Провайдер отказал «баланс закончился» — помечаем. */
  exhausted(provider: string): void { this.marks.set(provider, this.now()) }

  /** Помечен и метка не истекла. */
  isExhausted(provider: string | undefined): boolean {
    if (!provider) return false
    const at = this.marks.get(provider)
    if (at === undefined) return false
    if (this.now() - at < this.ttlMs) return true
    this.marks.delete(provider)
    return false
  }

  /** Провайдер ответил (или администратор сменил модели) — снять метку. */
  clear(provider?: string): void {
    if (provider) this.marks.delete(provider)
    else this.marks.clear()
  }

  /** Действующие метки — для настроек. */
  list(): ProviderMark[] {
    return [...this.marks.keys()].filter((p) => this.isExhausted(p)).map((p) => ({ provider: p, at: new Date(this.marks.get(p)!).toISOString() }))
  }
}
