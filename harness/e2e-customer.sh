#!/usr/bin/env bash
# E2E HowToDemo-1 портала заказчика (ADR-0007): свежая ссылка + прогон.
#   ./e2e-customer.sh        # из harness/, стек поднят
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.orbstack/bin:$PATH"

URL="$(docker compose logs customer-web 2>/dev/null \
  | grep -oE 'https?://[^ "?]+\?token=[A-Za-z0-9._%-]+' | tail -1 \
  | sed -E 's|https?://[^/]+|http://127.0.0.1:3080|')"
[ -n "$URL" ] || { echo "✗ customer-web не поднялся (ссылки в логах нет)"; exit 1; }
echo "▸ портал: $URL"

set -a; . ./.env; set +a
cd ../customer-form
CUSTOMER_URL="$URL" TRACKER_URL="http://127.0.0.1:3456/api/v1" \
TRACKER_USER="${TRACKER_ADMIN_USER:-bft-admin}" TRACKER_PASSWORD="$TRACKER_ADMIN_PASSWORD" \
  npx playwright test "$@"
