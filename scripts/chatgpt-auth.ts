/** Completes remote-host OAuth with the same loopback implementation as the sidecar. */
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  cancelSignIn,
  connectionStatus,
  startSignIn,
} from '../packages/sidecar/src/providers/openai/oauth'
import {
  readRegistration,
  removeRegistration,
  saveRegistration,
  withRegistrationLock,
  writeProtected,
} from '../packages/sidecar/src/providers/openai/storage'
import {
  importTransfer,
  setupSchema,
} from '../packages/sidecar/src/providers/openai/transfer'

async function main() {
  const [command, ...args] = process.argv.slice(2)

  function option(name: string) {
    const index = args.indexOf(name)
    const value = index < 0 ? undefined : args[index + 1]
    if (!value) throw new Error(`Missing ${name}`)
    return resolve(value)
  }

  if (command === 'import') {
    const path = option('--file')
    await importTransfer(JSON.parse(await readFile(path, 'utf8')))
    await rm(path)
    console.log(
      'ChatGPT connection imported. The server now owns token renewal; the transfer file was removed.',
    )
    return
  }

  if (command !== 'authorize') {
    throw new Error(
      'Usage: bun scripts/chatgpt-auth.ts authorize --setup setup.json --out transfer.json | import --file transfer.json',
    )
  }

  const setup = setupSchema.parse(
    JSON.parse(await readFile(option('--setup'), 'utf8')),
  )
  if (setup.expiresAt < Date.now())
    throw new Error('Setup ticket expired. Download a new remote setup file.')

  const output = option('--out')
  const key = { ownerId: 'temporary-transfer', connectionId: randomUUID() }
  await withRegistrationLock(key, () => saveRegistration(key, setup.registration)) // prettier-ignore

  try {
    const result = await startSignIn(key, setup.hostId)
    // Authorization URLs contain PKCE challenge/state but no retained ID token or access token
    console.log(`Open this URL in a browser on this computer:\n${result.url}`)
    const deadline = Math.min(result.expiresAt, setup.expiresAt)

    while (Date.now() < deadline) {
      const status = await connectionStatus(key)
      if (status.message) throw new Error(status.message)
      if (status.status === 'connected') {
        const registration = await readRegistration(key)
        if (!registration) throw new Error('Missing completed registration')
        await writeProtected(output, { setup, registration })
        console.log(
          'Protected transfer file saved. Transfer it to the server over SSH, then run the import command. Remove any remaining local copy afterward.',
        )
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('Sign-in timed out')
  } finally {
    cancelSignIn(key)
    await withRegistrationLock(key, () => removeRegistration(key))
  }
}

if (import.meta.main) {
  main().catch(() => {
    console.error(
      'ChatGPT setup failed. Verify the setup ticket, complete browser consent, and retry.',
    )
    process.exitCode = 1
  })
}
