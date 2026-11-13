---
nexus: landscape
node_id: sys-checkout
node_type: system-component
kind: empirical
owner: Ирина Смирнова
cp: 5
change_rate: high
sources: ["demo:architecture"]
updated: 2026-10-10
title: Корзина и оплата (checkout) (демо)
where_to_check: ["стенд stage: корзина и оплата тестовой картой", "журнал транзакций эквайринга на stage"]
environments: ["stage", "prod"]
---

# Корзина и оплата (демо-память)

Сервис корзины и оплаты: позиции заказа, сервисный сбор, одна транзакция через
эквайринг. Проверяется на стенде stage тестовыми картами.
