import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const registrationSchema = z.object({
  transferNonce: z.string().optional(),
  transferExpiresAt: z.number().optional(),
  hostId: z.string(),
  clientId: z.string().optional(),
  subject: z.string().optional(),
  email: z.string().optional(),
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  idToken: z.string().optional(),
  scopes: z.array(z.string()).default([]),
  expiresAt: z.number().optional(),
  earliestRefreshAt: z.number().optional(),
})

export type Registration = z.infer<typeof registrationSchema>

export type ConnectionKey = { ownerId: string; connectionId: string }

export function credentialDirectory() {
  return (
    process.env.SLOPBENCH_AUTH_DIR ??
    join(homedir(), '.config', 'slopbench', 'provider-auth')
  )
}

function recordPath(key: ConnectionKey) {
  const digest = createHash('sha256')
    .update(JSON.stringify([key.ownerId, key.connectionId]))
    .digest('hex')
  return join(credentialDirectory(), `${digest}.json`)
}

/** Replaces an owner-only record atomically, without exposing partial rotating credentials. */
export async function writeProtected(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), {
      mode: 0o600,
      flag: 'wx',
    })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function readRegistration(
  key: ConnectionKey,
): Promise<Registration | undefined> {
  try {
    return registrationSchema.parse(
      JSON.parse(await readFile(recordPath(key), 'utf8')),
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    // eslint-disable-next-line preserve-caught-error -- Parse errors can include secret token fragments
    throw new Error('Cannot read protected ChatGPT registration')
  }
}

export async function saveRegistration(
  key: ConnectionKey,
  record: Registration,
) {
  await writeProtected(recordPath(key), record)
}

/** Serializes sidecar and helper writes, including rotating refresh tokens. */
export async function withRegistrationLock<T>(
  key: ConnectionKey,
  run: () => Promise<T>,
): Promise<T> {
  await mkdir(credentialDirectory(), { recursive: true, mode: 0o700 })
  const lock = `${recordPath(key)}.lock`

  for (let attempt = 0; attempt < 600; attempt++) {
    try {
      await mkdir(lock, { mode: 0o700 })
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      const info = await stat(lock).catch(() => undefined)
      if (info && Date.now() - info.mtimeMs > 120_000)
        await rm(lock, { recursive: true, force: true })
      if (attempt === 599)
        throw new Error('ChatGPT connection is busy; retry shortly', {
          cause: err,
        })
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  try {
    return await run()
  } finally {
    await rm(lock, { recursive: true, force: true })
  }
}

export async function hostId(): Promise<string> {
  return withRegistrationLock(
    { ownerId: 'host', connectionId: 'host' },
    async () => {
      const path = join(credentialDirectory(), 'host.json')
      try {
        return z
          .object({ id: z.string() })
          .parse(JSON.parse(await readFile(path, 'utf8'))).id
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error('Cannot read host identifier', { cause: err })
      }
      const id = `urn:uuid:${randomUUID()}`
      await writeProtected(path, { id })
      return id
    },
  )
}

/** Removes a temporary helper record after its credential transfer is saved. */
export async function removeRegistration(key: ConnectionKey) {
  await rm(recordPath(key), { force: true })
}
