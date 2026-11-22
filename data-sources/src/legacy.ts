/**
 * Разовая уборка при запуске: OAuth-подключения прежних версий плагина
 * (`$DSH_HOME/data-sources/<id>.json` — токены большого шлюза агентов) из
 * тома удаляются. OAuth в плагине больше нет (ADR-0015), но файл с полным
 * токеном не должен пережить переход. Отзыв по сети не делается: без файла
 * токен порталу недоступен, а сам шлюз агентов портал больше не знает.
 * В журнал — только число удалённых файлов, без имён и значений.
 */
import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Каталог прежних подключений; читается при вызове — тесты подменяют DSH_HOME. */
export const legacyDir = (): string => join(process.env.DSH_HOME ?? '/data', 'data-sources')

/** Удалить файлы прежних OAuth-подключений; вернуть, сколько удалено. */
export async function removeLegacyConnections(dir = legacyDir()): Promise<number> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return 0
  }
  let removed = 0
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      await rm(join(dir, name), { force: true })
      removed++
    } catch {
      /* не удалось — следующая попытка при следующем запуске */
    }
  }
  return removed
}
