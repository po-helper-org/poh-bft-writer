/**
 * Кортекс — память организации (ADR-0011): сервис коробки отвечает, кого
 * касается запрос, что известно о процессах, в чьи зоны он попадает и где его
 * проверять. bft-fast берёт отсюда контуры проверки и зоны влияния — модель в
 * этом не участвует: каждое утверждение с якорем на узел памяти.
 *
 * Сервис недоступен или не знает — документ собирается без этих разделов
 * (пусто — валидный ответ Кортекса, а не ошибка).
 */
export interface CortexAnchor {
  node_id: string
  title: string
  owner?: string | null
  cp?: number | null
  ripeness?: string | null
  sources: string[]
  summary: string
  draft?: boolean
}

export interface CortexBrief {
  vault: { name: string; nodes: number; demo: boolean }
  people: (CortexAnchor & { name: string; role: string; zones: string[]; contact_for: string[] })[]
  processes: CortexAnchor[]
  domains: { owner: string; zones: string[]; nodes: string[] }[]
  landscape: (CortexAnchor & { where_to_check: string[]; environments: string[] })[]
}

export async function cortexBrief(text: string, url = process.env.CORTEX_URL): Promise<CortexBrief | undefined> {
  if (!url) return undefined
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/brief`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`cortex ${res.status}`)
    return (await res.json()) as CortexBrief
  } catch (e) {
    console.error('[customer-form] Кортекс не ответил, документ — без контуров проверки и зон:', (e as Error).message)
    return undefined
  }
}

const anchorLine = (a: CortexAnchor) => `\`${a.node_id}\`${a.cp ? ` · CP ${a.cp}` : ''}${a.ripeness ? ` · ${a.ripeness}` : ''}${a.sources.length ? ` · ${a.sources.join(', ')}` : ''}`

/**
 * Карта контекста для PO и /bft-deep — отдельным файлом, как у /bft-recon: в
 * документ первичных требований находки памяти не вписываются, а лежат рядом
 * с якорями, чтобы их можно было перепроверить.
 */
export function contextMapMarkdown(brief: CortexBrief, slug: string): string {
  const out = [`# Карта контекста · ${slug}`, '',
    `Из памяти организации (Кортекс${brief.vault.demo ? ', демо-память' : ''}: ${brief.vault.name}, узлов ${brief.vault.nodes}). Указатель, а не фактбаза: каждый пункт — с якорем.`, '']
  const section = (title: string, lines: string[]) => {
    out.push(`## ${title}`, '', ...(lines.length ? lines : ['Память этого не знает.']), '')
  }
  section('О ком идёт речь', brief.people.map((p) => `- **${p.name}** — ${p.role}. Зоны: ${p.zones.join(', ') || '—'}. К нему: ${p.contact_for.join(', ') || '—'}. ${anchorLine(p)}`))
  section('Что известно о процессах', brief.processes.map((p) => `- **${p.title}** — ${p.summary} ${anchorLine(p)}`))
  section('Зоны влияния', brief.domains.map((d) => `- **${d.owner}**: ${[...d.zones, ...d.nodes.map((n) => `«${n}»`)].join(', ')}`))
  section('IT-ландшафт: где и как проверять', brief.landscape.map((s) => `- **${s.title}** — ${s.where_to_check.join('; ') || s.summary}${s.owner ? `. Владелец: ${s.owner}` : ''}. ${anchorLine(s)}`))
  return out.join('\n')
}
