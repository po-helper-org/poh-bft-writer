#!/usr/bin/env bash
# Разовый шаг владельца (нужен sudo): /bft/ на browser.harness.aleksishmanov.ru —
# портал заказчика БФТ вместо виджета «Управление требованиями» (ADR-0014).
#   bash ~/Projects/poh-bft-portal/harness/deploy/install-nginx-bft.sh
# Идемпотентно. include виджета в vhost комментируется (сам виджет и его сниппет
# не удаляются — откат: --rollback). nginx перезагружается только после успешного
# `nginx -t`, иначе vhost и сниппет восстанавливаются.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
NAME=browser.harness.aleksishmanov.ru
VHOST=/etc/nginx/sites-available/$NAME.conf
SNIP=/etc/nginx/snippets/poh-bft-portal.conf
WIDGET_INCLUDE='include /etc/nginx/snippets/poh-widget-bft.conf;'
PORTAL_INCLUDE='include /etc/nginx/snippets/poh-bft-portal.conf;'

[ "$(id -un)" = aleks ] || { echo "Запускать под aleks (sudo спросит пароль сам)"; exit 1; }

BAK="$VHOST.bak-bft-portal-$(date +%Y%m%d%H%M%S)"
sudo cp -a "$VHOST" "$BAK"
OLD_SNIP=""
if sudo test -f "$SNIP"; then OLD_SNIP=$(mktemp); sudo cp "$SNIP" "$OLD_SNIP"; fi

restore() {
  sudo cp -a "$BAK" "$VHOST"
  if [ -n "$OLD_SNIP" ]; then sudo cp "$OLD_SNIP" "$SNIP"; else sudo rm -f "$SNIP"; fi
}

if [ "${1:-}" = --rollback ]; then
  # Назад к виджету: include портала → комментарий, include виджета — обратно.
  sudo sed -i -E "s|^([[:space:]]*)${PORTAL_INCLUDE//./\\.}|\1# ${PORTAL_INCLUDE} # poh-bft-portal: откат|" "$VHOST"
  sudo sed -i -E "s|^([[:space:]]*)# ${WIDGET_INCLUDE//./\\.}.*$|\1${WIDGET_INCLUDE}|" "$VHOST"
else
  sudo install -m 644 "$DIR/bft-portal.nginx.conf" "$SNIP"
  # Виджет занимал /bft/ — его include комментируем (дубль location не пройдёт nginx -t).
  sudo sed -i -E "s|^([[:space:]]*)${WIDGET_INCLUDE//./\\.}.*$|\1# ${WIDGET_INCLUDE} # poh-bft-portal: /bft/ отдан порталу|" "$VHOST"
  if ! sudo grep -qE "^[[:space:]]*${PORTAL_INCLUDE//./\\.}" "$VHOST"; then
    sudo sed -i "/set \$corp_frame_ancestors/a\\    ${PORTAL_INCLUDE}" "$VHOST"
    sudo grep -q 'snippets/poh-bft-portal.conf' "$VHOST" || { echo "Не нашёл строку set \$corp_frame_ancestors"; restore; exit 1; }
  fi
fi

if OUT=$(sudo nginx -t 2>&1); then
  sudo systemctl reload nginx
  [ -n "$OLD_SNIP" ] && rm -f "$OLD_SNIP"
  echo "ok: nginx перезагружен (копия vhost: $BAK)"
else
  echo "$OUT"
  restore
  echo "nginx -t не прошёл — vhost и сниппет восстановлены, nginx не перезагружался"; exit 1
fi

HOST=https://$NAME
sleep 1
printf "снаружи  %s/bft       -> %s (ждём 301)\n" "$HOST" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$HOST/bft")"
printf "снаружи  %s/bft/      -> %s (ждём 302 на вход Authentik)\n" "$HOST" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' "$HOST/bft/")"
printf "внутри   127.0.0.1:3082 -> %s (ждём 200 — портал жив)\n" "$(curl -s -m 15 -o /dev/null -w '%{http_code}' http://127.0.0.1:3082/)"
