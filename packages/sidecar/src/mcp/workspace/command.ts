import { spawn } from 'node:child_process'

const MAX_COMMAND_BYTES = 100_000
const TRUNCATED_MARKER = '\n[truncated]\n'

export async function runCommand(
  command: string,
  cwd: string,
  timeoutSeconds: number,
  signal?: AbortSignal,
) {
  return new Promise<{ exitCode: number | null; output: string }>(
    (resolve, reject) => {
      const child = spawn('/bin/bash', ['-lc', command], {
        cwd,
        detached: process.platform !== 'win32',
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      let output = ''
      let killed = false

      const append = (chunk: Buffer) => {
        output = appendCommandOutput(output, chunk)
      }

      const kill = () => {
        killed = true
        if (!child.pid) return
        try {
          if (process.platform === 'win32') child.kill()
          else process.kill(-child.pid, 'SIGTERM')
        } catch {
          child.kill()
        }
      }

      const timeout = setTimeout(kill, timeoutSeconds * 1000)
      const onAbort = () => kill()

      child.stdout?.on('data', append)
      child.stderr?.on('data', append)

      signal?.addEventListener('abort', onAbort, { once: true })

      child.on('error', reject)

      child.on('close', (exitCode) => {
        clearTimeout(timeout)

        signal?.removeEventListener('abort', onAbort)

        const text = output.trim() || '(no output)'

        if (killed) {
          reject(new Error(`Command timed out or was aborted\n\n${text}`))
        } else if (exitCode && exitCode !== 0) {
          reject(new Error(`${text}\n\nCommand exited with code ${exitCode}`))
        } else {
          resolve({ exitCode, output: text })
        }
      })
    },
  )
}

export function appendCommandOutput(output: string, chunk: Buffer | string) {
  return truncateCommandOutput(output + chunk.toString())
}

export function truncateCommandOutput(output: string) {
  if (output.length <= MAX_COMMAND_BYTES) return output

  const available = MAX_COMMAND_BYTES - TRUNCATED_MARKER.length
  const headLength = Math.ceil(available / 2)
  const tailLength = Math.floor(available / 2)

  return `${output.slice(0, headLength)}${TRUNCATED_MARKER}${output.slice(-tailLength)}`
}
