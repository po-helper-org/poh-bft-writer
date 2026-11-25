// Бандл кода workflow заранее (при сборке образа): воркеру не нужен webpack при старте.
import { writeFile } from 'node:fs/promises'
import { bundleWorkflowCode } from '@temporalio/worker'

const { code } = await bundleWorkflowCode({ workflowsPath: new URL('../lib/workflows.js', import.meta.url).pathname })
await writeFile(new URL('../lib/workflow-bundle.js', import.meta.url), code)
console.log(`workflow-bundle.js: ${(code.length / 1024).toFixed(0)} КБ`)
