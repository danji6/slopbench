import { buildSidecar } from '../sidecar'
import { ensureConvexBinaries } from './binaries'
import { buildFrontendIfNeeded } from './build-cache'
import {
  type RunnerConfig,
  browserOrigins,
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
import { ProcessManager, output } from './processes'

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
        `${config.frontendPort} (frontend), ${config.convexPort} (convex), ` +
        `${config.convexSitePort} (http actions).`,
    )
    console.log(
      'Traffic is unencrypted unless using a TLS proxy. See docs/https.md.',
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
  await freePorts(
    [
      config.convexPort,
      config.convexSitePort,
      config.sidecarPort,
      config.frontendPort,
    ],
    {
      cwd: config.projectRoot,
      enabled: options.killPorts,
    },
  )

  const sidecar = await startSidecar(manager, config)
  await waitForHttp(`http://localhost:${config.sidecarPort}/mcp`, 30_000, false)
  console.log('Sidecar server ready.')

  const backend = await startBackend(manager, config)
  console.log(`Started Convex backend (pid ${backend.pid})`)
  await waitForHttp(`${config.convexInternalUrl}/version`, 30_000, true)
  console.log('Backend ready.')

  await setConvexEnvironment(manager, config)
  await deployConvex(manager, config)
  await buildFrontendIfNeeded(manager, config, { force: options.forceBuild })

  const preview = await manager.spawn(
    'vite-preview',
    ['bun', 'run', 'preview', ...frontendArgs(config)],
    { cwd: config.clientRoot },
  )
  await manager.waitForAnyExit([sidecar, backend, preview])
}

async function dev(
  config: RunnerConfig,
  manager: ProcessManager,
  killPorts: boolean,
) {
  await freePorts(
    [
      config.convexPort,
      config.convexSitePort,
      config.convexDashboardPort,
      config.sidecarPort,
      config.frontendPort,
    ],
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
  await waitForHttp(`${config.convexInternalUrl}/version`, 60_000, true)
  console.log('Backend ready.')

  await startDashboard(manager, config)
  await setConvexEnvironment(manager, config)

  const convexDev = await startConvexDev(manager, config)
  const vite = await manager.spawn(
    'vite-dev',
    ['bun', 'run', 'dev', ...frontendArgs(config)],
    { cwd: config.clientRoot },
  )

  await manager.waitForAnyExit([sidecar, backend, convexDev, vite])
}

function frontendArgs(config: RunnerConfig) {
  return [
    '--',
    '--host',
    config.frontendHost,
    '--port',
    String(config.frontendPort),
    '--strictPort',
  ]
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
  if (!(await dockerAvailable(config.projectRoot))) {
    console.error('Docker is not running, skipping Convex dashboard.')
    return
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
    `NEXT_PUBLIC_DEPLOYMENT_URL=${browserOrigins(config).convexUrl}`,
    config.convexDashboardImage,
  ])
  console.log(`Started Convex dashboard (pid ${dashboard.pid})`)

  try {
    await Promise.race([
      waitForHttp(
        `http://localhost:${config.convexDashboardPort}`,
        60_000,
        true,
      ),
      dashboard.exited.then((code) => {
        throw new Error(`docker run exited with code ${code}`)
      }),
    ])
    console.log(
      `Convex dashboard ready at http://localhost:${config.convexDashboardPort}.`,
    )
  } catch {
    console.error('Convex dashboard unavailable; continuing without it.')
  }
}

let dockerProbe: Promise<boolean> | undefined

function dockerAvailable(cwd: string) {
  dockerProbe ??= output(['docker', 'info', '--format', '{{.ServerVersion}}'], {
    cwd,
  }).then(
    () => true,
    () => false,
  )
  return dockerProbe
}

async function cleanupDocker(config: RunnerConfig) {
  if (!(await dockerAvailable(config.projectRoot))) return

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

Reverse proxy / HTTPS (see docs/https.md), set in .env.local:
  FRONTEND_URL            Public frontend origin, e.g. https://chat.example.com
  CONVEX_SELF_HOSTED_URL  Public backend origin, e.g. https://convex.example.com
  CONVEX_SITE_URL         Public HTTP actions origin
  CONVEX_INTERFACE        Backend bind address (set 127.0.0.1 behind a proxy)
  CONVEX_PORT             Backend port (default 3210)
  CONVEX_SITE_PORT        HTTP actions port (default 3211)
  FRONTEND_HOST           Frontend bind address (default 0.0.0.0)

Logs are written to .data/logs.`)
}
