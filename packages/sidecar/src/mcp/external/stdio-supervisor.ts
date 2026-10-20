import { spawn } from 'node:child_process'

/** Owns the launched process tree without interpreting its command as shell code. */
function supervise() {
  const launch = JSON.parse(process.env.SLOPBENCH_MCP_LAUNCH ?? '{}') as {
    command: string
    args: string[]
  }

  const env = { ...process.env }
  delete env.SLOPBENCH_MCP_LAUNCH
  delete env.SIDECAR_SECRET

  const child = spawn(launch.command, launch.args, {
    env,
    shell: false,
    detached: process.platform !== 'win32',
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let stopping = false
  let exited = false

  const signalTree = (signal: NodeJS.Signals) => {
    if (!child.pid) return
    if (process.platform === 'win32') {
      if (!exited)
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
        }).on('error', () => child.kill())
      return
    }
    try {
      process.kill(-child.pid, signal)
    } catch {
      /* The owned group has exited. */
    }
  }

  const stop = () => {
    if (stopping) return
    stopping = true
    child.stdin.end()
    setTimeout(() => signalTree('SIGTERM'), 750)
    setTimeout(() => {
      signalTree('SIGKILL')
      process.exit(exited ? (child.exitCode ?? 0) : 1)
    }, 1500)
  }

  process.stdin.pipe(child.stdin)
  child.stdout.pipe(process.stdout, { end: false })
  child.stderr.pipe(process.stderr, { end: false })
  child.stdin.on('error', () => {})
  process.stdout.on('error', stop)
  process.stdin.on('end', stop)
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  child.on('error', () => {
    process.stderr.write('MCP executable could not be started\n')
    stop()
  })
  child.on('exit', () => {
    exited = true
    process.stdin.unpipe(child.stdin)
    stop()
  })
}

supervise()
