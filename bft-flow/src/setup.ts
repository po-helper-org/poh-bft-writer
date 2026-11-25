/**
 * Разовая подготовка Temporal при старте воркера (идемпотентно): namespace цикла
 * и атрибуты поиска. Отдельного init-контейнера не нужно — воркер не начнёт
 * брать задачи, пока namespace и атрибуты не готовы.
 */
import { Connection } from '@temporalio/client'
// @temporalio/proto — CommonJS: из ESM только default-импорт.
import proto from '@temporalio/proto'
import type { temporal } from '@temporalio/proto'
import { SEARCH_ATTRIBUTES } from './search-attributes.js'

const { IndexedValueType } = proto.temporal.api.enums.v1
type Long = NonNullable<temporal.api.workflowservice.v1.IRegisterNamespaceRequest['workflowExecutionRetentionPeriod']>['seconds']
const TYPE: Record<string, temporal.api.enums.v1.IndexedValueType> = {
  KEYWORD: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD,
  INT: IndexedValueType.INDEXED_VALUE_TYPE_INT,
  KEYWORD_LIST: IndexedValueType.INDEXED_VALUE_TYPE_KEYWORD_LIST,
  DATETIME: IndexedValueType.INDEXED_VALUE_TYPE_DATETIME,
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const code = (e: unknown) => (e as { code?: number }).code
const ALREADY_EXISTS = 6

export async function ensureNamespace(connection: Connection, namespace: string, retentionDays: number, log = console.log): Promise<void> {
  try {
    await connection.workflowService.registerNamespace({
      namespace,
      description: 'Жизненный цикл БФТ (ADR-0022)',
      // int64 protobuf принимает и число: дни хранения — далеко от границы точности.
      workflowExecutionRetentionPeriod: { seconds: (retentionDays * 24 * 3600) as unknown as Long },
    })
    log(`[bft-flow] namespace ${namespace} создан, хранение закрытых циклов — ${retentionDays} дн.`)
  } catch (e) {
    if (code(e) !== ALREADY_EXISTS) throw e
  }
  // Новый namespace расходится по кэшу сервера не сразу.
  for (let attempt = 0; ; attempt++) {
    try {
      await connection.workflowService.describeNamespace({ namespace })
      return
    } catch (e) {
      if (attempt >= 30) throw e
      await sleep(1000)
    }
  }
}

export async function ensureSearchAttributes(connection: Connection, namespace: string, log = console.log): Promise<void> {
  const { customAttributes } = await connection.operatorService.listSearchAttributes({ namespace })
  const missing = SEARCH_ATTRIBUTES.filter((key) => !(key.name in (customAttributes ?? {})))
  if (!missing.length) return
  await connection.operatorService.addSearchAttributes({
    namespace,
    searchAttributes: Object.fromEntries(missing.map((key) => [key.name, TYPE[key.type]!])),
  })
  log(`[bft-flow] атрибуты поиска: ${missing.map((k) => k.name).join(', ')}`)
}
