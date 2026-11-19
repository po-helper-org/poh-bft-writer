import { defineConfig } from '@playwright/test'

// Живой E2E /bft (настоящая модель, память bft-creator, Jira/Confluence) —
// отдельно от e2e/ с моделью-двойником. Запуск — harness/e2e-bft-live.sh.
export default defineConfig({
  testDir: '.',
  timeout: 45 * 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results/live-artifacts',
})
