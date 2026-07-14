import type { RunnerMode } from './config'
import { type LogSink, createLogSink } from './logs'

export type ManagedProcess = {
  exited: Promise<number>
  kill(signal?: NodeJS.Signals): void
  name: string
  pid: number | undefined
  waitForLine(text: string, timeoutMs: number): Promise<void>
}

export class ProcessManager {
  private readonly processes = new Set<ManagedProcess>()

  constructor(
    private readonly options: {
      cwd: string
      env: NodeJS.ProcessEnv
      filterLogs: boolean
      logDir: string
      mode: RunnerMode
    },
  ) {}

  async spawn(
    name: string,
    cmd: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  ) {
    const sink = await createLogSink({
      filterLogs: this.options.filterLogs,
      logDir: this.options.logDir,
      mode: this.options.mode,
      name,
    })
    const env = withColorEnvironment({ ...this.options.env, ...options.env })
    const child = Bun.spawn({
      cmd,
      cwd: options.cwd ?? this.options.cwd,
      env,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    })

    const outputDone = Promise.all([
      routeOutput(child.stdout, process.stdout, sink, 'stdout'),
      routeOutput(child.stderr, process.stderr, sink, 'stderr'),
    ])

    const managed: ManagedProcess = {
      exited: child.exited.then(async (code) => {
        await outputDone
        sink.close()
        this.processes.delete(managed)
        return code
      }),
      kill(signal = 'SIGTERM') {
        child.kill(signal)
      },
      name,
      pid: child.pid,
      waitForLine(text, timeoutMs) {
        return waitForLine(sink, text, timeoutMs)
      },
    }
    this.processes.add(managed)
    return managed
  }

  async run(
    name: string,
    cmd: string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
  ) {
    const process = await this.spawn(name, cmd, options)
    const exitCode = await process.exited
    if (exitCode !== 0) {
      throw new Error(`${name} exited with code ${exitCode}`)
    }
  }

  async stopAll() {
    const processes = [...this.processes]
    for (const process of processes) {
      process.kill()
    }
    await Promise.allSettled(processes.map((process) => process.exited))
  }

  async waitForAnyExit(processes: ManagedProcess[]) {
    const result = await Promise.race(
      processes.map(async (process) => ({
        code: await process.exited,
        process,
      })),
    )
    throw new Error(`${result.process.name} exited with code ${result.code}`)
  }
}

function withColorEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!process.stdout.isTTY || env.NO_COLOR) return env

  return {
    ...env,
    CLICOLOR: env.CLICOLOR ?? '1',
    CLICOLOR_FORCE: env.CLICOLOR_FORCE ?? '1',
    COLORTERM: env.COLORTERM ?? 'truecolor',
    FORCE_COLOR: env.FORCE_COLOR ?? '1',
    TERM: env.TERM ?? 'xterm-256color',
  }
}

export async function output(cmd: string[], options: { cwd: string }) {
  const child = Bun.spawn({
    cmd,
    cwd: options.cwd,
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`${cmd.join(' ')} failed: ${stderr.trim()}`)
  }
  return stdout.trim()
}

export async function commandExists(cmd: string, cwd: string) {
  try {
    await output([cmd, '--version'], { cwd })
    return true
  } catch {
    return false
  }
}

async function routeOutput(
  stream: ReadableStream<Uint8Array> | null,
  target: NodeJS.WriteStream,
  sink: LogSink,
  channel: 'stderr' | 'stdout',
) {
  if (!stream) return

  for await (const chunk of stream) {
    sink.handleChunk(chunk, target, channel)
  }
}

function waitForLine(sink: LogSink, text: string, timeoutMs: number) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for log line: ${text}`))
    }, timeoutMs)

    sink.onLine((line) => {
      if (!line.includes(text)) return

      clearTimeout(timeout)
      resolve()
    })
  })
}
