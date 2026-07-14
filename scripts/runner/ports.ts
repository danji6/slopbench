import { output } from './processes'

export async function freePorts(
  ports: number[],
  options: { cwd: string; enabled: boolean },
) {
  if (!options.enabled) return

  for (const port of ports) {
    const pids = await findPidsOnPort(port, options.cwd)
    for (const pid of pids) {
      if (pid === process.pid) continue

      console.log(`Killing existing process on port ${port} (pid ${pid})`)
      try {
        process.kill(pid)
      } catch {
        if (process.platform === 'win32') {
          await taskKill(pid, options.cwd)
        }
      }
    }
  }

  if (ports.length > 0) {
    await sleep(500)
  }
}

async function findPidsOnPort(port: number, cwd: string) {
  try {
    const stdout =
      process.platform === 'win32'
        ? await output(
            [
              'powershell',
              '-NoProfile',
              '-Command',
              `(Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique`,
            ],
            { cwd },
          )
        : await output(['lsof', '-ti', `tcp:${port}`], { cwd })

    return stdout
      .split(/\s+/)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    return []
  }
}

async function taskKill(pid: number, cwd: string) {
  await output(['taskkill', '/PID', String(pid), '/T', '/F'], { cwd })
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
