/**
 * Обезличивание страницы перед снимком для плейбука.
 *
 * Скриншоты в docs/ публичны, а харнесс показывает живой Backlog.md: названия продуктов,
 * партнёров, фамилии, ссылки на трекер и вики. Замазывать картинки руками бессмысленно —
 * следующий `pnpm playbook:shots` вернул бы всё обратно. Поэтому подмена делается в DOM
 * перед каждым снимком и откатывается сразу после: React своих узлов не трогал, и следующий
 * шаг сценария видит исходный текст.
 *
 * Сами названия, которые нужно прятать, — тоже секрет: список «что скрывать» в публичном
 * репозитории раскрыл бы ровно то, что скрывает. Поэтому в коде только общие правила
 * (почта, «Фамилия Имя»), а словарь установки живёт в `e2e/.redact.local.json` — файл в
 * .gitignore, формат — `e2e/redact.local.example.json`.
 *
 * Гейт после подмены — `assertClean`: остался хоть один запрещённый фрагмент, снимок не
 * делается и прогон падает. Правила ловят только текст; логотипы-картинки они не видят.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Frame, Page } from '@playwright/test'

/** Правило подмены: регулярка строкой (уезжает в браузер), флаги, замена. */
export interface RedactionRule {
  pattern: string
  flags: string
  replacement: string
}

/** Формат `e2e/.redact.local.json`. Все регулярки — строками, флаги по умолчанию `gu`. */
export interface LocalRedactions {
  /** Правила подмены; `word: true` оборачивает шаблон границами слова (кириллица тоже). */
  rules?: Array<{ pattern: string; replacement: string; flags?: string; word?: boolean }>
  /** Что не имеет права остаться на снимке (регулярки, без границ — их добавьте сами через `word`). */
  forbidden?: Array<{ pattern: string; word?: boolean } | string>
  /** Фамилии без имени: общей эвристики на одно слово нет — «Магазин» тоже кончается на «-ин». */
  surnames?: string[]
  /** Строки с живой страницы для теста правил: после подмены в них не должно остаться `forbidden`. */
  samples?: string[]
}

const rule = (pattern: string, replacement: string, flags = 'gu'): RedactionRule => ({ pattern, flags, replacement })

/**
 * Граница слова для кириллицы. `\b` в JS считает словом только ASCII, и `\bМТС\b` не
 * совпал бы вовсе — поэтому границы заданы явно через unicode-классы (флаг `u`).
 */
const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}\p{N}])`
const NOT_LETTER_AFTER = String.raw`(?![\p{L}\p{N}])`
export const word = (alternatives: string): string => `${NOT_LETTER_BEFORE}(?:${alternatives})${NOT_LETTER_AFTER}`

/** Суффиксы фамилий для эвристики «Фамилия Имя» / «Имя Фамилия». */
const SURNAME_TAIL = 'ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая|ич|енко|ко|ук|юк|ян|дзе|швили'

const LOCAL_FILE = path.resolve('e2e/.redact.local.json')

function loadLocal(): LocalRedactions {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')) as LocalRedactions
  } catch {
    // Файла нет — работают только общие правила. Для публикации снимков это мало: словарь
    // установки обязателен, см. e2e/README.md.
    return {}
  }
}

export const LOCAL = loadLocal()

/**
 * Общие правила: не зависят от установки. Почта → example.com; «Фамилия Имя» и
 * «Имя Фамилия» по суффиксам → «Сотрудник». Ложное срабатывание на паре слов с заглавных
 * букв стоит одного лишнего «Сотрудник», пропуск — раскрытой фамилии.
 */
export const GENERIC_RULES: RedactionRule[] = [
  rule(String.raw`[\w.+-]+@[a-z0-9.-]+\.[a-z]{2,}`, 'user@example.com', 'giu'),
  rule(word(String.raw`[А-ЯЁ][а-яё]+(?:${SURNAME_TAIL})\s+[А-ЯЁ][а-яё]+`), 'Сотрудник'),
  rule(word(String.raw`[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:${SURNAME_TAIL})`), 'Сотрудник'),
]

/** Правила установки из локального словаря, в объявленном порядке. */
export const LOCAL_RULES: RedactionRule[] = (LOCAL.rules ?? []).map(r =>
  rule(r.word === true ? word(r.pattern) : r.pattern, r.replacement, r.flags ?? 'gu'))

/** Фамилии без имени — после парных правил, иначе имя осталось бы рядом. */
const SURNAME_RULES: RedactionRule[] = (LOCAL.surnames ?? []).length > 0
  ? [rule(word(String.raw`(?:${(LOCAL.surnames ?? []).join('|')})\p{L}*`), 'Сотрудник')]
  : []

/**
 * Порядок важен: сперва правила установки (целые ссылки, ключи задач, названия), потом
 * общие — иначе домен внутри адреса трекера заменился бы раньше, чем адрес распознался.
 */
export const REDACTIONS: RedactionRule[] = [...LOCAL_RULES, ...GENERIC_RULES, ...SURNAME_RULES]

/** Что не имеет права остаться на снимке: словарь установки плюс её фамилии. */
export const FORBIDDEN: string = [
  ...(LOCAL.forbidden ?? []).map(f => typeof f === 'string' ? f : (f.word === true ? word(f.pattern) : f.pattern)),
  ...(LOCAL.surnames ?? []).map(s => s.toLowerCase()),
].join('|')

/**
 * Значения, снятые с живого документа настроек PO (ссылка на форму, таблица, строки промта).
 * Они не известны заранее, поэтому регистрируются прогоном перед снимками: каждое становится
 * правилом подмены дословно, и что бы ни было в настройках, на снимок оно не попадёт.
 */
const SESSION_SECRETS = new Set<string>()

/**
 * Строки, которые секретом не считаются, даже если стоят в живом документе: умолчание промта
 * и демонстрационные значения прогонов (их регистрирует harness.ts). Иначе PO с промтом по
 * умолчанию получил бы «[скрыто]» на месте этого же умолчания на снимках.
 */
const SAFE_VALUES = new Set<string>(['/bft-needed-list {sheet}'])

export function markSafe(...values: string[]): void {
  for (const value of values) {
    for (const line of value.split(/\r?\n/)) SAFE_VALUES.add(line.trim())
  }
}

/** Регистрирует строки, которых не должно быть ни на одном снимке этого прогона. */
export function registerSecrets(...values: string[]): void {
  for (const value of values) {
    for (const line of value.split(/\r?\n/)) {
      const trimmed = line.trim()
      // Короткие обрывки («/bft-needed-list», пустая строка) правилом не становятся: они
      // встречаются и в демонстрационных значениях.
      if (trimmed.length >= 12 && !SAFE_VALUES.has(trimmed)) SESSION_SECRETS.add(trimmed)
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function activeRules(): RedactionRule[] {
  const secrets = [...SESSION_SECRETS].map(secret => rule(escapeRegExp(secret), '[скрыто]', 'g'))
  return [...secrets, ...REDACTIONS]
}

/** Применяет правила к строке — для тестов правил и для проверки словаря. */
export function redactText(text: string, rules: RedactionRule[] = REDACTIONS): string {
  return rules.reduce((acc, r) => acc.replace(new RegExp(r.pattern, r.flags), r.replacement), text)
}

/** Подменяет текст в одном фрейме; возвращает число тронутых узлов. */
function redactFrame(frame: Frame, rules: RedactionRule[]): Promise<number> {
  return frame.evaluate((input) => {
    type Touched = [Node | HTMLInputElement | HTMLTextAreaElement, string]
    const compiled = input.map(r => [new RegExp(r.pattern, r.flags), r.replacement] as const)
    const apply = (text: string): string => compiled.reduce((acc, [re, rep]) => acc.replace(re, rep), text)
    const touched: Touched[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode()) !== null) {
      const parent = node.parentElement
      if (parent === null || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue
      const before = node.textContent ?? ''
      const after = apply(before)
      if (after !== before) {
        touched.push([node, before])
        node.textContent = after
      }
    }
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      const before = el.value
      const after = apply(before)
      if (after !== before) {
        touched.push([el, before])
        el.value = after
      }
    }
    ;(window as unknown as { __bftRedacted?: Touched[] }).__bftRedacted = touched
    return touched.length
  }, rules)
}

function restoreFrame(frame: Frame): Promise<void> {
  return frame.evaluate(() => {
    type Touched = [Node | HTMLInputElement | HTMLTextAreaElement, string]
    const holder = window as unknown as { __bftRedacted?: Touched[] }
    for (const [target, before] of holder.__bftRedacted ?? []) {
      if (target.nodeType === Node.TEXT_NODE) target.textContent = before
      else (target as HTMLInputElement).value = before
    }
    holder.__bftRedacted = []
  })
}

/** Ищет запрещённые фрагменты в видимом тексте фрейма; пустой массив — чисто. */
function scanFrame(frame: Frame, forbidden: string): Promise<string[]> {
  return frame.evaluate((pattern) => {
    if (pattern.length === 0) return []
    const re = new RegExp(pattern, 'iu')
    const hits = new Set<string>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode()) !== null) {
      const parent = node.parentElement
      if (parent === null || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue
      const text = (node.textContent ?? '').trim()
      if (text.length > 0 && re.test(text)) hits.add(text.slice(0, 80))
    }
    for (const el of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')) {
      if (re.test(el.value)) hits.add(el.value.slice(0, 80))
    }
    return [...hits]
  }, forbidden)
}

/**
 * Обезличивает все фреймы страницы и возвращает откат. Фрейм, в который нельзя войти,
 * пропускается: чужой источник — это форма из form-server.ts, там нашего текста нет.
 */
export async function redactPage(page: Page): Promise<() => Promise<void>> {
  // Фотография пользователя в шапке левой панели — единственный <img> главного документа;
  // прячем на время снимка, обратно возвращаем вместе с текстом.
  await page.evaluate(() => {
    for (const img of document.querySelectorAll<HTMLImageElement>('img')) img.style.visibility = 'hidden'
  })
  const frames: Frame[] = []
  for (const frame of page.frames()) {
    try {
      await redactFrame(frame, activeRules())
      frames.push(frame)
    } catch {
      // Фрейм закрыт политикой источника или уже отвязан — снимать в нём нечего.
    }
  }
  return async () => {
    for (const frame of frames) {
      try {
        await restoreFrame(frame)
      } catch {
        // Фрейм ушёл, пока делали снимок: откатывать нечего.
      }
    }
    await page.evaluate(() => {
      for (const img of document.querySelectorAll<HTMLImageElement>('img')) img.style.visibility = ''
    })
  }
}

/** Падает, если после подмены на странице остался запрещённый текст. */
export async function assertClean(page: Page): Promise<void> {
  const leaks: string[] = []
  for (const frame of page.frames()) {
    try {
      leaks.push(...await scanFrame(frame, FORBIDDEN))
    } catch {
      // Недоступный фрейм — см. redactPage.
    }
  }
  if (leaks.length > 0) {
    throw new Error(`на снимке остались фрагменты из словаря установки:\n  ${leaks.join('\n  ')}`)
  }
}
