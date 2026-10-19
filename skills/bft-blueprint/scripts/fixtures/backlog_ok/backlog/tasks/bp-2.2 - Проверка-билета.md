---
id: BP-2.2
title: Проверка билета
status: To Do
assignee: []
created_date: '2026-10-19 19:14'
labels:
  - 'stage:B'
  - 'layer:backstage'
dependencies: []
parent_task_id: BP-2
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Билеты проверяют штрихкод и отвечают скидкой или отказом.

### Параметры
- **Вход:** Штрихкод на проверку (BP-2.1)
- **Управление:** Скидка по билету (ПТ-1)
- **Выход:** Ответ проверки (BP-2.1)
- **Механизм:** Билеты

### IDEF0
```mermaid
flowchart LR
  A0["Проверка билета"]
  in1["Штрихкод на проверку"] --> A0
  ctl1["Скидка по билету (ПТ-1)"] -. управление .-> A0
  mech1["Билеты"] == механизм ==> A0
  A0 --> out1["Ответ проверки"]
  style A0 fill:#fff,stroke:#1c1c1c,stroke-width:2px
```

### HowToDemo
1. Сканирую действующий билет — скидка
2. Сканирую чужой билет — отказ
<!-- SECTION:DESCRIPTION:END -->
