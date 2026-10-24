# Продуктовая документация системы БФТ (Zensical — генератор от команды MkDocs)

## Быстрый просмотр

```bash
cd product-docs
source .venv/bin/activate   # или: uv venv && uv pip install zensical
zensical serve              # http://127.0.0.1:8000
```

## Сборка в статику

```bash
zensical build              # → site/
```

## Как добавлять страницы

1. Создайте `docs/<раздел>/<страница>.md` (образец —
   `docs/customers/add-initiative.md`).
2. Впишите страницу в `nav` в `mkdocs.yml`.
3. Callout-блоки (синтаксис Material/zen): `!!! note "Заголовок"`, `!!! tip`, `!!! success`,
   сворачиваемые — `??? note "Заголовок"`.

Разделы «Для PO / сотрудников / администрирование» — заготовки с планом
содержания: наполняются командой по мере готовности.
