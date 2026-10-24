#!/usr/bin/env bash
# E2E HowToDemo-1 портала заказчика (rev4: вход без кода, композер dsh).
#   ./e2e-customer.sh        # из harness/, стек поднят
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.orbstack/bin:$PATH"

# Портал сам подставляет токен: проверка живости + прогон без ссылок.
curl -s -o /dev/null -w "▸ портал: %{http_code}\n" http://127.0.0.1:3080/
cd ../customer-form
npx playwright test "$@"
