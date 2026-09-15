/**
 * Ссылки задачи Backlog.md: чего у задачи ещё нет.
 *
 * Общее для двух путей записи на доску — сверки по артефактам
 * (`backlog-writer.ts`: страница ревью, эпик, страница Confluence) и «Добавить в
 * OKR» (`okr-handoff.ts`): одна нормализация, чтобы правило «уже записано»
 * не разошлось между ними.
 */

/**
 * Адреса из `urls`, которых нет среди `known`. Сравнение как есть, без учёта
 * регистра и краевых пробелов: это URL, не пути документов. Адрес с запятой не
 * дописывается вовсе: `backlog --add-ref` делит значение по запятым, и такая
 * ссылка легла бы на доску мусором, который сверка добавляла бы снова и снова.
 */
export function missingRefs(known: readonly string[], urls: readonly (string | undefined)[]): string[] {
  const seen = new Set(known.map(ref => ref.trim().toLowerCase()))
  const out: string[] = []
  for (const url of urls) {
    if (!url || url.includes(',')) continue
    const key = url.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(url)
  }
  return out
}
