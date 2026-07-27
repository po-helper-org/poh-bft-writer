# orchestration — Deep+Sync (seed → обогащение → синк)

## ruflo-контракт (координация)
- `swarm_init(topology=hierarchical)` — один swarm на прогон; swarmId в память.
- `agent_spawn(agentType per роль, model — модель текущей сессии (точка расширения); дефолт-ориентир: opus для lead/verify, sonnet для worker; фактический per-step выбор — вне итерации, #112)` — cost-tracking + memory на стадию.
- `memory_store/retrieve(namespace="bft-deep/<epic_slug>")` — shared fact-base + хендофф артефактов (актуально только если ruflo доступен).
- `coordination_consensus` — вердикт дебатов + грудинг-споры.
- **Degradation:** ошибка любого ruflo-tool → native-Task исполнение + файловый хендофф `artefacts/` + лог в error-callback. ruflo down ≠ прогон прерван.

## Стадии
0. init: `pin_commit` для этого прогона — документ уже несёт `pin_commit` во frontmatter (читает стадия 1) → использовать его; не задан → pin хэш текущего прогона репозитория `poh-bft-writer`. epic_slug — из frontmatter/пути читаемого документа; деградация без документа → date-slug из темы Summary (независим от JIRA key). Запуск `/bft-deep` — ручной, не авто-форк из bft-fast.
1. seed: прочитать **документ БФТ**. Приоритет источника: локальный `<docs_path>/<epic_slug>/<epic_slug>.md`; нет локально, есть страница → `confluence_get_page` по `pageId`; нет ни того, ни другого → деградация: собрать шапку по `../../bft-fast/resources/document_assembly.md` из Summary/письма, затем продолжить. Найти границу шапки по порядку якорей (`document_assembly.md` §Порядок якорей). Зафиксировать замороженную область (от `## Шапка (сутевое описание запроса)` до границы включительно) — она не меняется до конца прогона. Vague вход → шире `[УТОЧНИТЬ]`.

### DEEP (обогащение seed)
2. context: `/bft-index` (само-генерируемый индекс воркспейса `.bft/index/`; если устарел или неполон по теме — перезапустить `/bft-index` перед этой стадией) + JIRA/Confluence (опц., если сконфигурированы). Per-source fallback: источник со статусом `UNAVAILABLE` в `MANIFEST.md` → claim оттуда → `[УТОЧНИТЬ]`, никогда «пусто=нет данных». Memory-audit гейтит фактбазу.
3. value: ось 1 (enrichment.md §Ценность) — inline, без внешней команды.
4. what-if: ось 2 (enrichment.md §What-if).
5. bounds: ось 3 (enrichment.md §Границы).

### SYNC (укладка в канон)
6. draft: /bft-draft — обогащённый seed → канон-структура MTS.
7. verify: grounding_verifier.md §типизация.
8. validate: /bft-validate — hard-gates + Светофор. Convergence-stop (grounding_verifier.md §convergence).
9. citation: grounding_verifier.md §forced-citation.
10. review: свежий агент, весь документ против канон-ориентира.
11. emit: собрать документ = замороженная шапка (байт-в-байт) + канон MTS вместо плейсхолдера `## ⏳ Полный БФТ — в проработке`. Обновить frontmatter (`stage: deep`, `version`+1, `synced`, `status`) и строку-статус под H1. Сохранить `<docs_path>/<epic_slug>/<epic_slug>.md` + `artefacts/`. Опубликовать: сухой прогон превью → STOP → «ок» PO → `confluence_update_page` по `pageId` из frontmatter (не создавать новую страницу). `pageId: pending` → предложить публикацию как новую страницу тем же сухим прогоном. MCP недоступен → `[УТОЧНИТЬ: MCP недоступен]`, локальный файл сохранён. Нотификация — успех/провал, никогда молча.
