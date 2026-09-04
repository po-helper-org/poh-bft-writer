/**
 * Настройки из строки профиля харнесса.
 *
 * Секретов здесь нет и быть не может: строка профиля лежит файлом рядом с
 * репозиторием. Всё, что секретно, приходит из окружения процесса харнесса.
 */
import { loadConfig, type BftPluginConfig } from './config.js'

export interface PluginConfig {
  workspaceRoot?: string
  docsPath?: string
  indexPath?: string
  taskType?: string
  backlogBin?: string
  entireBaseUrl?: string
  entireBranchUrl?: string
  entireRequired?: boolean
}

/**
 * Строка профиля задаёт пути, окружение — адреса и доступы. Профиль имеет
 * приоритет: он ближе к конкретной установке, чем переменные процесса.
 *
 * Конфиг собирается через ту же `loadConfig`, что и в самостоятельном запуске,
 * а не отдельной веткой: две сборки настроек разошлись бы, и раздел в харнессе
 * вёл бы себя не так, как в тестах.
 */
export function toBftConfig(
  plugin: PluginConfig,
  env: Record<string, string | undefined>,
): BftPluginConfig {
  const pick = (fromPlugin: string | undefined, fromEnv: string | undefined): string | undefined => {
    const trimmed = fromPlugin?.trim()
    return trimmed ? trimmed : fromEnv
  }

  return loadConfig({
    ...env,
    BFT_WORKSPACE_ROOT: pick(plugin.workspaceRoot, env.BFT_WORKSPACE_ROOT),
    BFT_DOCS_PATH: pick(plugin.docsPath, env.BFT_DOCS_PATH),
    BFT_INDEX_PATH: pick(plugin.indexPath, env.BFT_INDEX_PATH),
    BFT_TASK_TYPE: pick(plugin.taskType, env.BFT_TASK_TYPE),
    BFT_BACKLOG_BIN: pick(plugin.backlogBin, env.BFT_BACKLOG_BIN),
    BFT_ENTIRE_BASE_URL: pick(plugin.entireBaseUrl, env.BFT_ENTIRE_BASE_URL),
    BFT_ENTIRE_BRANCH_URL: pick(plugin.entireBranchUrl, env.BFT_ENTIRE_BRANCH_URL),
    BFT_ENTIRE_REQUIRED: plugin.entireRequired === false ? '0' : env.BFT_ENTIRE_REQUIRED,
  })
}
