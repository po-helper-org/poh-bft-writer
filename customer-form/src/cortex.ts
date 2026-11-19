/**
 * Кортекс — память организации (ADR-0011): сервис коробки отвечает, кого
 * касается запрос, что известно о процессах, в чьи зоны он попадает и где его
 * проверять. bft-fast берёт отсюда контуры проверки и зоны влияния — модель в
 * этом не участвует: каждое утверждение с якорем на узел памяти.
 *
 * Сервис недоступен или не знает — документ собирается без этих разделов
 * (пусто — валидный ответ Кортекса, а не ошибка).
 *
 * Память агента bft-creator (ADR-0016) отвечает ещё тремя разделами: домены и
 * контрагенты, термины из текста запроса и прошлые БФТ по теме. Они идут в
 * карту контекста — для PO и полного БФТ; старый Кортекс их не отдаёт.
 */
import { contentTerms, countTerms } from './stems.js'

export interface CortexAnchor {
  node_id: string
  title: string
  owner?: string | null
  cp?: number | null
  ripeness?: string | null
  sources: string[]
  summary: string
  aliases?: string[]
  draft?: boolean
}

export interface CortexTerm { node_id: string; term: string; meaning: string; sources: string[] }

export interface CortexBrief {
  vault: { name: string; nodes: number; demo: boolean }
  people: (CortexAnchor & { name: string; role: string; zones: string[]; contact_for: string[] })[]
  processes: CortexAnchor[]
  domains: { owner: string; zones: string[]; nodes: string[] }[]
  landscape: (CortexAnchor & { where_to_check: string[]; environments: string[] })[]
  /** Домены, границы команд, партнёры и заказчики (Нексус domains). */
  areas?: CortexAnchor[]
  /** Термины словаря, которые есть в тексте запроса. */
  glossary?: CortexTerm[]
  /** Итоговые БФТ прошлых заявок по теме (Нексус bft-archive). */
  precedents?: CortexAnchor[]
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

/**
 * Только узлы по теме запроса (план C4): процесс или система остаётся, если в
 * её названии не меньше двух непроцессных терминов запроса (или один — и ещё
 * минимум два в названии и описании вместе). Люди — владельцы оставшихся
 * узлов или те, чьи зоны и роль про тему; «Зоны влияния» — заново, только из
 * оставшихся узлов. Иначе общие узлы памяти попадают в каждую заявку.
 * Имена узла — заголовок и aliases: заказчик называет систему по-своему
 * («ТЛ», «витрина»). Домены и прошлые БФТ — по тому же правилу; термины Кортекс
 * уже отобрал по тексту запроса.
 */
export function relevantBrief(brief: CortexBrief, query: string): CortexBrief {
  const list = contentTerms([query])
  const relevant = (node: CortexAnchor) => {
    const names = [node.title, ...(node.aliases ?? [])].join('\n')
    const inTitle = countTerms(names, list)
    return inTitle >= 2 || (inTitle >= 1 && countTerms(`${names}\n${node.summary}`, list) >= 3)
  }
  const processes = brief.processes.filter(relevant)
  const landscape = brief.landscape.filter(relevant)
  const kept = [...processes, ...landscape]
  const keptRefs = new Set(kept.flatMap((n) => [n.node_id, n.title]))
  const owners = new Set(kept.map((n) => n.owner).filter((o): o is string => !!o))
  const domains = brief.domains
    .map((d) => ({ ...d, nodes: d.nodes.filter((n) => keptRefs.has(n)) }))
    .filter((d) => d.nodes.length > 0)
  const domainOwners = new Set(domains.map((d) => d.owner))
  const people = brief.people.filter((p) => owners.has(p.name) || owners.has(p.node_id) || domainOwners.has(p.name)
    || countTerms([p.role, ...p.zones, ...p.contact_for].join('\n'), list) >= 2)
  return {
    ...brief, people, processes, domains, landscape,
    ...(brief.areas ? { areas: brief.areas.filter(relevant) } : {}),
    ...(brief.precedents ? { precedents: brief.precedents.filter(relevant) } : {}),
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
  if (!brief.people.length && !brief.processes.length && !brief.domains.length && !brief.landscape.length
    && !brief.areas?.length && !brief.glossary?.length && !brief.precedents?.length) {
    out.push('Память по этой теме ничего не знает.')
    return `${out.join('\n')}\n`
  }
  const section = (title: string, lines: string[]) => {
    out.push(`## ${title}`, '', ...(lines.length ? lines : ['Память этого не знает.']), '')
  }
  section('О ком идёт речь', brief.people.map((p) => `- **${p.name}** — ${p.role}. Зоны: ${p.zones.join(', ') || '—'}. К нему: ${p.contact_for.join(', ') || '—'}. ${anchorLine(p)}`))
  section('Что известно о процессах', brief.processes.map((p) => `- **${p.title}** — ${p.summary} ${anchorLine(p)}`))
  if (brief.areas) section('Домены и контрагенты', brief.areas.map((a) => `- **${a.title}** — ${a.summary} ${anchorLine(a)}`))
  section('Зоны влияния', brief.domains.map((d) => `- **${d.owner}**: ${[...d.zones, ...d.nodes.map((n) => `«${n}»`)].join(', ')}`))
  section('Владельцы систем', brief.landscape.filter((s) => s.owner).map((s) => `- ${s.title} → ${s.owner}`))
  section('IT-ландшафт: где и как проверять', brief.landscape.map((s) => `- **${s.title}** — ${s.where_to_check.join('; ') || s.summary}${s.owner ? `. Владелец: ${s.owner}` : ''}. ${anchorLine(s)}`))
  if (brief.glossary) section('Термины', brief.glossary.map((t) => `- **${t.term}** — ${t.meaning} \`${t.node_id}\``))
  if (brief.precedents) section('Прошлые БФТ по теме', brief.precedents.map((p) => `- **${p.title}** — ${p.summary} ${anchorLine(p)}`))
  return out.join('\n')
}
