import { defineConfig } from '@playwright/test'

// E2E портала заказчика (HowToDemo шаг 1): живой стек, URL с токеном
// прилетает переменной CUSTOMER_URL (см. harness/e2e-customer.sh).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: process.env.CUSTOMER_URL ? undefined : 'http://127.0.0.1:3080' },
  reporter: [['list']],
})
