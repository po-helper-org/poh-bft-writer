/**
 * Параллельные вызовы в пределах дедлайна разведки: не больше N одновременно,
 * новый вызов не начинается после дедлайна, начатый — не ждётся дольше него.
 */

/** Результат задачи; undefined — не начиналась (дедлайн). */
export type Settled<T> = PromiseSettledResult<T> | undefined

/** Обещание с потолком ожидания: по истечении — ошибка (сам вызов не прерывается). */
export function withTimeout<T>(promise: Promise<T>, ms: number, label = 'время разведки вышло'): Promise<T> {
  if (ms <= 0) return Promise.reject(new Error(label))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function pool<T>(tasks: (() => Promise<T>)[], concurrency: number, deadline: number): Promise<Settled<T>[]> {
  const out: Settled<T>[] = new Array(tasks.length).fill(undefined)
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++
      if (Date.now() >= deadline) continue
      try {
        out[index] = { status: 'fulfilled', value: await withTimeout(tasks[index]!(), deadline - Date.now()) }
      } catch (reason) {
        out[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker))
  return out
}
