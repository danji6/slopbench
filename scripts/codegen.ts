import { join } from 'node:path'

import { ensureConvexBinaries } from './runner/binaries'
import { type RunnerConfig, getConfig } from './runner/config'
import { prepareEnvironment, startBackend } from './runner/convex'
import { loadEnvFile } from './runner/env-file'
import { waitForHttp } from './runner/main'
import { ProcessManager, bunx } from './runner/processes'

/**
 * Writes Convex's `_generated` folder without starting the whole app.
 * Safe to run while the app is up.
 */
async function main() {
  const config = getConfig('start')
  await loadEnvFile(config.envFile)

  const manager = new ProcessManager({
    cwd: config.projectRoot,
    env: process.env,
    filterLogs: false,
    logDir: config.logDir,
    mode: 'start',
  })

  await ensureConvexBinaries(config)
  await prepareEnvironment(config)

  if (await backendIsRunning(config)) {
    console.log('Using the running Convex backend.')
    await codegen(manager, config)
    return
  }

  const backend = await startBackend(manager, config)
  try {
    await waitForHttp(`${config.convexInternalUrl}/version`, 60_000, true)
    await codegen(manager, config)
  } finally {
    backend.kill()
    await backend.exited
  }
}

function codegen(manager: ProcessManager, config: RunnerConfig) {
  return manager.run(
    'convex-codegen',
    bunx(
      'convex',
      'codegen',
      '--url',
      config.convexInternalUrl,
      '--admin-key',
      config.convexSelfHostedAdminKey ?? '',
      '--typecheck',
      'disable',
    ),
    // Convex writes through a temporary directory and warns when it lands on
    // another filesystem than the project
    { cwd: config.convexRoot, env: { CONVEX_TMPDIR: join(config.dataDir, 'tmp') } }, // prettier-ignore
  )
}

async function backendIsRunning(config: RunnerConfig) {
  try {
    const response = await fetch(`${config.convexInternalUrl}/version`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

await main()
