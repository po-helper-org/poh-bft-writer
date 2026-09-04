/**
 * Границы с внешним миром. Всё, что читает диск или запускает процессы, живёт
 * здесь и только здесь — ядро остаётся чистым и проверяется без воркспейса.
 */
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

export interface BftPorts {
  readTextFile: ReadTextFile
  listDirectory: ListDirectory
  writeTextFile: WriteTextFile
  realPath: RealPath
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
}
