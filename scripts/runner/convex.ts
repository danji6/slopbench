import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import { type RunnerConfig, browserOrigins } from './config'
import { loadEnvFile, readEnvFile, updateEnvFile } from './env-file'
import { type ProcessManager, output } from './processes'

// The backend gets these from --convex-origin and --convex-site
const builtInEnvVars = new Set(['CONVEX_CLOUD_URL', 'CONVEX_SITE_URL'])

export async function prepareEnvironment(config: RunnerConfig) {
  await loadEnvFile(config.envFile)

  const instanceSecret =
    process.env.INSTANCE_SECRET ?? randomBytes(32).toString('hex')
  if (!process.env.INSTANCE_SECRET) {
    console.log('Generated new instance secret.')
  }

  const adminKey = await deriveAdminKey(config, instanceSecret)
  const betterAuthSecret =
    process.env.BETTER_AUTH_SECRET ?? randomBytes(32).toString('hex')

  config.instanceSecret = instanceSecret
  config.convexSelfHostedAdminKey = adminKey
  config.betterAuthSecret = betterAuthSecret

  const origins = browserOrigins(config)
  await updateEnvFile(
    config.envFile,
    {
      BETTER_AUTH_SECRET: betterAuthSecret,
      CONVEX_SELF_HOSTED_ADMIN_KEY: adminKey,
      INSTANCE_SECRET: instanceSecret,
      VITE_CONVEX_SITE_URL: origins.siteUrl,
      VITE_CONVEX_URL: origins.convexUrl,
    },
    ['CONVEX_DEPLOYMENT'],
  )
}

export async function deriveAdminKey(
  config: RunnerConfig,
  instanceSecret: string,
) {
  return output(
    [
      config.convexBinary,
      'keygen',
      'admin-key',
      '--instance-name',
      config.convexInstanceName,
      '--instance-secret',
      instanceSecret,
    ],
    { cwd: config.projectRoot },
  )
}

export async function startBackend(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  if (!config.instanceSecret) {
    throw new Error('INSTANCE_SECRET was not prepared')
  }

  await mkdir(join(config.dataDir, 'storage'), { recursive: true })
  const origins = browserOrigins(config)
  return manager.spawn(
    'convex-backend',
    [
      config.convexBinary,
      '--instance-name',
      config.convexInstanceName,
      '--instance-secret',
      config.instanceSecret,
      '--interface',
      config.convexInterface,
      '--port',
      String(config.convexPort),
      '--site-proxy-port',
      String(config.convexSitePort),
      // Origins for generated links (file storage) and the JWT issuer to point
      // at. Necessary when using a proxy.
      '--convex-origin',
      origins.convexUrl,
      '--convex-site',
      origins.siteUrl,
      '--local-storage',
      join(config.dataDir, 'storage'),
      join(config.dataDir, 'convex.sqlite3'),
    ],
    {
      env: { DOCUMENT_RETENTION_DELAY: config.convexDocumentRetentionDelay },
    },
  )
}

export async function setConvexEnvironment(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  if (!config.convexSelfHostedAdminKey || !config.betterAuthSecret) {
    throw new Error('Convex credentials were not prepared')
  }

  const origins = browserOrigins(config)
  const env = await readEnvFile(config.envFile)
  for (const key of Object.keys(env)) {
    if (builtInEnvVars.has(key)) continue
    await convexEnv(manager, config, key, process.env[key] ?? env[key])
  }

  await convexEnv(
    manager,
    config,
    'BETTER_AUTH_SECRET',
    config.betterAuthSecret,
  )
  await convexEnv(manager, config, 'SITE_URL', origins.siteUrl)
  await convexEnv(manager, config, 'FRONTEND_URL', origins.frontendUrl)
  await convexEnv(
    manager,
    config,
    'TRUST_ALL_ORIGINS',
    config.trustAny ? 'true' : 'false',
  )
  await convexEnv(
    manager,
    config,
    'SIDECAR_URL',
    `http://localhost:${config.sidecarPort}`,
  )
}

export async function deployConvex(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  await manager.run(
    'convex-deploy',
    [
      'bunx',
      'convex',
      'deploy',
      '--url',
      config.convexInternalUrl,
      '--admin-key',
      config.convexSelfHostedAdminKey ?? '',
      '--typecheck',
      'disable',
    ],
    { cwd: config.convexRoot },
  )
}

export async function startConvexDev(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  const convexDev = await manager.spawn(
    'convex-dev',
    [
      'bunx',
      'convex',
      'dev',
      '--url',
      config.convexInternalUrl,
      '--admin-key',
      config.convexSelfHostedAdminKey ?? '',
    ],
    { cwd: config.convexRoot },
  )
  await convexDev.waitForLine('functions ready', 120_000)
  return convexDev
}

async function convexEnv(
  manager: ProcessManager,
  config: RunnerConfig,
  key: string,
  value: string,
) {
  await manager.run(
    'convex-env',
    [
      'bunx',
      'convex',
      'env',
      'set',
      '--url',
      config.convexInternalUrl,
      '--admin-key',
      config.convexSelfHostedAdminKey ?? '',
      key,
      value,
    ],
    { cwd: config.convexRoot },
  )
}
