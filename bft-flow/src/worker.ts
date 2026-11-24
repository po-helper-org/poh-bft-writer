/**
 * Воркер цикла БФТ: код workflow, очередь bft-flow (ADR-0022). Активности
 * портала (модель, файлы, трекер) исполняет сам портал — очередь bft-portal,
 * с шага 2 перехода.
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Connection } from '@temporalio/client'
import { NativeConnection, Worker } from '@temporalio/worker'
import { NAMESPACE_DEFAULT, TASK_QUEUE } from './events.js'
import { ensureNamespace, ensureSearchAttributes } from './setup.js'

const ADDRESS = process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233'
const NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? NAMESPACE_DEFAULT
const RETENTION_DAYS = Number(process.env.BFT_RETENTION_DAYS ?? 365)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function connectWithRetry(): Promise<Connection> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await Connection.connect({ address: ADDRESS })
    } catch (e) {
      if (attempt % 10 === 1) console.log(`[bft-flow] Temporal ${ADDRESS} не отвечает (${(e as Error).message}) — жду`)
      await sleep(3000)
    }
  }
}

async function main(): Promise<void> {
  // Метка прошлого запуска (контейнер перезапущен) — не готов, пока не подключимся заново.
  if (process.env.BFT_FLOW_READY_FILE) rmSync(process.env.BFT_FLOW_READY_FILE, { force: true })
  const admin = await connectWithRetry()
  await ensureNamespace(admin, NAMESPACE, RETENTION_DAYS)
  await ensureSearchAttributes(admin, NAMESPACE)
  await admin.close()

  // Готовый бандл workflow (npm run build) — воркер не собирает его при старте: память сервера тесная.
  const bundle = fileURLToPath(new URL('./workflow-bundle.js', import.meta.url))
  const connection = await NativeConnection.connect({ address: ADDRESS })
  const worker = await Worker.create({
    connection,
    namespace: NAMESPACE,
    taskQueue: TASK_QUEUE,
    ...(existsSync(bundle)
      ? { workflowBundle: { codePath: bundle } }
      : { workflowsPath: fileURLToPath(new URL('./workflows.js', import.meta.url)) }),
    maxConcurrentWorkflowTaskExecutions: 20,
  })
  console.log(`[bft-flow] воркер: ${ADDRESS}, namespace ${NAMESPACE}, очередь ${TASK_QUEUE}`)
  // Метка готовности для healthcheck контейнера: namespace и атрибуты есть, воркер подключён.
  if (process.env.BFT_FLOW_READY_FILE) writeFileSync(process.env.BFT_FLOW_READY_FILE, new Date().toISOString())
  await worker.run()
}

main().catch((e) => {
  console.error('[bft-flow] воркер упал:', e)
  process.exit(1)
})
