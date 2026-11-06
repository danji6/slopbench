import { resolve } from 'node:path'

import { sidecarBuildEntry } from '../sidecar'
import type { RunnerConfig } from './config'
import { type ProcessManager, bun } from './processes'

export async function startSidecar(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  // A fresh Bun process avoids stale module resolution after dependency installs.
  await manager.run(
    'sidecar-build',
    bun(resolve(config.projectRoot, 'scripts/sidecar.ts'), '--build-only'),
    { cwd: config.projectRoot, env: { CHAT_DATA_DIR: config.dataDir } },
  )

  const entry = sidecarBuildEntry(config.dataDir)
  const sidecar = await manager.spawn('sidecar', [config.nodeBinary, entry], {
    env: {
      CHAT_SIDECAR_DATA_DIR: config.sidecarDataDir,
      SIDECAR_SECRET: config.sidecarSecret,
      MCP_PORT: String(config.sidecarPort),
    },
  })
  console.log(`Started sidecar server (pid ${sidecar.pid})`)
  return sidecar
}
