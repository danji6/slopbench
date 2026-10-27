import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const suites = readdirSync(join(root, 'tests/features'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const code = await child.exited
  if (code !== 0) {
    process.exit(code)
  }
}

async function runSuite(suite: string, args: string[]) {
  const smoke = `./tests/smoke/${suite}.test.ts`
  await run([
    'test',
    ...(suite === 'ui' ? ['--isolate'] : []),
    '--path-ignore-patterns',
    '**/browser/**',
    `./tests/features/${suite}`,
    ...(existsSync(join(root, smoke)) ? [smoke] : []),
    ...args,
  ])
}

async function runBrowser(args: string[]) {
  const [feature, ...flags] = args
  if (suites.includes(feature)) {
    if (!existsSync(join(root, 'tests/browser/specs', feature))) {
      throw new Error(`No browser tests for ${feature}.`)
    }
    args = [`${feature}/`, ...flags]
  }
  await run([
    'x',
    '--no-install',
    'playwright',
    'test',
    '--config',
    'tests/browser/playwright.config.ts',
    ...args,
  ])
}

async function main() {
  const [suite = 'smoke', ...args] = process.argv.slice(2)
  if (suite === '--help' || suite === '-h') {
    console.log('Usage: bun run tests <suite|all|smoke|browser> [native flags]')
    console.log(`Suites: ${suites.join(', ')}`)
    console.log(
      'Browser feature: bun run test:browser <feature> [native flags]',
    )
    return
  }
  if (suite === 'browser') {
    return runBrowser(args)
  }
  if (suite === 'smoke') {
    return run(['test', ...args])
  }
  if (suite === 'all') {
    for (const feature of suites) {
      await runSuite(feature, args)
    }
    return
  }
  if (!suites.includes(suite)) {
    throw new Error(
      `Unknown suite: ${suite}. Choose ${suites.join(', ')}, smoke, all, or browser.`,
    )
  }
  await runSuite(suite, args)
}

await main().catch((error: Error) => {
  console.error(error.message)
  process.exit(1)
})
