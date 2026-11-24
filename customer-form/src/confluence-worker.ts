/**
 * Исполнитель отправки в Confluence (ADR-0028): `node lib/confluence-worker.js`.
 *
 * Отдельный процесс (сервис `confluence-publisher`, образ портала) с единственной работой —
 * активности workflow ConfluencePublish в очереди bft-confluence. На сервере он в сети хоста:
 * Confluence там доступен только через VPN хоста, а из docker-сети портала — нет. Ключ записи
 * (`CONFLUENCE_PUBLISH_TOKEN`) есть только у этого процесса; файлы заявок — общий том /data.
 */
import { NativeConnection, Worker } from '@temporalio/worker'
import { FAST_ROOT, fastFiles } from './bft-fast.js'
import { deepFiles, readDeepState } from './bft-deep.js'
import { exportDocument } from './export.js'
import { ConfluenceWriter, plantumlPng, publishActivities, publishConfigFromEnv } from './confluence-publish.js'

export const CONFLUENCE_TASK_QUEUE = 'bft-confluence'

const ADDRESS = (process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233').trim()
const NAMESPACE = (process.env.TEMPORAL_NAMESPACE ?? 'bft').trim()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  const config = publishConfigFromEnv()
  const writer = config ? new ConfluenceWriter(config) : undefined
  console.log(`[confluence-publisher] Confluence: ${config ? 'адрес и ключ заданы' : 'не настроен (CONFLUENCE_PUBLISH_URL / CONFLUENCE_PUBLISH_TOKEN) — отправки будут честно отказывать'}`)
  const activities = publishActivities({
    files: (slug) => { const f = fastFiles(FAST_ROOT, slug); return { dir: f.dir, md: deepFiles(f, slug).md } },
    writer: () => writer,
    exportDoc: async (slug, md, format) => exportDocument(md, format, (await readDeepState(deepFiles(fastFiles(FAST_ROOT, slug), slug)))?.questions),
    renderPng: plantumlPng,
  })
  for (let attempt = 1; ; attempt++) {
    try {
      const connection = await NativeConnection.connect({ address: ADDRESS })
      const worker = await Worker.create({ connection, namespace: NAMESPACE, taskQueue: CONFLUENCE_TASK_QUEUE, activities, maxConcurrentActivityTaskExecutions: 2 })
      console.log(`[confluence-publisher] исполняю ${CONFLUENCE_TASK_QUEUE} (${ADDRESS}, namespace ${NAMESPACE})`)
      await worker.run()
      await connection.close().catch(() => undefined)
    } catch (e) {
      if (attempt % 10 === 1) console.log(`[confluence-publisher] Temporal ${ADDRESS}: ${(e as Error).message} — повтор через 5 с`)
      await sleep(5000)
    }
  }
}

main().catch((e) => { console.error('[confluence-publisher] упал:', e); process.exit(1) })
