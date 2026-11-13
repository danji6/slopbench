import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'

const serverCommand = [
  'command -v docker >/dev/null || {',
  'echo "WebKit tests on Arch Linux require Docker (see tests/README.md)." >&2;',
  'exit 1; };',
  // Stopping the Docker client can leave the container running.
  'trap \'docker stop -t 2 "$PLAYWRIGHT_CONTAINER" >/dev/null 2>&1 || true\' EXIT;',
  "trap 'exit 143' TERM;",
  'docker run --rm --init --name "$PLAYWRIGHT_CONTAINER"',
  '--network host --shm-size=1g',
  '--volume "$PLAYWRIGHT_CORE_DIR:/opt/playwright-core:ro"',
  '"$PLAYWRIGHT_DOCKER_IMAGE" node /opt/playwright-core/cli.js',
  'run-server --host 127.0.0.1 --port 0 --path "/$PLAYWRIGHT_CONTAINER" &',
  'wait "$!"',
].join(' ')

function isArchLinux() {
  if (process.platform !== 'linux' || !existsSync('/etc/os-release')) {
    return false
  }

  const release = readFileSync('/etc/os-release', 'utf8')
  return /^ID(?:_LIKE)?=[^\r\n]*\b(?:arch|cachyos)\b/m.test(release)
}

function selectsOnlyChromium() {
  const projects: string[] = []
  let readingProjects = false
  for (const arg of process.argv.slice(2)) {
    if (arg === '--') break
    if (arg === '--project') {
      readingProjects = true
    } else if (arg.startsWith('--project=')) {
      projects.push(arg.slice('--project='.length))
      readingProjects = false
    } else if (arg.startsWith('-')) {
      readingProjects = false
    } else if (readingProjects) {
      projects.push(arg)
    }
  }
  return (
    projects.length > 0 &&
    projects.every((name) => name.toLowerCase() === 'chromium')
  )
}

function playwrightCorePackage() {
  const require = createRequire(import.meta.url)
  const test = createRequire(require.resolve('@playwright/test/package.json'))
  const runner = createRequire(test.resolve('playwright/package.json'))
  return runner.resolve('playwright-core/package.json')
}

/** Run the Ubuntu browser build with its matching runtime on Arch Linux. */
export function browserServer() {
  if (!isArchLinux() || selectsOnlyChromium()) return undefined
  if (process.env.PW_TEST_CONNECT_WS_ENDPOINT) return undefined

  const manifest = playwrightCorePackage()
  const { version } = JSON.parse(readFileSync(manifest, 'utf8'))

  return {
    name: 'Playwright Docker',
    command: serverCommand,
    env: {
      PLAYWRIGHT_CORE_DIR: dirname(manifest),
      PLAYWRIGHT_DOCKER_IMAGE: `mcr.microsoft.com/playwright:v${version}-noble`,
      PLAYWRIGHT_CONTAINER: `corvori-playwright-${randomUUID()}`,
    },
    wait: {
      stdout: /Listening on (?<PW_TEST_CONNECT_WS_ENDPOINT>ws:\/\/\S+)\r?\n/,
    },
    gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 10_000 },
    timeout: 300_000,
  }
}
