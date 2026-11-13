/**
 * Узловая половина онбординга (US-5–8): ключ Z.AI и флаги первого запуска.
 *
 * Хранилище — два файла в DSH_HOME: `zai.key` (секрет) и `onboarding.json`
 * (пройден/пропущен, режим диктовки). Писать в harness/.env с хоста нельзя:
 * тот файл принадлежит compose на машине, а не контейнеру; вместо этого
 * entrypoint подмешивает zai.key в окружение при рестарте — подсказка о
 * рестарте часть сценария. Ввод-вывод инъектирован (порты): тесты без диска.
 */
import {
  keyCheckFromStatus, restartHint, validateZaiKey, ZAI_KEY_FILE,
  type DictationMode, type KeyCheckResult, type OnboardingState,
} from './onboarding.js'

/** Минимальная форма fetch, которой хватает сервису. */
export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ status: number }>

export interface OnboardingFs {
  readTextFile(path: string): Promise<string>
  writeTextFile(path: string, text: string): Promise<void>
}

export interface OnboardingDeps {
  /** DSH_HOME: /data в контейнере, ~/.dsh локально. */
  home: string
  fs: OnboardingFs
  /** Окружение процесса: ключ, подмешанный entrypoint, уже активен. */
  env: Record<string, string | undefined>
  fetch?: FetchLike
  /** Переопределяется тестом и demo-профилем. */
  checkUrl?: string
}

const DEFAULT_CHECK_URL = 'https://api.z.ai/api/paas/v4/models'

interface OnboardingFlags {
  done: boolean
  dictation: DictationMode
}

const DEFAULT_FLAGS: OnboardingFlags = { done: false, dictation: 'browser' }

export class OnboardingService {
  private readonly deps: OnboardingDeps

  constructor(deps: OnboardingDeps) {
    this.deps = deps
  }

  private keyPath(): string {
    return `${this.deps.home}/${ZAI_KEY_FILE}`
  }

  private flagsPath(): string {
    return `${this.deps.home}/onboarding.json`
  }

  private async readFlags(): Promise<OnboardingFlags> {
    try {
      const raw = await this.deps.fs.readTextFile(this.flagsPath())
      const parsed = JSON.parse(raw) as Partial<OnboardingFlags>
      return {
        done: parsed.done === true,
        dictation: parsed.dictation === 'local' ? 'local' : 'browser',
      }
    } catch {
      return { ...DEFAULT_FLAGS }
    }
  }

  private async writeFlags(flags: OnboardingFlags): Promise<void> {
    await this.deps.fs.writeTextFile(this.flagsPath(), JSON.stringify(flags, null, 2))
  }

  private async readKey(): Promise<string> {
    try {
      return (await this.deps.fs.readTextFile(this.keyPath())).trim()
    } catch {
      return ''
    }
  }

  async state(): Promise<OnboardingState> {
    const flags = await this.readFlags()
    return {
      done: flags.done,
      hasKey: (await this.readKey()) !== '',
      keyActive: Boolean(this.deps.env.ZAI_API_KEY),
      dictation: flags.dictation,
    }
  }

  /** Проверка ключа сетевым вызовом: каталог моделей, без траты токенов. */
  async checkKey(raw: string): Promise<KeyCheckResult> {
    const form = validateZaiKey(raw)
    if (!form.ok) return { ok: false, message: form.reason ?? 'Ключ не похож на ключ Z.AI' }
    if (!this.deps.fetch) return { ok: false, message: 'Сетевая проверка недоступна в этом окружении' }
    try {
      const res = await this.deps.fetch(this.deps.checkUrl ?? DEFAULT_CHECK_URL, {
        headers: { Authorization: `Bearer ${raw.trim()}` },
      })
      return keyCheckFromStatus(res.status)
    } catch {
      return { ok: false, message: 'Z.AI не отвечает: проверьте сеть и попробуйте ещё раз' }
    }
  }

  /** «Готово»: валидный ключ пишется в DSH_HOME, флаг ставится, подсказка — рестарт. */
  async complete(rawKey: string, dictation: DictationMode): Promise<{ restartHint: string } | { error: string }> {
    const form = validateZaiKey(rawKey)
    if (!form.ok) return { error: form.reason ?? 'Ключ не похож на ключ Z.AI' }
    await this.deps.fs.writeTextFile(this.keyPath(), `${rawKey.trim()}\n`)
    await this.writeFlags({ done: true, dictation })
    return { restartHint: restartHint() }
  }

  /** «Пропустить»: флаг без ключа — оверлей больше не мешает, предупреждение уже показали. */
  async skip(): Promise<void> {
    await this.writeFlags({ ...(await this.readFlags()), done: true })
  }

  async setDictation(mode: DictationMode): Promise<void> {
    await this.writeFlags({ ...(await this.readFlags()), dictation: mode })
  }
}
