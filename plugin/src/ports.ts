/**
 * Границы с внешним миром. Всё, что читает диск или запускает процессы, живёт
 * здесь и только здесь — ядро остаётся чистым и проверяется без воркспейса.
 */
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { DocumentUnreadableError, WorkLogWriteError } from './errors.js'

/** Чтение текстового файла. `null` — файла нет; это не ошибка. */
export type ReadTextFile = (path: string) => Promise<string | null>

/** Перечисление файлов каталога без обхода вложенных. Нет каталога — пустой список. */
export type ListDirectory = (path: string) => Promise<string[]>

/** Запись текстового файла. Каталог создаётся при необходимости. */
export type WriteTextFile = (path: string, content: string) => Promise<void>

/**
 * Настоящий путь с раскрытыми симлинками. Пути нет — возвращается как есть:
 * несуществующая цель наружу не ведёт.
 */
export type RealPath = (path: string) => Promise<string>

/**
 * Запуск внешней команды. Наружу — только вывод и код: раздел обязан пережить
 * отсутствие CLI, а не упасть вместе с ним, поэтому «не удалось запустить» —
 * это код возврата, а не исключение.
 */
export type RunCommand = (bin: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr?: string; code: number }>

/** Куда процесс с потоковым выводом отдаёт строки и завершение. */
export interface StreamSink {
  /** Строка stdout без перевода строки. */
  line(text: string): void
  stderr(text: string): void
  /** Процесс завершился; `error` — запустить не удалось (нет бинаря, нет прав). Зовётся один раз. */
  exit(code: number | null, error?: string): void
}

/** Ручка запущенного процесса: только остановить — всё остальное идёт через StreamSink. */
export interface StreamingProcess {
  kill(): void
}

/**
 * Запуск долгого процесса с потоковым чтением (чат через Claude Code CLI, см.
 * claude-chat.ts). Отличается от `runCommand` тем, чем и должен: без таймаута и
 * без буфера целиком — строки уходят по мере прихода, `input` целиком в stdin.
 * Как и там, «не удалось запустить» — не исключение, а `exit(null, причина)`.
 */
export type SpawnStreaming = (bin: string, args: string[], cwd: string, input: string, sink: StreamSink) => StreamingProcess

export interface BftPorts {
  readTextFile: ReadTextFile
  listDirectory: ListDirectory
  writeTextFile: WriteTextFile
  realPath: RealPath
  runCommand: RunCommand
  /** Нет порта — чат через Claude Code выключен (тесты, среда без CLI); раздел живёт без него. */
  spawnStreaming?: SpawnStreaming
}

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/** Каталоги, где на macOS/Linux обычно лежат docker, uvx, npx и сам claude. */
const USUAL_BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local/bin')]

/** PATH с дописанными обычными каталогами; уже присутствующие не дублируются. Чистая. */
export function extendPath(current: string | undefined): string {
  const parts = (current ?? '').split(delimiter).filter(Boolean)
  for (const dir of USUAL_BIN_DIRS) if (!parts.includes(dir)) parts.push(dir)
  return parts.join(delimiter)
}

export const nodePorts: BftPorts = {
  async readTextFile(path) {
    try {
      return await readFile(path, 'utf8')
    } catch (error) {
      // Нет файла — обычное состояние. Всё остальное (права, битая ссылка,
      // каталог вместо файла) прячется за «пустой экран» и молча врёт PO,
      // поэтому поднимается наверх с путём и причиной.
      if (missing(error)) return null
      throw new DocumentUnreadableError(path, error)
    }
  },
  async listDirectory(path) {
    try {
      return await readdir(path)
    } catch (error) {
      if (missing(error)) return []
      throw new DocumentUnreadableError(path, error)
    }
  },
  async writeTextFile(path, content) {
    try {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content, 'utf8')
    } catch (error) {
      throw new WorkLogWriteError(path, error)
    }
  },
  async realPath(path) {
    // Несуществующая цель — не ошибка: сверяем путь как есть, вести наружу нечему.
    return realpath(path).catch(() => path)
  },
  runCommand(bin, args, cwd) {
    return new Promise(resolve => {
      // Таймаут обязателен: висящий CLI иначе подвесит весь раздел, и PO увидит
      // бесконечную загрузку вместо списка требований.
      execFile(bin, args, { cwd, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
        // Код -1 — программу не удалось запустить вовсе (нет бинаря, нет прав).
        // Это штатное состояние: Backlog.md необязателен.
        const code = error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? -1) : 0
        // stderr едет наверх ради причины отказа: `task edit` с неверной стадией
        // объясняет её именно там, а панель обязана показать PO слово, не код.
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', code: typeof code === 'number' ? code : -1 })
      })
    })
  },
  spawnStreaming(bin, args, cwd, input, sink) {
    // Харнесс под launchd живёт с голым PATH (/usr/bin:/bin:/usr/sbin:/sbin), а CLI
    // поднимает MCP-серверы по коротким именам (`docker mcp gateway …`, `uvx`, `npx`)
    // — без обычных каталогов пользователя они молча не стартуют, и Jira/Confluence
    // в чате «недоступны» (проверено на /bft-deliver, 2026-09-15). Дописываем в PATH,
    // не заменяя: то, что уже есть, — впереди.
    const env = { ...process.env, PATH: extendPath(process.env.PATH) }
    let settled = false
    const finish = (code: number | null, error?: string): void => {
      if (settled) return
      settled = true
      sink.exit(code, error)
    }
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], env })
    } catch (error) {
      // Синхронный отказ spawn (например, пустой bin) — та же дорога, что ENOENT.
      queueMicrotask(() => { finish(null, error instanceof Error ? error.message : String(error)) })
      return { kill() {} }
    }
    // Ошибка запуска приходит событием, а не исключением: `spawn` возвращает
    // ребёнка сразу, а ENOENT — потом. Код при этом не приходит вовсе.
    child.on('error', (error) => { finish(null, error.message) })
    if (child.stdout) createInterface({ input: child.stdout }).on('line', (text) => { sink.line(text) })
    if (child.stderr) createInterface({ input: child.stderr }).on('line', (text) => { sink.stderr(text) })
    child.on('close', (code) => { finish(code) })
    if (child.stdin) {
      // Разрыв stdin (ребёнок умер до чтения) — не наша ошибка: она уже пришла через 'error'/'close'.
      child.stdin.on('error', () => {})
      child.stdin.end(input)
    }
    return { kill() { child.kill() } }
  },
}
