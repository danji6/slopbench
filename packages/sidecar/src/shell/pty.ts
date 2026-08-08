import type { IPty } from 'node-pty'
import { type ChildProcess, spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'

import {
  jobEnv,
  killProcessTree,
  shellInvocation,
  shellPath,
} from './system-shell'

export type PtyMode = 'pty' | 'script' | 'pipe'

export type ShellJobProcess = {
  mode: PtyMode
  pid: number | undefined
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (chunk: string) => void): void
  onExit(cb: (exitCode: number | null) => void): void
}

export type SpawnShellJobInput = {
  command: string
  cwd: string
  cols: number
  rows: number
  shell?: string
}

type NodePtySpawnOptions = {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

type NodePtyModule = {
  spawn(file: string, args: string[], options: NodePtySpawnOptions): IPty
}

let nodePtyProbe: Promise<NodePtyModule | null> | undefined
let loggedMode: PtyMode | undefined

function forcedMode(): PtyMode | undefined {
  const mode = process.env.CHAT_JOB_MODE
  return mode === 'pty' || mode === 'script' || mode === 'pipe'
    ? mode
    : undefined
}

function probeNodePty(): Promise<NodePtyModule | null> {
  nodePtyProbe ??= (async () => {
    try {
      const mod = await import('node-pty')

      const { file, args } = shellInvocation('echo ok')

      const works = await new Promise<boolean>((resolve) => {
        const probe = mod.spawn(file, args, {
          name: 'xterm',
          cols: 20,
          rows: 5,
          cwd: process.cwd(),
          env: process.env as Record<string, string>,
        })

        let sawData = false

        const timer = setTimeout(() => {
          try {
            probe.kill()
          } catch {
            // Probe process may already be gone
          }
          resolve(false)
        }, 2000)
        probe.onData(() => {
          sawData = true
        })
        probe.onExit(() => {
          clearTimeout(timer)
          // Data events can trail the exit event slightly
          setTimeout(() => resolve(sawData), 100)
        })
      })

      return works ? mod : null
    } catch {
      return null
    }
  })()

  return nodePtyProbe
}

function hasScript(): boolean {
  if (process.platform !== 'linux') return false
  return (process.env.PATH ?? '')
    .split(delimiter)
    .some((dir) => dir && isExecutable(join(dir, 'script')))
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

export async function spawnJob(
  input: SpawnShellJobInput,
): Promise<ShellJobProcess> {
  const proc = await spawnForMode(forcedMode(), input)

  if (loggedMode !== proc.mode) {
    loggedMode = proc.mode
    console.log(`Job runner using ${proc.mode} mode`)
  }

  return proc
}

/** Falls back to the next best mode when the requested one is unavailable. */
async function spawnForMode(
  mode: PtyMode | undefined,
  input: SpawnShellJobInput,
): Promise<ShellJobProcess> {
  if (mode === 'pipe') return spawnPipe(input)
  if (mode === 'script') return spawnScriptPty(input)

  const nodePty = await probeNodePty()
  if (nodePty) return spawnNodePty(nodePty, input)
  return hasScript() ? spawnScriptPty(input) : spawnPipe(input)
}

function spawnNodePty(
  nodePty: NodePtyModule,
  input: SpawnShellJobInput,
): ShellJobProcess {
  const { file, args } = shellInvocation(input.command, input.shell)
  const pty: IPty = nodePty.spawn(file, args, {
    name: 'xterm-256color',
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: jobEnv({ TERM: 'xterm-256color' }) as Record<string, string>,
  })

  return {
    mode: 'pty',
    pid: pty.pid,
    write: (data) => pty.write(data),
    resize: (cols, rows) => {
      try {
        pty.resize(cols, rows)
      } catch {
        // Resizing an exited pty throws, no-op
      }
    },
    // `forkpty` makes the leader its own session, so the group is the job
    kill: () => killProcessTree(pty.pid, () => safeKill(pty)),
    onData: (cb) => void pty.onData(cb),
    onExit: (cb) => void pty.onExit(({ exitCode }) => cb(exitCode)),
  }
}

function safeKill(pty: IPty) {
  try {
    pty.kill()
  } catch {
    // Already exited
  }
}

/**
 * util-linux `script` allocates a real pty and relays it over pipes.
 * The pty size is fixed at spawn time, so resize is a no-op.
 */
function spawnScriptPty(input: SpawnShellJobInput): ShellJobProcess {
  const sized = `stty cols ${input.cols} rows ${input.rows} 2>/dev/null; ${input.command}`
  const child = spawn('script', ['-qefc', sized, '/dev/null'], {
    cwd: input.cwd,
    detached: true,
    env: jobEnv({ SHELL: shellPath(input.shell), TERM: 'xterm-256color' }),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  return wrapChildProcess(child, 'script')
}

function spawnPipe(input: SpawnShellJobInput): ShellJobProcess {
  const { file, args } = shellInvocation(input.command, input.shell)
  const child = spawn(file, args, {
    cwd: input.cwd,
    detached: process.platform !== 'win32',
    env: jobEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  return wrapChildProcess(child, 'pipe')
}

function wrapChildProcess(child: ChildProcess, mode: PtyMode): ShellJobProcess {
  const dataCallbacks: Array<(chunk: string) => void> = []
  const decoder = new TextDecoder('utf-8', { fatal: false })
  // Output can arrive before the consumer attaches its callback
  let pending = ''

  const emit = (buffer: Buffer) => {
    let text = decoder.decode(buffer, { stream: true })
    if (mode === 'pipe') text = text.replace(/(?<!\r)\n/g, '\r\n')
    if (!text) return
    if (dataCallbacks.length === 0) {
      pending += text
      return
    }
    for (const cb of dataCallbacks) cb(text)
  }

  child.stdout?.on('data', emit)
  child.stderr?.on('data', emit)

  return {
    mode,
    pid: child.pid,
    write: (data) => void child.stdin?.write(data),
    resize: () => {
      // Fixed-size pty (script) or no pty at all (pipe)
    },
    kill: () => killProcessTree(child.pid, () => child.kill()),
    onData: (cb) => {
      dataCallbacks.push(cb)
      if (pending) {
        const buffered = pending
        pending = ''
        cb(buffered)
      }
    },
    onExit: (cb) => void child.on('close', (exitCode) => cb(exitCode)),
  }
}
