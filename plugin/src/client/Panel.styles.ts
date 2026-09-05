/**
 * Стили панели «Требования» — как обычный текст CSS, инжектируемый одним `<style>` в
 * `document.head` (см. `apply()` в src/client/index.tsx), а не CSS-модуль.
 *
 * НАХОДКА (см. отчёт задачи): сборка стороннего плагина (`tsdown.config.ts` пакета, отдельная
 * от закрытого рецепта харнесса `harness-ui/packages/client/tsdown.client.ts`) не умеет
 * `*.module.css` — попытка импортировать его напрямую падает с
 * `[plugin tsdown:css-guard] ... @tsdown/css is not installed`. Официальный пакет
 * `@tsdown/css` устраняет эту ошибку сборки, но не решает задачу: по умолчанию он выносит
 * CSS в отдельный `lib/style.css`, а `client.js` не получает НИКАКОГО кода инъекции стиля —
 * проверено сборкой и grep'ом по бандлу (ни `createElement('style')`, ни `appendChild`).
 * `package.json#exports['./client']` этого пакета указывает только на `lib/client.js` — файл
 * `style.css` никто не подключает, и это тихо ломает вёрстку в проде без единой ошибки сборки.
 * Ближайший вариант, которым сам харнесс уже пользуется вне монорепозитория, —
 * `dsh-plugin-subscriptions/src/client/index.ts:74-80`: обычный текст CSS в `.ts`, вставленный
 * через `document.createElement('style')` внутри `ctx.effect()`. Тот же приём — здесь, только
 * стилей на целую панель, а не на одно точечное переопределение, поэтому текст CSS и карта
 * классов вынесены в отдельный файл, а не заведены прямо в index.tsx.
 *
 * Раз хеширования имён классов от CSS-модуля больше нет, коллизии с чужими классами предотвращает
 * префикс `bft-` на каждом селекторе (ниже, через один и тот же объект `c`, чтобы разметка и
 * карта имён не могли разойтись). Правила геометрии и токены — из утверждённого прототипа
 * docs/superpowers/prototypes/2026-09-02-bft-requirements-ui.html (секция «Правая панель»):
 * .panel/.ph-row/.list/.grp/.item/.badge/.empty. Состояния загрузки и ошибки прототип не
 * описывает — их геометрия на тех же токенах и тех же контейнерных правилах, что и пустое
 * состояние, чтобы переключение состояний не двигало раскладку.
 *
 * Все цвета — только через var(--dsw-...). Тайминги/шрифт — через var(--ds-...) токены
 * реального харнесса (harness-ui/packages/client/ui-theme/src/styles/base.css): там они
 * называются --ds-transition-duration(-fast|-slow), а не --ds-dur* — прототип для краткости
 * завёл свои алиасы, здесь используются настоящие имена.
 */

/** Плоская карта «семантическое имя → фактический класс». Единственный источник этих строк. */
export const panelClassNames = {
  panel: 'bft-panel',
  header: 'bft-header',
  badge: 'bft-badge',
  iconButton: 'bft-icon-button',
  body: 'bft-body',
  group: 'bft-group',
  groupHeader: 'bft-group-header',
  groupDot: 'bft-group-dot',
  groupLabel: 'bft-group-label',
  chevron: 'bft-chevron',
  groupBody: 'bft-group-body',
  item: 'bft-item',
  itemBody: 'bft-item-body',
  itemId: 'bft-item-id',
  // Утилитарные классы под настоящий <Button> из @deepseek-ai/dsh-client-ui-primitives (Task 4
  // визуального выравнивания): раньше нестандартная ширина/рост кнопки накручивались инлайн-style
  // поверх .bft-btn, Button принимает только className — эти два класса передаются туда же.
  fullWidth: 'bft-full-width',
  flexGrow: 'bft-flex-grow',
  stateBlock: 'bft-state-block',
  stateIcon: 'bft-state-icon',
  stateTitle: 'bft-state-title',
  stateHint: 'bft-state-hint',
  stateMessage: 'bft-state-message',
  skeletonGroup: 'bft-skeleton-group',
  skeletonHead: 'bft-skeleton-head',
  skeletonLine: 'bft-skeleton-line',
  skeletonBar: 'bft-skeleton-bar',
  searchRow: 'bft-search-row',
  searchIcon: 'bft-search-icon',
  searchInput: 'bft-search-input',
  searchClear: 'bft-search-clear',
  // Превью требования (Task 2): та же геометрия строк/токены, что у списка — новые классы
  // только там, где список не даёт готового куска разметки (заголовок, метаполя, кнопки-действия).
  previewScroll: 'bft-preview-scroll',
  previewTitle: 'bft-preview-title',
  previewMeta: 'bft-preview-meta',
  previewField: 'bft-preview-field',
  previewFieldLabel: 'bft-preview-field-label',
  previewFieldValue: 'bft-preview-field-value',
  previewLink: 'bft-preview-link',
  previewList: 'bft-preview-list',
  previewFooter: 'bft-preview-footer',
  // Детальная страница (Task 3): полноэкранная поверх приложения, тот же приём соседней панели
  // Cordis, что описан в DetailPage.tsx — не второй слот shell.overlay. Шапка и состояния
  // загрузки/ошибки переиспользуют header/iconButton/stateBlock/btn* выше; свои классы — только
  // там, где готовой геометрии нет (полноэкранный корень, двухколоночное тело, iframe, textarea).
  detailPage: 'bft-detail-page',
  detailBody: 'bft-detail-body',
  detailLeft: 'bft-detail-left',
  detailRight: 'bft-detail-right',
  detailFrame: 'bft-detail-frame',
  detailTextarea: 'bft-detail-textarea',
  // Футер списка панели (Task 4): держит кнопку «Статус проработки» вне скроллящегося
  // .body — сама кнопка теперь настоящий <Button variant="outline"> (Task 4 визуального
  // выравнивания, см. Panel.tsx), здесь только контейнер-полоска.
  panelFooter: 'bft-panel-footer',
  // Доска по стадиям (Task 4): полноэкранная страница переиспользует .detailPage/.header/
  // .iconButton (Task 3) и .groupDot/.groupLabel/.badge/.item/.itemBody/.itemId списка панели
  // (Task 1) — новые классы только там, где готовой геометрии нет: горизонтальный ряд колонок
  // и сама колонка (заголовок + скроллящееся тело), см. Board.tsx.
  boardRow: 'bft-board-row',
  boardColumn: 'bft-board-column',
  boardColumnHeader: 'bft-board-column-header',
  boardColumnBody: 'bft-board-column-body',
  // Кнопка раздела в подвале сайдбара (sidebar.footer.action, index.tsx: RequirementsButton) —
  // геометрия и имена классов скопированы 1:1 с эталона того же слота, соседнего плагина
  // харнесса ui-cordis: harness-ui/packages/extensions/ui-cordis/src/client/CordisPanel.tsx
  // (~469-484, div.footerButtons > button.badge) и CordisPanel.module.css (~3-80: .layer/
  // .footerButtons/.badge/.badgeLabel/.layer.rail/.rail .badge/.rail .footerButtons). У нас нет
  // аналога «счётчика бегущих плагинов» (badgeCount эталона) — свой badgeCount не заводим (см.
  // отчёт).
  navLayer: 'bft-nav-layer',
  navRail: 'bft-nav-rail',
  navFooterButtons: 'bft-nav-footer-buttons',
  navBadge: 'bft-nav-badge',
  navBadgeLabel: 'bft-nav-badge-label',
} as const

const c = panelClassNames

export const panelStyleText = `
/* Корень записи слота — сама панель, у правого края фрейма (см. docs/client-wiring.md, §3). */
.${c.panel} {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: min(420px, 100vw - 48px);
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--dsw-specific-sidebar-fill);
  border-left: 0.5px solid var(--dsw-alias-border-l3);
  box-shadow: var(--dsw-elevation-prominent);
  pointer-events: auto;
  /* Приподнятая поверхность — скроллбар получает l2-токены (см. SettingsRoot.module.css). */
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

.${c.header} {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 12px 8px;
}
.${c.header} h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${c.badge} {
  flex: none;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 10px;
  display: inline-grid;
  place-items: center;
  font-size: 11px;
  font-weight: 400;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-specific-selector);
  font-variant-numeric: tabular-nums;
}

/* Геометрия и цвет — дословно харнесс-эталон мелкой круглой icon-button (Task 4 визуального
   выравнивания): harness-ui/packages/client/ui-settings-general/src/client/SettingsRoot.module.css,
   класс .close (~строка 202). Единственное отличие от эталона было в цвете (у нас был
   --dsw-alias-label-tertiary с переходом в primary на hover) — поправлено на постоянный primary,
   как в эталоне; hover/28px/radius:999px≈circle геометрия уже совпадала и не менялась. */
.${c.iconButton} {
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-primary);
  transition: background-color var(--ds-transition-duration-fast) ease;
}
@media (hover: hover) and (pointer: fine) {
  .${c.iconButton}:hover { background: var(--dsw-alias-interactive-bg-hover); }
}
.${c.iconButton}:active { transform: scale(0.94); }
.${c.iconButton}:disabled { opacity: 0.5; }

/* Поле поиска: та же геометрия ряда, что и хедер, между ним и телом списка (Task 1). */
.${c.searchRow} {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 12px 8px;
  padding: 0 10px;
  height: 32px;
  border-radius: 10px;
  background: var(--dsw-specific-selector);
}
.${c.searchIcon} { flex: none; display: grid; place-items: center; color: var(--dsw-alias-label-caption); }
.${c.searchInput} {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
.${c.searchInput}::placeholder { color: var(--dsw-alias-label-caption); }
.${c.searchInput}:focus { outline: none; }
.${c.searchClear} {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  color: var(--dsw-alias-label-caption);
  transition: background-color var(--ds-transition-duration-fast) ease, color var(--ds-transition-duration-fast) ease;
}
@media (hover: hover) and (pointer: fine) {
  .${c.searchClear}:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
}

/* Тело панели: один и тот же контейнер (флекс-колонка со скроллом) для всех
   четырёх состояний, чтобы переход между ними не менял геометрию панели. */
.${c.body} {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* Группы стадий */
.${c.group} { flex: none; border-radius: 14px; background: var(--dsw-alias-bg-base); box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2); overflow: hidden; }
.${c.groupHeader} {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
  transition: background-color var(--ds-transition-duration-fast) ease;
}
@media (hover: hover) and (pointer: fine) { .${c.groupHeader}:hover { background: var(--dsw-alias-interactive-bg-hover); } }
.${c.groupDot} { flex: none; width: 6px; height: 6px; border-radius: 999px; background: var(--tone, var(--dsw-alias-label-caption)); }
.${c.groupLabel} { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${c.chevron} {
  flex: none;
  margin-left: auto;
  color: var(--dsw-alias-label-caption);
  font-size: 11px;
  transition: transform var(--ds-transition-duration) var(--ds-ease-in-out);
}
.${c.group}[data-collapsed="true"] .${c.chevron} { transform: rotate(-90deg); }
.${c.group}[data-collapsed="true"] .${c.groupBody} { display: none; }
.${c.groupBody} { border-top: 0.5px solid var(--dsw-alias-border-l1); }

/* Строка требования: цветная полоса стадии слева (::before, тон — через --tone). Сам элемент —
   <button> (Task 2, клик открывает превью): сброс кнопочных стилей браузера в правилах ниже. */
.${c.item} {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 9px 10px 9px 14px;
  background: none;
  border: none;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--ds-transition-duration-fast) ease;
}
.${c.item} + .${c.item} { border-top: 0.5px solid var(--dsw-alias-border-l1); }
.${c.item}::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--tone); }
@media (hover: hover) and (pointer: fine) { .${c.item}:hover { background: var(--dsw-alias-interactive-bg-hover); } }
.${c.itemBody} { flex: 1; min-width: 0; font-size: 13px; line-height: 19px; overflow-wrap: anywhere; }
.${c.itemId} { display: block; margin-top: 2px; font: 11px/15px var(--ds-font-family-code); color: var(--dsw-alias-label-caption); }

/* Кнопки-действия («Повторить», «Работать в чате», «Создать документ» и т.п.) — настоящий
   <Button> из @deepseek-ai/dsh-client-ui-primitives (Task 4 визуального выравнивания), не
   локальные .btn/.btn-outline/.btn-primary: тот компонент уже несёт капсульную геометрию и
   цвета вариантов на токенах --dsw-alias-button-* (harness-ui/packages/client/ui-primitives/src/
   Button.module.css) и подгружен хостом рантаймом (пакет внешний, см. CLIENT_EXTERNALS в
   tsdown.config.ts пакета) — свой CSS для этого заводить незачем. Здесь остаются только два
   утилитарных класса под инлайн-style, который раньше накручивался поверх .btn (width:100%/
   flex:1) — Button принимает className, но не style-параметры геометрии контейнера. */
.${c.fullWidth} { width: 100%; }
.${c.flexGrow} { flex: 1; }

/* Пусто / ошибка: общая геометрия центрированного блока в теле панели. */
.${c.stateBlock} { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 46px 24px; text-align: center; }
.${c.stateIcon} { flex: none; width: 52px; height: 52px; border-radius: 999px; display: grid; place-items: center; background: var(--dsw-specific-selector); color: var(--dsw-alias-label-tertiary); }
.${c.stateIcon}[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.${c.stateTitle} { margin: 0; font-size: 15px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.${c.stateHint} { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-caption); max-width: 30ch; }
.${c.stateMessage} { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); max-width: 32ch; overflow-wrap: anywhere; }

/* Загрузка: тот же контейнерный ритм и геометрия .group/.groupHeader/.item, залитые токеном
   вместо текста — раскладка совпадает с «список получен» бит-в-бит, скачка нет. */
.${c.skeletonGroup} { flex: none; border-radius: 14px; background: var(--dsw-alias-bg-base); box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.${c.skeletonHead} { height: 13px; width: 40%; }
.${c.skeletonLine} { height: 15px; width: 92%; }
.${c.skeletonLine}:last-child { width: 58%; }
.${c.skeletonBar} { border-radius: 6px; background: var(--dsw-specific-selector); animation: bft-panel-skeleton-pulse 1.4s ease-in-out infinite; }
@keyframes bft-panel-skeleton-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .${c.skeletonBar} { animation: none; }
}

/* Превью требования (Task 2). Заголовок ряда — тот же .header (см. выше), просто с
   иконкой «назад» вместо бейджа. Тело — колонка полей, гео и токены — из утверждённого
   прототипа docs/superpowers/prototypes/2026-09-02-bft-requirements-ui.html (секция «Превью»),
   упрощённая до плоских блоков «подпись — значение» вместо dl/pb-секций прототипа: то же
   визуальное решение по токенам, но кода меньше и переключение между полями предсказуемее. */
.${c.previewScroll} {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.${c.previewTitle} {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}

.${c.previewMeta} {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-caption);
}

.${c.previewField} { display: flex; flex-direction: column; gap: 3px; }
.${c.previewFieldLabel} { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-caption); }
.${c.previewFieldValue} { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.${c.previewFieldValue} p { margin: 0; }

.${c.previewLink} { color: var(--dsw-alias-button-info-fill); text-decoration: none; }
@media (hover: hover) and (pointer: fine) { .${c.previewLink}:hover { text-decoration: underline; } }

.${c.previewList} {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.${c.previewList} li::marker { color: var(--dsw-alias-label-caption); }

.${c.previewFooter} {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}

/* Детальная страница (Task 3, DetailPage.tsx): полноэкранный корень поверх всего приложения,
   не привязан к геометрии .panel (которая держится правого края и своей ширины) — здесь
   fixed-инсет на весь экран, ровно как задано планом. Шапка — тот же .header/.iconButton, что
   у панели и превью (переиспользован без изменений), тело — своя двухколоночная раскладка. */
.${c.detailPage} {
  position: fixed;
  inset: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  /* Слой оверлеев сам по себе pointer-events: none (AppFrame.module.css, .overlayLayer) — как
     и .panel выше, корень записи должен сам вернуть себе кликабельность явно, а не полагаться
     на наследование через анонимные обёртки renderSlot(). */
  pointer-events: auto;
  /* Полноэкранная поверхность — та же приподнятая семантика скроллбара, что у .panel. */
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}

/* Две колонки: слева документ (растёт первым, шире), справа стадия/ссылки/мини-промт
   (фиксированная полоса). flex-wrap — чтобы на узком окне колонки не наезжали друг на друга,
   а составились в стопку (визуал не полируем, но и не ломаем на маленьких экранах). */
.${c.detailBody} {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  padding: 16px;
  overflow: auto;
}

.${c.detailLeft} {
  flex: 3 1 480px;
  min-width: 320px;
  min-height: 320px;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2);
}

.${c.detailRight} {
  flex: 1 1 280px;
  min-width: 260px;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
}

.${c.detailFrame} { flex: 1; width: 100%; height: 100%; border: none; }

.${c.detailTextarea} {
  width: 100%;
  min-height: 96px;
  resize: vertical;
  border-radius: 10px;
  border: none;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-specific-selector);
}
.${c.detailTextarea}::placeholder { color: var(--dsw-alias-label-caption); }
.${c.detailTextarea}:focus { outline: none; box-shadow: 0 0 0 1.5px var(--dsw-alias-border-l3); }

/* Футер списка панели (Task 4): та же геометрия ряда с обводкой сверху, что и .previewFooter —
   отдельный класс, а не переиспользование previewFooter, потому что семантически это футер
   списка (кнопка «Статус проработки»), а не превью требования; правила совпадают намеренно. */
.${c.panelFooter} {
  flex: none;
  display: flex;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}

/* Доска по стадиям (Task 4, Board.tsx): полноэкранный корень — .detailPage выше (Task 3),
   здесь только раскладка тела. Горизонтальный ряд из семи колонок, сам ряд скроллится по
   горизонтали на узком экране (overflow-x) — сложную адаптивность не делаем, это не входит
   в короткий путь до MVP (см. план). */
.${c.boardRow} {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 16px;
  overflow-x: auto;
}

/* Колонка: сама не растягивает страницу по высоте — фиксированная flex-колонка (заголовок
   flex:none сверху, тело flex:1 со своим overflow-y) внутри .boardRow, у которого высота уже
   ограничена родителем (flex:1 в колонке .detailPage). Ширина не резиновая — контейнер длиннее
   экрана скроллится по горизонтали целиком, а не сжимает колонки до нечитаемого минимума. */
.${c.boardColumn} {
  flex: 1 0 220px;
  min-width: 220px;
  max-width: 300px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--dsw-alias-bg-base);
  box-shadow: 0 0 0 0.5px var(--dsw-alias-border-l2);
  overflow: hidden;
}

/* Заголовок колонки прилипает сверху естественно: flex:none над скроллящимся телом
   (flex:1; overflow-y:auto ниже), а не через position:sticky — колонка сама не скроллится
   целиком, скроллится только .boardColumnBody. */
.${c.boardColumnHeader} {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
}

.${c.boardColumnBody} {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

/* Кнопка раздела в подвале сайдбара (sidebar.footer.action, index.tsx: RequirementsButton).
   Значения — дословно с эталона того же слота, соседнего плагина харнесса ui-cordis:
   harness-ui/packages/extensions/ui-cordis/src/client/CordisPanel.module.css (~строки 3-80,
   классы .layer/.footerButtons/.badge/.badgeLabel/.layer.rail/.rail .badge/.rail .footerButtons),
   переименованы под наш префикс bft-nav-*, ничего не досочинено. У badge эталона есть ещё
   .badgeCount (счётчик бегущих плагинов) — у «Требований» нет осмысленного числа для этого места
   (не выдумываем метрику, см. отчёт), поэтому .bft-nav-badge-count здесь не заведён. */
.${c.navLayer} {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  margin: 8px 0 0;
}

.${c.navFooterButtons} {
  display: flex;
  align-items: center;
  width: 100%;
}

.${c.navBadge} {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: calc(100% + 4px);
  height: 42px;
  margin: 0 -2px;
  padding: 0 10px 0 8px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
  overflow: hidden;
}

.${c.navBadge}:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${c.navBadge}[data-active] {
  background: var(--dsw-alias-interactive-bg-hover);
}

.${c.navBadgeLabel} {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.${c.navLayer}.${c.navRail} {
  width: 36px;
  height: 36px;
  margin: 0;
}

.${c.navRail} .${c.navBadge} {
  justify-content: center;
  gap: 0;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 50%;
  corner-shape: round;
}

.${c.navRail} .${c.navFooterButtons} {
  flex-direction: column;
  gap: 2px;
}
`
