/**
 * Обёртка markdown-артефакта в самодостаточную HTML-страницу для того же iframe, в котором
 * показывается готовый HTML-документ требования.
 *
 * Зачем вообще: быстрый проход `/bft-fast` не рендерит HTML — он производит `letter.md` и
 * `requirements.md`. Раньше на стадии FAST-DONE детальная страница показывала пустой экран
 * «Документа нет», хотя артефакты лежали на диске. Теперь показывается то, что реально есть.
 *
 * Почему свой конвертер, а не библиотека: пакет не тянет markdown-зависимостей, а нужный
 * здесь объём — заголовки, таблицы, списки, код, цитаты и переносы строк — покрывается
 * несколькими правилами. Это осознанно не полный CommonMark.
 *
 * Безопасность: исходный markdown экранируется ЦЕЛИКОМ до применения правил разметки,
 * поэтому HTML/скрипты из файла не могут попасть в документ как разметка. iframe при этом
 * остаётся в той же песочнице, что и для готового HTML.
 */

/** Экранирует всё, что может быть прочитано как разметка. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Инлайновая разметка. Работает уже по экранированному тексту. */
function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    // Ссылки: адрес пропускаем только http(s) — иначе останется просто текст.
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

/** Строка таблицы `| a | b |` → массив ячеек. */
function cells(line: string): string[] {
  return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')
}

/** Преобразует markdown в фрагмент HTML. Вход обязан быть уже экранированным. */
function renderBody(escaped: string): string {
  const lines = escaped.split('\n')
  const out: string[] = []
  let i = 0
  let listType: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listType) { out.push(`</${listType}>`); listType = null }
  }

  while (i < lines.length) {
    const line = lines[i]

    // Блок кода ```...```
    if (/^\s*```/.test(line)) {
      closeList()
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) { body.push(lines[i]); i++ }
      i++
      out.push(`<pre><code>${body.join('\n')}</code></pre>`)
      continue
    }

    // Таблица: строка с | и следующая — разделитель.
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      closeList()
      const head = cells(line)
      i += 2
      const body: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        body.push(cells(lines[i])); i++
      }
      const th = head.map(c => `<th>${inline(c)}</th>`).join('')
      const rows = body
        .map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`)
        .join('')
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${rows}</tbody></table>`)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`)
      i++
      continue
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      closeList()
      out.push('<hr>')
      i++
      continue
    }

    const quote = /^\s*&gt;\s?(.*)$/.exec(line)
    if (quote) {
      closeList()
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      i++
      continue
    }

    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ordered || bullet) {
      const want: 'ul' | 'ol' = ordered ? 'ol' : 'ul'
      if (listType !== want) { closeList(); out.push(`<${want}>`); listType = want }
      // Чекбоксы задач показываем символом, а не интерактивным полем: документ только читается.
      const text = (ordered ?? bullet)![1]
        .replace(/^\[ \]\s*/, '☐ ')
        .replace(/^\[[xX]\]\s*/, '☑ ')
      out.push(`<li>${inline(text)}</li>`)
      i++
      continue
    }

    if (line.trim() === '') { closeList(); i++; continue }

    // Абзац: собираем подряд идущие непустые строки, переносы сохраняем.
    closeList()
    const para: string[] = []
    while (
      i < lines.length && lines[i].trim() !== ''
      && !/^(#{1,6})\s/.test(lines[i]) && !/^\s*[-*+]\s/.test(lines[i])
      && !/^\s*\d+\.\s/.test(lines[i]) && !/^\s*```/.test(lines[i])
      && !/^\s*&gt;\s?/.test(lines[i])
    ) { para.push(lines[i]); i++ }
    out.push(`<p>${inline(para.join('<br>'))}</p>`)
  }

  closeList()
  return out.join('\n')
}

/**
 * Готовая страница для iframe. Оформление намеренно повторяет читаемый серифный макет
 * HTML-артефактов bft-writer, чтобы переход между стадиями не выглядел сменой продукта.
 */
export function markdownToPage(markdown: string, title: string): string {
  const body = renderBody(escapeHtml(markdown))
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{ color-scheme: light; }
body{
  margin:0; padding:32px 40px; background:#fff; color:#000;
  font:15px/1.6 Georgia,"Times New Roman",serif;
}
code,pre{ font-family:"Courier New",Consolas,monospace; }
code{ background:#f2f2f2; padding:1px 4px; }
pre{ background:#f7f7f7; border:1px solid #ddd; padding:12px; overflow:auto; }
pre code{ background:none; padding:0; }
h1,h2,h3,h4,h5,h6{ line-height:1.25; margin:1.6em 0 .6em; }
h1{ font-size:1.7em; } h2{ font-size:1.35em; } h3{ font-size:1.15em; }
table{ border-collapse:collapse; width:100%; margin:1em 0; font-size:.94em; }
th,td{ border:1px solid #bbb; padding:6px 9px; text-align:left; vertical-align:top; }
th{ background:#f2f2f2; }
blockquote{ margin:1em 0; padding:.2em 1em; border-left:3px solid #bbb; color:#555; }
hr{ border:none; border-top:1px solid #ccc; margin:1.8em 0; }
a{ color:#0000ee; }
li{ margin:.25em 0; }
</style>
</head>
<body>
${body}
</body>
</html>`
}
