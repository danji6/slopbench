import { ensureConvexBinaries } from './binaries'
import { buildFrontendIfNeeded } from './build-cache'
import {
  type RunnerConfig,
  defaultEnvFile,
  getConfig,
  parseRunnerOptions,
} from './config'
import {
  deployConvex,
  prepareEnvironment,
  setConvexEnvironment,
  startBackend,
  startConvexDev,
} from './convex'
import { loadEnvFile } from './env-file'
import { freePorts } from './ports'
import { type ManagedProcess, ProcessManager, commandExists } from './processes'
import { buildSidecar } from '../sidecar'

export async function run(args: string[]) {
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    return
  }

  await loadEnvFile(defaultEnvFile)

  const options = parseRunnerOptions(args)
  const config = getConfig(options.mode)
  config.trustAny = options.trustAny
  config.exposeUrl = options.exposeUrl
  process.env.RUST_LOG = config.rustLog

  if (config.trustAny || config.exposeUrl) {
    console.log(
      config.trustAny
        ? 'Exposing auth to ANY origin (insecure).'
        : `Exposing auth to external origin: ${config.exposeUrl}`,
    )
    console.log(
      `Ensure these ports are reachable from the visitor (firewall/NAT): ` +
        `${config.frontendPort} (frontend), 3210 (convex), 3211 (http actions).`,
    )
  }

  const manager = new ProcessManager({
    cwd: config.projectRoot,
    env: process.env,
    filterLogs: options.mode === 'start' && options.filterLogs,
    logDir: config.logDir,
    mode: options.mode,
  })

  const shutdown = async () => {
    console.log('')
    console.log('Stopping...')
    await cleanupDocker(config)
    await manager.stopAll()
  }

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(130))
  })
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(143))
  })

  try {
    await ensureConvexBinaries(config)
    await prepareEnvironment(config)

    if (options.mode === 'start') {
      await start(config, manager, {
        forceBuild: options.forceBuild,
        killPorts: options.killPorts,
      })
    } else {
      await dev(config, manager, options.killPorts)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    await shutdown()
    process.exit(1)
  }
}

async function start(
  config: RunnerConfig,
  manager: ProcessManager,
  options: { forceBuild: boolean; killPorts: boolean },
) {
  await freePorts([3210, 3211, config.sidecarPort, config.frontendPort], {
    cwd: config.projectRoot,
    enabled: options.killPorts,
  })

  const sidecar = await startSidecar(manager, config)
  await waitForHttp(`http://localhost:${config.sidecarPort}/mcp`, 30_000, false)
  console.log('Sidecar server ready.')

  const backend = await startBackend(manager, config)
  console.log(`Started Convex backend (pid ${backend.pid})`)
  await waitForHttp('http://localhost:3210/version', 30_000, true)
  console.log('Backend ready.')

  await setConvexEnvironment(manager, config, 'start')
  await deployConvex(manager, config)
  await buildFrontendIfNeeded(manager, config, { force: options.forceBuild })

  const preview = await manager.spawn('vite-preview', [
    'bun',
    'run',
    'preview',
    '--',
    '--host',
    config.frontendHost,
    '--port',
    String(config.frontendPort),
  ], { cwd: config.clientRoot })
  await manager.waitForAnyExit([sidecar, backend, preview])
}

async function dev(
  config: RunnerConfig,
  manager: ProcessManager,
  killPorts: boolean,
) {
  await freePorts(
    [3210, 3211, config.convexDashboardPort, config.sidecarPort],
    {
      cwd: config.projectRoot,
      enabled: killPorts,
    },
  )
  await cleanupDocker(config)

  const sidecar = await startSidecar(manager, config)
  await waitForHttp(`http://localhost:${config.sidecarPort}/mcp`, 60_000, false)
  console.log('Sidecar server ready.')

  const backend = await startBackend(manager, config)
  console.log(`Started Convex backend (pid ${backend.pid})`)
  await waitForHttp('http://localhost:3210/version', 60_000, true)
  console.log('Backend ready.')

  const dashboard = await startDashboard(manager, config)
  await setConvexEnvironment(manager, config, 'dev')

  const convexDev = await startConvexDev(manager, config)
  const vite = await manager.spawn('vite-dev', ['bun', 'run', 'dev'], {
    cwd: config.clientRoot,
  })
  await manager.waitForAnyExit(
    [sidecar, backend, convexDev, vite, dashboard].filter(isManagedProcess),
  )
}

async function startSidecar(manager: ProcessManager, config: RunnerConfig) {
  const entry = await buildSidecar()
  const sidecar = await manager.spawn('sidecar', [config.nodeBinary, entry], {
    env: { CHAT_SIDECAR_DATA_DIR: config.sidecarDataDir },
  })
  console.log(`Started sidecar server (pid ${sidecar.pid})`)
  return sidecar
}

async function startDashboard(manager: ProcessManager, config: RunnerConfig) {
  if (!(await commandExists('docker', config.projectRoot))) {
    console.error('Docker is not available; skipping Convex dashboard.')
    return undefined
  }

  const dashboard = await manager.spawn('convex-dashboard', [
    'docker',
    'run',
    '--rm',
    '--name',
    config.convexDashboardContainer,
    '-p',
    `127.0.0.1:${config.convexDashboardPort}:6791`,
    '-e',
    `NEXT_PUBLIC_DEPLOYMENT_URL=${config.convexSelfHostedUrl}`,
    config.convexDashboardImage,
  ])
  console.log(`Started Convex dashboard (pid ${dashboard.pid})`)

  try {
    await waitForHttp(
      `http://localhost:${config.convexDashboardPort}`,
      60_000,
      true,
    )
    console.log(
      `Convex dashboard ready at http://localhost:${config.convexDashboardPort}.`,
    )
  } catch {
    console.error(
      'Convex dashboard did not start in time; continuing without it.',
    )
  }
  return dashboard
}

async function cleanupDocker(config: RunnerConfig) {
  if (!(await commandExists('docker', config.projectRoot))) return

  const process = Bun.spawn({
    cmd: ['docker', 'rm', '-f', config.convexDashboardContainer],
    cwd: config.projectRoot,
    stderr: 'ignore',
    stdout: 'ignore',
  })
  await process.exited
}

async function waitForHttp(url: string, timeoutMs: number, requireOk: boolean) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (!requireOk || response.ok) return
    } catch {
      // Retry until timeout.
    }
    await sleep(1000)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isManagedProcess(
  process: ManagedProcess | undefined,
): process is ManagedProcess {
  return process !== undefined
}

function printHelp() {
  console.log(`Usage: bun scripts/runner.ts [dev|start] [options]

Modes:
  dev      Start local Convex, dashboard, sidecar, convex dev, and Vite.
  start    Deploy once, build, and run the production preview server.

Options:
  --rebuild           Force a frontend production build in start mode.
  --expose[=<origin>] Trust an external frontend origin for auth so a remote
                      browser can sign in. With a value, e.g.
                      --expose=http://203.0.113.5:5173, only that origin is
                      trusted. No value trusts any origin (insecure).
  --log-filters=off   Show all child-process log lines in start mode.
  --no-kill-ports     Do not stop existing processes on required ports.
  -h, --help          Show this help.

Raw child-process logs are written to .data/logs.`)
}
