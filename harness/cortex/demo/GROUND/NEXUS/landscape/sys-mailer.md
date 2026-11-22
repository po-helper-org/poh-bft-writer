---
nexus: landscape
node_id: sys-mailer
node_type: system-component
kind: empirical
owner: Ирина Смирнова
cp: 3
change_rate: medium
sources: ["demo:architecture"]
updated: 2026-08-28
title: Письма покупателям (билеты, документы) (демо)
where_to_check: ["почтовый перехватчик стенда stage — письма тестовых заказов"]
environments: ["stage", "prod"]
---

# Письма покупателям (демо-память)

После оплаты покупатель получает письмо с билетами; вложения к заказу
(документы, полисы) уходят этим же сервисом.
