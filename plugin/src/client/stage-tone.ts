/**
 * Тон стадии для полосы `.item`, точки `.groupDot` в списке (Panel.tsx) и точки статус-строки
 * превью (Preview.tsx) — цвета только из `--dsw-*`, как в утверждённом прототипе. Вынесен в
 * отдельный модуль, а не объявлен в Panel.tsx и не реэкспортирован оттуда: Panel.tsx и
 * Preview.tsx импортируют друг у друга (Panel рендерит Preview в режиме превью, Preview красит
 * стадию тем же тоном) — общий источник тона третьим модулем убирает цикл импортов между ними,
 * а не полагается на то, что порядок вычисления модулей его как-нибудь перетерпит.
 */
import type { BftStage } from '../model.js'

export const STAGE_TONE: Record<BftStage, string> = {
  'To Do': 'var(--dsw-alias-label-caption)',
  'FAST-DONE': 'var(--dsw-alias-button-info-fill)',
  'REVIEW-DONE': 'var(--dsw-alias-button-info-fill)',
  'DEEP-WORK': 'var(--dsw-alias-button-info-fill)',
  'DEEP-REVIEW': 'var(--dsw-alias-state-warn-primary)',
  'DEEP-DONE': 'var(--dsw-alias-state-success-primary)',
  Cancelled: 'var(--dsw-alias-label-caption)',
}
