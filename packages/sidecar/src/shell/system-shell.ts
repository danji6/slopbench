import { shellBasename } from '@sb/core/shell/name'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export type ShellInvocation = { file: string; args: string[] }

type ShellFlavor = 'cmd' | 'posix' | 'powershell'

const isWindows = process.platform === 'win32'

/** The shell agent commands run under. */
export function shellPath(shell?: string): string {
  const override = shell?.trim()
  if (override) return resolveShell(override)
  if (!isWindows) return '/bin/bash'

  return (
    findOnPath('pwsh.exe') ?? findOnPath('powershell.exe') ?? 'powershell.exe'
  )
}

/** Build the argv that runs `command` under the platform shell. */
export function shellInvocation(
  command: string,
  shell?: string,
): ShellInvocation {
  const file = shellPath(shell)

  switch (shellFlavor(file)) {
    case 'powershell':
      return {
        file,
        args: [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          // Windows rebuilds an argv array into a single command line, which
          // PowerShell then re-parses with different quoting rules. UTF-16LE
          // base64 is the only form that survives both passes unchanged.
          Buffer.from(command, 'utf16le').toString('base64'),
        ],
      }
    case 'cmd':
      return { file, args: ['/d', '/s', '/c', command] }
    case 'posix':
      return { file, args: ['-lc', command] }
  }
}

function shellFlavor(file: string): ShellFlavor {
  const name = shellBasename(file)
  if (name === 'pwsh' || name === 'powershell') return 'powershell'
  if (name === 'cmd') return 'cmd'
  return 'posix'
}

/** Turns a configured shell into something spawnable. */
function resolveShell(shell: string): string {
  if (/[\\/]/.test(shell)) return shell

  const found = findOnPath(shell)
  if (!found) throw new Error(`Shell not found: ${shell}`)
  return found
}

function findOnPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    for (const candidate of withExtensions(join(dir, name))) {
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

function withExtensions(file: string): string[] {
  if (!isWindows || /\.[^\\/.]+$/.test(file)) return [file]

  // Windows resolves a name through `PATHEXT`, so `bash` finds `bash.exe`
  const extensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
  return [...extensions.map((ext) => file + ext.toLowerCase()), file]
}

/** How long a process group gets to exit on its own before SIGKILL. */
const ESCALATE_MS = 8000

/** Terminate a process and everything it spawned. */
export function killProcessTree(
  pid: number | undefined,
  fallback?: () => void,
) {
  if (!pid) return

  if (isWindows) {
    // Windows has no process groups, so we walk the tree with `taskkill`
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => fallback?.())
    return
  }

  if (!signalGroup(pid, 'SIGTERM')) {
    fallback?.()
    return
  }

  setTimeout(() => signalGroup(pid, 'SIGKILL'), ESCALATE_MS).unref?.()
}

/** Signals the group led by `pid`. False when it is already gone. */
function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

/** Environment shared by every job. */
export function jobEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PAGER: 'cat',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    ...extra,
  }
}
