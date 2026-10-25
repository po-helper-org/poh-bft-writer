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
}

export interface AcceptanceDemo {
  title: string
  where: string
  steps: DemoStep[]
  done: string
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
    demo.done,
    ...(unclear.length ? ['', '## Не нашёл в материалах или есть противоречие', '', ...unclear.map((u) => `- ${u}`)] : []),
  ].join('\n')
}

/** Шаги одной строкой каждый — в поле howToDemo постановки. */
export function demoSteps(demo: AcceptanceDemo): string[] {
  return demo.steps.map((s) => `${s.screen}: ${s.action} → ${s.expect}`)
}
