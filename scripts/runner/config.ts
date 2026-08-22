import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export type RunnerMode = 'dev' | 'start'

/** Binary versions a release runs on. The bootstrap scripts read the same file. */
export type PinnedVersions = {
  bun: string
  bunMinimum: string
  convexBackend: string
  node: string
}

export type RunnerOptions = {
  trustAny: boolean
  exposeUrl?: string
  filterLogs: boolean
  forceBuild: boolean
  install: boolean
  killPorts: boolean
  mode: RunnerMode
  rollback: boolean
  update: boolean
}

export type BrowserOrigins = {
  convexUrl: string
  frontendUrl: string
  siteUrl: string
}

export type RunnerConfig = {
  betterAuthSecret?: string
  binDir: string
  clientRoot: string
  convexBinary: string
  convexDashboardContainer: string
  convexDashboardImage: string
  convexDashboardPort: number
  convexInstanceName: string
  convexDocumentRetentionDelay: string
  convexInterface: string
  convexInternalUrl: string
  convexNodeActionTimeoutSecs: string
  convexPort: number
  convexRoot: string
  convexSelfHostedAdminKey?: string
  convexSelfHostedUrl: string
  convexSitePort: number
  convexSiteUrl: string
  dataDir: string
  envFile: string
  trustAny: boolean
  exposeUrl?: string
  frontendHost: string
  frontendPort: number
  frontendDist: string
  frontendUrl: string
  instanceSecret?: string
  logDir: string
  /** False when the user pointed the runner at their own Convex binary. */
  manageConvexBinary: boolean
  /** False when the user pointed the runner at their own Node binary. */
  manageNodeBinary: boolean
  mode: RunnerMode
  nodeBinary: string
  nodeVersion: string
  projectRoot: string
  releaseTag: string
  rustLog: string
  sidecarRoot: string
  sidecarDataDir: string
  sidecarPort: number
}

export const projectRoot = resolve(import.meta.dir, '../..')
export const dataDir = resolve(projectRoot, process.env.CHAT_DATA_DIR ?? '.data') // prettier-ignore
export const sidecarDataDir = resolve(dataDir, '.sidecar')
export const defaultEnvFile = resolve(projectRoot, '.env.local')

/** Reads the pins from disk. An update swaps the file, so callers that run
 * after one must re-read rather than use {@link versions}. */
export function readVersions(root: string = projectRoot): PinnedVersions {
  return JSON.parse(
    readFileSync(resolve(root, 'versions.json'), 'utf8'),
  ) as PinnedVersions
}

export const versions = readVersions()

export function parseRunnerOptions(args: string[]): RunnerOptions {
  const mode = args.find((arg) => arg === 'dev' || arg === 'start') ?? 'dev'

  return {
    ...parseExpose(args),
    filterLogs: !args.includes('--log-filters=off'),
    forceBuild: args.includes('--rebuild'),
    install: !args.includes('--no-install'),
    killPorts: !args.includes('--no-kill-ports'),
    mode,
    rollback: args.includes('--rollback'),
    update:
      !args.includes('--no-update') && process.env.AUTO_UPDATE !== 'false',
  }
}

function parseExpose(args: string[]) {
  const arg = args.find(
    (value) => value === '--expose' || value.startsWith('--expose='),
  )
  if (!arg) return { trustAny: false }

  const value = arg.slice('--expose='.length)
  if (arg === '--expose' || !value) return { trustAny: true }

  try {
    return { trustAny: false, exposeUrl: new URL(value).origin }
  } catch {
    throw new Error(`--expose value must be a valid URL, got "${value}"`)
  }
}

export function getConfig(mode: RunnerMode): RunnerConfig {
  const frontendPort = numberEnv(
    'FRONTEND_PORT',
    mode === 'start' ? 4173 : 5173,
  )
  const sidecarPort = numberEnv('SIDECAR_PORT', 3212)
  const convexDashboardPort = numberEnv('CONVEX_DASHBOARD_PORT', 6791)
  const convexInstanceName = process.env.CONVEX_INSTANCE_NAME ?? 'chat'
  const convexPort = numberEnv('CONVEX_PORT', 3210)
  const convexSitePort = numberEnv('CONVEX_SITE_PORT', 3211)

  // Where the backend actually listens, used by the CLI and health checks. The
  // public URLs below are what a browser talks to, which differ once a reverse
  // proxy terminates TLS in front of the backend.
  const convexInternalUrl = `http://127.0.0.1:${convexPort}`
  const convexSelfHostedUrl =
    process.env.CONVEX_SELF_HOSTED_URL ?? `http://localhost:${convexPort}`
  const convexSiteUrl =
    process.env.CONVEX_SITE_URL ?? `http://localhost:${convexSitePort}`
  const frontendUrl =
    process.env.FRONTEND_URL ?? `http://localhost:${frontendPort}`
  const binDir = resolve(projectRoot, 'bin')
  const clientRoot = resolve(projectRoot, 'packages/client')
  const convexRoot = projectRoot
  const sidecarRoot = resolve(projectRoot, 'packages/sidecar')

  return {
    betterAuthSecret: process.env.BETTER_AUTH_SECRET,
    binDir,
    clientRoot,
    convexBinary:
      process.env.CONVEX_BINARY ?? join(binDir, executableName('convex')),
    convexDashboardContainer:
      process.env.CONVEX_DASHBOARD_CONTAINER ??
      `convex-dashboard-${convexInstanceName}`,
    convexDashboardImage:
      process.env.CONVEX_DASHBOARD_IMAGE ??
      'ghcr.io/get-convex/convex-dashboard:latest',
    convexDashboardPort,
    convexInstanceName,
    convexDocumentRetentionDelay:
      process.env.DOCUMENT_RETENTION_DELAY ?? String(60 * 60 * 24 * 2),
    convexInterface: process.env.CONVEX_INTERFACE ?? '0.0.0.0',
    convexInternalUrl,
    // This must stay above the stream engine's time window (see STREAM_WINDOW_MS)
    convexNodeActionTimeoutSecs:
      process.env.NODE_ACTION_USER_TIMEOUT_SECS ?? String(30 * 60),
    convexPort,
    convexRoot,
    convexSelfHostedAdminKey: process.env.CONVEX_SELF_HOSTED_ADMIN_KEY,
    convexSelfHostedUrl,
    convexSitePort,
    convexSiteUrl,
    dataDir,
    envFile: defaultEnvFile,
    trustAny: false,
    frontendHost: process.env.FRONTEND_HOST ?? '0.0.0.0',
    frontendPort,
    frontendDist: resolve(clientRoot, 'dist'),
    frontendUrl,
    instanceSecret: process.env.INSTANCE_SECRET,
    logDir: resolve(dataDir, 'logs'),
    manageConvexBinary: !process.env.CONVEX_BINARY,
    manageNodeBinary: !process.env.NODE_BINARY,
    mode,
    nodeBinary: process.env.NODE_BINARY ?? defaultNodeBinary(binDir),
    nodeVersion: process.env.RUNNER_NODE_VERSION ?? versions.node,
    projectRoot,
    releaseTag: process.env.RELEASE_TAG ?? versions.convexBackend,
    rustLog:
      process.env.RUST_LOG ??
      (mode === 'start'
        ? 'warn,local_backend=error,model::components::config=error'
        : 'info,keybroker::broker=warn'),
    sidecarRoot,
    sidecarDataDir,
    sidecarPort,
  }
}

export function browserOrigins(config: RunnerConfig): BrowserOrigins {
  const local = config.mode === 'dev'

  // Dev mode is kept local
  return {
    convexUrl: local
      ? `http://localhost:${config.convexPort}`
      : config.convexSelfHostedUrl,
    frontendUrl:
      config.exposeUrl ??
      (local ? `http://localhost:${config.frontendPort}` : config.frontendUrl),
    siteUrl: local
      ? `http://localhost:${config.convexSitePort}`
      : config.convexSiteUrl,
  }
}

export function executableName(name: string) {
  return process.platform === 'win32' ? `${name}.exe` : name
}

export function defaultNodeBinary(binDir: string) {
  return process.platform === 'win32'
    ? join(binDir, 'node', 'node.exe')
    : join(binDir, 'node', 'bin', 'node')
}

function numberEnv(name: string, fallback: number) {
  const raw = process.env[name]
  if (!raw) return fallback

  const value = Number(raw)
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number, got "${raw}"`)
  }
  return value
}
