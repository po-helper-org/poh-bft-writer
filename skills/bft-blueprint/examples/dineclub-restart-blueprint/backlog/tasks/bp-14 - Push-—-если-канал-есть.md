---
id: BP-14
title: Push — если канал есть
status: To Do
assignee:
  - '@ext'
created_date: '2026-10-19 19:07'
labels:
  - 'stage:E'
  - используем
dependencies: []
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Ещё один канал напоминания, если приложения его поддерживают

Требования БФТ: ФТ-17

### ASIS
[УТОЧНИТЬ у владельцев приложений] — поддерживают ли приложения Acme Tickets и Acme Cloud push.

### GAP
Push-канал для напоминаний о скидке не используется.

### TOBE
Если приложения поддерживают push, гость получает push о скидке до и после мероприятия.

### HowToDemo
1. Устанавливаю приложение Acme Tickets с включёнными уведомлениями
2. До мероприятия приходит push о скидке
3. После мероприятия — push в окне скидки
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Решение о push принято владельцами приложений
- [ ] #2 Push приходит до и после мероприятия, если канал есть
<!-- AC:END -->
