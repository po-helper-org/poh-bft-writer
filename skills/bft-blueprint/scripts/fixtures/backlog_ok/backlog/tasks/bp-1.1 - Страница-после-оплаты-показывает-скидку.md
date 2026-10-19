---
id: BP-1.1
title: Страница после оплаты показывает скидку
status: To Do
assignee: []
created_date: '2026-10-19 19:14'
labels:
  - 'stage:A'
  - 'layer:technology'
dependencies: []
parent_task_id: BP-1
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Гость покупает билет — витрина сразу показывает блок «скидка 10%».

### Параметры
- **Вход:** Покупка билета
- **Управление:** Один офер (ИТ-1)
- **Выход:** Блок «скидка 10%»; Гость выбрал ресторан (BP-2.1)
- **Механизм:** Витрина

### IDEF0
```mermaid
flowchart LR
  A0["Страница после оплаты показывает скидку"]
  in1["Покупка билета"] --> A0
  ctl1["Один офер (ИТ-1)"] -. управление .-> A0
  mech1["Витрина"] == механизм ==> A0
  A0 --> out1["Блок «скидка 10%»"]
  A0 --> out2["Гость выбрал ресторан"]
  style A0 fill:#fff,stroke:#1c1c1c,stroke-width:2px
```

### HowToDemo
1. Покупаю билет
2. Сразу вижу блок «скидка 10%»
<!-- SECTION:DESCRIPTION:END -->
