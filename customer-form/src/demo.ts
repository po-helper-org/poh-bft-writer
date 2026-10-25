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
  screen: string
  /** Что заказчик делает. */
  action: string
  /** Что должен увидеть — проверяемый результат. */
  expect: string
  /** Устройство экрана: браузер, письмо, уведомление, приложение (rev10). */
  device?: string
  /** Состав экрана для картинки раскадровки: «заголовок: …; оффер: …; кнопка: …» (mock.ts). */
  mock?: string
}

export interface AcceptanceDemo {
  title: string
  where: string
  steps: DemoStep[]
  /** Чек-лист приёмки от лица заказчика (rev11); строкой — из старых версий. */
  done: string[] | string
  /** Черновик по материалам заказчика (rev8): что ИИ понял до вопросов. */
  asis?: string
  gap?: string
  tobe?: string
  /** Чего нет в материалах или где они противоречат. */
  unclear?: string[]
}

const WIDTH = 46

/** Перенос по словам в строки не длиннее width. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.replace(/\s+/g, ' ').trim().split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = ''
    }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/**
 * Каркас экрана: заголовок, действие ▶ и ожидаемый результат ✓. Рамка только
 * слева: ширина ▶/✓ и эмодзи в моноширинных шрифтах разная, правый край
 * поехал бы.
 */
function screenBox(step: DemoStep, index: number): string {
  const row = (prefix: string, text: string) => wrap(text, WIDTH - prefix.length)
    .map((part, i) => (i ? ' '.repeat(prefix.length) : prefix) + part)
  const [title, ...rest] = row('', `ЭКРАН ${index + 1} · ${step.screen}`)
  const body = [...rest, ...row('▶ Делаю: ', step.action), ...row('✓ Вижу:  ', step.expect)]
  return ['```text', `┌─ ${title}`, ...body.map((line) => `│ ${line}`), `└${'─'.repeat(WIDTH)}`, '```'].join('\n')
}

/** «1 шаг», «3 шага», «5 шагов». */
function stepsWord(n: number): string {
  const tens = n % 100, ones = n % 10
  if (tens >= 11 && tens <= 14) return `${n} шагов`
  return `${n} ${ones === 1 ? 'шаг' : ones >= 2 && ones <= 4 ? 'шага' : 'шагов'}`
}

/**
 * Документ на согласование. Первая строка — заголовок карточки, первый абзац —
 * её двухстрочное описание (так карточку plan-review строит dsh).
 */
export function storyboardMarkdown(demo: AcceptanceDemo): string {
  const path = demo.steps.map((s) => s.screen).join(' → ')
  const understood = [['ASIS — как сейчас', demo.asis], ['GAP — что не устраивает', demo.gap], ['TOBE — как должно стать', demo.tobe]]
    .filter(([, value]) => value?.trim())
  const unclear = (demo.unclear ?? []).filter((u) => u.trim())
  return [
    understood.length ? `# Как я понял задачу и как вы её примете: ${demo.title}` : `# Как я буду принимать: ${demo.title}`,
    '',
    `${stepsWord(demo.steps.length)}: ${path}. Проверяю: ${demo.where}.`,
    '',
    ...(understood.length ? ['## Как я понял задачу', '', ...understood.flatMap(([head, value]) => [`**${head}.** ${value}`, '']), ''] : []),
    '## Раскадровка по экранам',
    '',
    ...demo.steps.flatMap((step, i) => [screenBox(step, i), '']),
    '## Работа принята, если',
    '',
    ...doneList(demo).map((item) => `- [ ] ${item}`),
    ...(unclear.length ? ['', '## Не нашёл в материалах или есть противоречие', '', ...unclear.map((u) => `- ${u}`)] : []),
  ].join('\n')
}

/** Чек-лист приёмки: пункты от лица заказчика (старый формат — одна фраза). */
export function doneList(demo: AcceptanceDemo): string[] {
  const raw = Array.isArray(demo.done) ? demo.done : String(demo.done ?? '').split(/\n|;\s*/)
  return raw.map((item) => String(item).replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean)
}

/** Шаги одной строкой каждый — в поле howToDemo постановки. */
export function demoSteps(demo: AcceptanceDemo): string[] {
  return demo.steps.map((s) => `${s.screen}: ${s.action} → ${s.expect}`)
}

/** Последний сценарий сессии: его показывает страница в правой панели (demo-page.ts). */
export interface DemoRecord {
  demo: AcceptanceDemo
  rev: number
  approvedAt?: string
}

let demos: Map<string, DemoRecord> | undefined

/** Один реестр на процесс: пишет инструмент confirm_acceptance_demo, читает узел. */
export function sharedDemos(): Map<string, DemoRecord> {
  demos ??= new Map()
  return demos
}

const GLUED = /<\/[\w-]+>\s*<parameter name="([\w-]+)">/

/**
 * Ремонт склеенных аргументов: Haiku через OpenAI-совместимый маршрут иногда
 * пишет следующие параметры внутрь строки предыдущего —
 * «… [S1 03:02].</gap> <parameter name="tobe">…</tobe> <parameter name="unclear">[…]».
 * Разбиваем обратно по полям, ничего не теряя.
 */
export function repairDemo(demo: AcceptanceDemo): AcceptanceDemo {
  const fixed: AcceptanceDemo = { ...demo }
  const record = fixed as unknown as Record<string, unknown>
  for (const key of ['title', 'where', 'done', 'asis', 'gap', 'tobe'] as const) {
    const value = fixed[key]
    if (typeof value !== 'string' || !GLUED.test(value)) continue
    const parts = value.split(GLUED)
    record[key] = parts[0].replace(/<\/[\w-]+>\s*$/, '').trim()
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i]
      const text = (parts[i + 1] ?? '').replace(/<\/[\w-]+>\s*$/, '').trim()
      if (name === 'unclear') {
        let list: unknown
        try { list = JSON.parse(text) } catch { list = text.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean) }
        if (Array.isArray(list)) fixed.unclear = [...(fixed.unclear ?? []), ...list.map(String)]
      } else if (!record[name]) record[name] = text
    }
  }
  return fixed
}
