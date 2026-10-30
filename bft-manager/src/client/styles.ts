/**
 * Стили страницы — только токены темы DSH (`--dsw-alias-*`), те же, что у
 * доски poh-bft-plugin: светлая и тёмная темы приходят от оболочки.
 */
export const CSS = `
.bm-trigger { position: fixed; top: 10px; left: 12px; z-index: 35; pointer-events: auto; }
.bm-page {
  position: fixed; inset: 0; z-index: 40; display: flex; flex-direction: column;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
  pointer-events: auto; font-size: 14px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.bm-header {
  flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px;
  padding: 10px 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}
.bm-title { font-size: 16px; font-weight: 600; margin: 0 6px 0 0; white-space: nowrap; }
.bm-spacer { flex: 1; }
.bm-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.bm-search { width: 240px; max-width: 100%; }
.bm-banner { margin: 10px 16px 0; padding: 8px 12px; border-radius: 10px; font-size: 13px;
  color: var(--dsw-alias-state-error-primary); box-shadow: 0 0 0 0.5px var(--dsw-alias-state-error-primary); }
.bm-muted { color: var(--dsw-alias-label-caption); font-size: 12px; }
.bm-body { flex: 1; min-height: 0; overflow: auto; }

/* Список входящих запросов */
.bm-pills { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 16px 4px; }
.bm-list { padding: 8px 16px 24px; }
.bm-row {
  display: grid; grid-template-columns: minmax(180px, 2.4fr) minmax(110px, 1.2fr) 76px minmax(120px, 1.2fr) minmax(90px, 1fr) 32px; align-items: center; gap: 12px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer;
}
.bm-row + .bm-row { box-shadow: 0 -0.5px 0 var(--dsw-alias-border-l1); }
.bm-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.bm-row-head { cursor: default; color: var(--dsw-alias-label-caption); font-size: 12px; padding-top: 4px; padding-bottom: 4px; }
.bm-row-head:hover { background: transparent; }
.bm-name { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.bm-name b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-links { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.bm-person { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.bm-person > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bm-person.bm-none { color: var(--dsw-alias-label-tertiary); }
.bm-avatar {
  flex: none; width: 20px; height: 20px; border-radius: 50%; display: inline-grid; place-items: center;
  font-size: 10px; font-weight: 600; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary);
}
.bm-empty { padding: 32px 16px; text-align: center; color: var(--dsw-alias-label-caption); }

/* Доска БФТ */
.bm-board { height: 100%; display: flex; gap: 12px; padding: 16px; overflow-x: auto; box-sizing: border-box; }
.bm-col {
  flex: 1 0 240px; min-width: 240px; max-width: 320px; min-height: 0; display: flex; flex-direction: column;
  border-radius: 14px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2); overflow: hidden;
}
.bm-col.bm-drop { box-shadow: 0 0 0 1.5px var(--dsw-alias-brand-primary); }
.bm-col-head { flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 12px; font-size: 13px; font-weight: 500;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1); }
.bm-col-body { flex: 1; min-height: 60px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding: 8px; }
.bm-card {
  display: flex; flex-direction: column; gap: 8px; padding: 10px 10px 8px 12px; border-radius: 10px; cursor: pointer;
  background: var(--dsw-alias-bg-base); box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2); position: relative;
}
.bm-card:hover { box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l4); }
.bm-card[data-tone="warning"]::before, .bm-card[data-tone="danger"]::before {
  content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 2px;
}
.bm-card[data-tone="warning"]::before { background: var(--dsw-alias-state-warn-primary); }
.bm-card[data-tone="danger"]::before { background: var(--dsw-alias-state-error-primary); }
.bm-card-title { font-weight: 500; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.bm-card-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.bm-card-foot { display: flex; align-items: center; gap: 8px; justify-content: space-between; }

/* Окно «Ожидает PO» */
.bm-modal { width: min(520px, 100%); }
.bm-field { display: flex; flex-direction: column; gap: 6px; margin: 0 0 14px; }
.bm-field > span { font-size: 12px; color: var(--dsw-alias-label-caption); }
.bm-select { justify-content: flex-start; width: 100%; }

@media (max-width: 760px) {
  /* Строка-карточка: название и «⋯» сверху, статус/SLA/ответственный/БФТ — рядом меток. */
  .bm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
  .bm-row > .bm-name { flex: 1 1 calc(100% - 48px); }
  .bm-row > :last-child { order: 1; }
  .bm-row > .bm-cell-wide { order: 2; flex: 0 1 auto; min-width: 0; }
  .bm-row > .bm-links:has(> .bm-muted) { display: none; }
  .bm-row-head { display: none; }
  .bm-search { width: 100%; }
  .bm-tools { width: 100%; }
}
`
