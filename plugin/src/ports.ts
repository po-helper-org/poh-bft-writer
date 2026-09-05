/**
 * Границы с внешним миром. Всё, что читает диск или запускает процессы, живёт
 * здесь и только здесь — ядро остаётся чистым и проверяется без воркспейса.
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
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
export type RunCommand = (bin: string, args: string[], cwd: string) => Promise<{ stdout: string; code: number }>

export interface BftPorts {
  readTextFile: ReadTextFile
  listDirectory: ListDirectory
  writeTextFile: WriteTextFile
  realPath: RealPath
  runCommand: RunCommand
}

function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
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
      execFile(bin, args, { cwd, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
        // Код -1 — программу не удалось запустить вовсе (нет бинаря, нет прав).
        // Это штатное состояние: Backlog.md необязателен.
        const code = error ? ((error as NodeJS.ErrnoException & { code?: number }).code ?? -1) : 0
        resolve({ stdout: stdout ?? '', code: typeof code === 'number' ? code : -1 })
      })
    })
  },
}
