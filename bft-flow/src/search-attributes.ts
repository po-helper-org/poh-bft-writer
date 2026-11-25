/** Атрибуты поиска цикла (SQL-видимость Temporal): списки «ждёт PO», «зависшие» — без своей БД. */
import { defineSearchAttributeKey, SearchAttributeType } from '@temporalio/common'

export const BFT_STAGE = defineSearchAttributeKey('BftStage', SearchAttributeType.KEYWORD)
export const BFT_TASK_ID = defineSearchAttributeKey('BftTaskId', SearchAttributeType.INT)
export const BFT_ROUND = defineSearchAttributeKey('BftRound', SearchAttributeType.INT)
export const BFT_WAITING_FOR = defineSearchAttributeKey('BftWaitingFor', SearchAttributeType.KEYWORD_LIST)
export const BFT_UPDATED_AT = defineSearchAttributeKey('BftUpdatedAt', SearchAttributeType.DATETIME)

export const SEARCH_ATTRIBUTES = [BFT_STAGE, BFT_TASK_ID, BFT_ROUND, BFT_WAITING_FOR, BFT_UPDATED_AT] as const
