import { spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { hostname } from 'node:os'
import { delimiter, join } from 'node:path'
import type { z } from 'zod'

import type { homeSchema } from './schemas'
import { resolveHome } from './storage'

export function desktopCapability() {
  const supported =
    process.platform === 'darwin' ||
    process.platform === 'win32' ||
    (process.platform === 'linux' &&
      !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) &&
      executableOnPath('xdg-open'))
  return { supported, machine: hostname() }
}

/** Opens an authenticated home using an argument array. */
export async function openHomeFolder(input: z.infer<typeof homeSchema>) {
  if (!desktopCapability().supported)
    throw new Error('Desktop file browser is unavailable')

  const target = await resolveHome(
    input.ownerId,
    input.originAgentId ?? input.agentId,
    input.path,
  )

  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'explorer.exe'
        : 'xdg-open'

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [target], {
      stdio: 'ignore',
      detached: true,
      shell: false,
    })
    child.once('error', () =>
      reject(new Error('Could not open the system file browser')),
    )
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })

  return { ok: true }
}

function executableOnPath(command: string) {
  return (process.env.PATH ?? '').split(delimiter).some((directory) => {
    if (!directory) return false
    try {
      accessSync(join(directory, command), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}
