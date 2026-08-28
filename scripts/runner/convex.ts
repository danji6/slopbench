import { SCHEMA_MIGRATION_VERSION, type SchemaMigrationState } from '@sb/core/migration-version'
import { randomBytes } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { type RunnerConfig, browserOrigins } from './config'
import { loadEnvFile, readEnvFile, updateEnvFile } from './env-file'
import { type ProcessManager, bunx, commandResult, green, output } from './processes'

// The backend gets the Convex URLs from flags
const runnerOwnedEnvVars = new Set(['CONVEX_CLOUD_URL', 'CONVEX_SITE_URL'])

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
      env: {
        DOCUMENT_RETENTION_DELAY: config.convexDocumentRetentionDelay,
        NODE_ACTION_USER_TIMEOUT_SECS: config.convexNodeActionTimeoutSecs,
      },
    },
  )
}

export async function setConvexEnvironment(config: RunnerConfig) {
  if (!config.betterAuthSecret) {
    throw new Error('Convex credentials were not prepared')
  }

  const origins = browserOrigins(config)
  const env = await readEnvFile(config.envFile)
  const values = new Map<string, string>()

  for (const [key, value] of Object.entries(env)) {
    if (runnerOwnedEnvVars.has(key)) continue
    values.set(key, process.env[key] ?? value)
  }
  values.set('BETTER_AUTH_SECRET', config.betterAuthSecret)
  values.set('SITE_URL', origins.siteUrl)
  values.set('FRONTEND_URL', origins.frontendUrl)
  values.set('TRUST_ALL_ORIGINS', config.trustAny ? 'true' : 'false')
  values.set('SIDECAR_URL', `http://localhost:${config.sidecarPort}`)

  const changes = [...values].map(([name, value]) => ({ name, value }))
  await convexEnv(config, changes)
  for (const [name, _] of values)
    console.log(`${green('✔')} Successfully set ${name}`)
}

export async function deployConvex(
  manager: ProcessManager,
  config: RunnerConfig,
  processName = 'convex-deploy',
  cwd = config.convexRoot,
) {
  await manager.run(
    processName,
    bunx(
      'convex',
      'deploy',
      '--url',
      config.convexInternalUrl,
      '--admin-key',
      config.convexSelfHostedAdminKey ?? '',
      '--typecheck',
      'disable',
    ),
    { cwd },
  )
}

type MigrationDeployment = {
  complete(): Promise<void>
  deploy(phase: 'migration' | 'strict'): Promise<void>
  migrate(): Promise<void>
}

/** Deploys migration code permissively, migrates, then verifies strict schema. */
export async function runMigrationDeployment(ops: MigrationDeployment) {
  await ops.deploy('migration')
  try {
    await ops.migrate()
  } catch (migrationError) {
    try {
      await ops.deploy('strict')
    } catch (strictError) {
      throw new AggregateError(
        [migrationError, strictError],
        'Migration failed and strict schema validation could not be restored',
        { cause: strictError },
      )
    }
    throw migrationError
  }
  await ops.deploy('strict')
  await ops.complete()
}

export type MigrationBootMode = 'migrate' | 'strict'

/** Chooses a safe boot path from the last strictly completed release. */
export function migrationBootMode(
  state: SchemaMigrationState | undefined,
  targetVersion: number = SCHEMA_MIGRATION_VERSION,
): MigrationBootMode {
  if (!state) return 'migrate'

  const newestVersion = Math.max(state.version, state.targetVersion)
  if (newestVersion > targetVersion) {
    throw new Error(
      `Database schema version ${newestVersion} is newer than this app's version ${targetVersion}`,
    )
  }
  if (
    state.phase === 'complete' &&
    state.version === targetVersion &&
    state.targetVersion === targetVersion
  ) {
    return 'strict'
  }
  return 'migrate'
}

/** Produces the isolated schema source used only by the migration deploy. */
export function disableSchemaValidation(source: string) {
  const enabled = 'const schemaValidation = true'
  if (!source.includes(enabled)) {
    throw new Error('Could not locate the schema validation declaration')
  }
  return source.replace(enabled, 'const schemaValidation = false')
}

/** Deploys strictly on ordinary boots and runs the recovery path when needed. */
export async function deployWithMigrations(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  const state = await readDeployedReleaseState(config)

  if (migrationBootMode(state) === 'strict') {
    console.log('Schema migrations are current.')
    await deployConvex(manager, config)
    return
  }

  await runMigrationDeployment({
    complete: () => completeRelease(config),
    deploy: (phase) =>
      phase === 'migration'
        ? deployMigrationSchema(manager, config)
        : deployConvex(manager, config),
    migrate: () => runMigrations(manager, config),
  })
}

function convexRunEnvironment(config: RunnerConfig) {
  return {
    CONVEX_SELF_HOSTED_ADMIN_KEY: config.convexSelfHostedAdminKey ?? '',
    CONVEX_SELF_HOSTED_URL: config.convexInternalUrl,
  }
}

function convexRunCommand(functionName: string) {
  return bunx(
    'convex',
    'run',
    functionName,
    '--typecheck',
    'disable',
    '--codegen',
    'disable',
  )
}

async function readDeployedReleaseState(
  config: RunnerConfig,
): Promise<SchemaMigrationState | undefined> {
  const result = await commandResult(
    convexRunCommand('migrations:_getReleaseState'),
    {
      cwd: config.convexRoot,
      env: convexRunEnvironment(config),
    },
  )
  if (result.exitCode !== 0) return undefined

  const value: unknown = JSON.parse(result.stdout)
  if (value === null) return undefined
  if (!isSchemaMigrationState(value)) {
    throw new Error('The deployed schema migration state is invalid')
  }
  return value
}

function isSchemaMigrationState(value: unknown): value is SchemaMigrationState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return (
    state.key === 'schema' &&
    (state.phase === 'migrating' || state.phase === 'complete') &&
    typeof state.targetVersion === 'number' &&
    typeof state.updatedAt === 'number' &&
    typeof state.version === 'number'
  )
}

async function completeRelease(config: RunnerConfig) {
  const result = await commandResult(
    convexRunCommand('migrations:_completeRelease'),
    {
      cwd: config.convexRoot,
      env: convexRunEnvironment(config),
    },
  )
  if (result.exitCode !== 0) {
    throw new Error(
      `Could not finalize schema migration: ${result.stderr.trim()}`,
    )
  }
}

/** Deploys a temporary copy so the tracked schema always remains strict. */
async function deployMigrationSchema(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  const tempParent = join(config.dataDir, 'tmp')
  await mkdir(tempParent, { recursive: true })
  const root = await mkdtemp(join(tempParent, 'convex-migration-'))

  try {
    const sourceRoot = join(config.convexRoot, 'packages/convex/src')
    const functionsRoot = join(root, 'packages/convex/src')

    await cp(sourceRoot, functionsRoot, { recursive: true })
    await cp(
      join(config.projectRoot, 'packages/core/src'),
      join(root, 'packages/core/src'),
      { recursive: true },
    )
    await writeFile(
      join(root, 'convex.json'),
      `${JSON.stringify({ functions: 'packages/convex/src' }, null, 2)}\n`,
    )
    await writeFile(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'slopbench-migration-deploy',
          private: true,
          type: 'module',
          dependencies: { convex: '*' },
        },
        null,
        2,
      )}\n`,
    )
    await writeFile(
      join(root, 'tsconfig.json'),
      `${JSON.stringify(
        {
          compilerOptions: {
            module: 'ESNext',
            moduleResolution: 'bundler',
            paths: {
              '@sb/convex/*': ['./packages/convex/src/*'],
              '@sb/core/*': ['./packages/core/src/*'],
            },
            target: 'ES2022',
          },
        },
        null,
        2,
      )}\n`,
    )

    const schemaPath = join(functionsRoot, 'schema.ts')
    const schema = await readFile(schemaPath, 'utf8')
    await writeFile(schemaPath, disableSchemaValidation(schema))

    await deployConvex(manager, config, 'convex-deploy-migrations', root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Runs db migrations for the current release. */
export async function runMigrations(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  await manager.run(
    'convex-migrate',
    bunx(
      'convex',
      'run',
      'migrations:_applyRelease',
      '--typecheck',
      'disable',
      '--codegen',
      'disable',
    ),
    {
      cwd: config.convexRoot,
      // `run` has no --url/--admin-key, and the configured self-hosted URL may
      // be a public origin behind a proxy. Point it at the local backend.
      env: convexRunEnvironment(config),
    },
  )
}

export async function startConvexDev(
  manager: ProcessManager,
  config: RunnerConfig,
) {
  const convexDev = await manager.spawn(
    'convex-dev',
    bunx(
      'convex',
      'dev',
      '--url',
      config.convexInternalUrl,
      '--admin-key',
      config.convexSelfHostedAdminKey ?? '',
    ),
    { cwd: config.convexRoot },
  )
  await convexDev.waitForLine('functions ready', 120_000)
  return convexDev
}

async function convexEnv(
  config: RunnerConfig,
  changes: { name: string; value: string }[],
) {
  const response = await fetch(
    `${config.convexInternalUrl}/api/update_environment_variables`,
    {
      body: JSON.stringify({ changes }),
      headers: {
        Authorization: `Convex ${config.convexSelfHostedAdminKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  )

  if (!response.ok) {
    const details = (await response.text()).trim()
    throw new Error(
      `Failed to set Convex environment variables (${response.status}): ${details}`,
    )
  }
}
