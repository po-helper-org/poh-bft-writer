# orchestration — Deep+Sync (seed → обогащение → синк)

## ruflo-контракт (координация)
- `swarm_init(topology=hierarchical)` — один swarm на прогон; swarmId в память.
- `agent_spawn(agentType per роль, model — модель текущей сессии (точка расширения); дефолт-ориентир: opus для lead/verify, sonnet для worker; фактический per-step выбор — вне итерации, #112)` — cost-tracking + memory на стадию.
- `memory_store/retrieve(namespace="bft-deep/<epic_slug>")` — shared fact-base + хендофф артефактов (актуально только если ruflo доступен).
- `coordination_consensus` — вердикт дебатов + грудинг-споры.
- **Degradation:** ошибка любого ruflo-tool → native-Task исполнение + файловый хендофф `artefacts/` + лог в error-callback. ruflo down ≠ прогон прерван.

## Стадии
0. FORK: pin repo commit hash → всем субагентам. epic_slug = date-slug из темы Summary (независим от JIRA key). Топология запуска — bft-fast/resources/deep_fork.md.
1. swarm_init + seed (Fast-черновик или полный контекст) → memory. Vague вход → шире `[УТОЧНИТЬ]`.

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
11. emit: `.bft/documentation/<epic_slug>/<epic_slug>.md` (путь из `docs_path`, дефолт `.bft/documentation`; резолв — SKILL.md §Резолв конфига) + artefacts/ + нотификация (deep_fork.md §нотификация).
