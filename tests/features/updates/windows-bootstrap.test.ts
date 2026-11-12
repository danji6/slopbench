import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectRoot } from '~/scripts/runner/config'

const powershell = Bun.which('powershell') ?? Bun.which('pwsh')

async function hashArchives(helper: string, archives: string[]) {
  const commands = archives.map((archive) => {
    const literalPath = archive.replaceAll("'", "''")
    return `Get-Sha256Hash '${literalPath}'
[System.IO.File]::Delete('${literalPath}')`
  })
  const script = `$ErrorActionPreference = 'Stop'
function Get-FileHash { throw 'Get-FileHash is unavailable' }
${helper}
${commands.join('\n')}
`
  const child = Bun.spawn(
    [
      powershell!,
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { stdout: 'pipe', stderr: 'pipe', timeout: 15_000, killSignal: 'SIGKILL' },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  expect(
    exitCode,
    stderr || `PowerShell exited with ${child.signalCode ?? exitCode}`,
  ).toBe(0)
  expect(stderr).toBe('')
  return stdout.trim().split(/\r?\n/)
}

test.skipIf(!powershell)(
  'the Windows bootstrap hashes downloads without Get-FileHash',
  async () => {
    const source = await readFile(
      join(projectRoot, 'scripts/bootstrap.ps1'),
      'utf8',
    )
    const helper = source.match(/^function Get-Sha256Hash\([^]*?^}/m)?.[0]
    expect(helper).toBeDefined()

    const directory = await mkdtemp(join(tmpdir(), 'slopbench-bootstrap-'))
    const contents = [Buffer.alloc(0), Buffer.from([0, 1, 127, 128, 255])]
    const archives = contents.map((_, index) =>
      join(directory, `Bun's [download ${index}].zip`),
    )

    try {
      for (const [index, archive] of archives.entries()) {
        await writeFile(archive, contents[index]!)
      }
      expect(await hashArchives(helper!, archives)).toEqual(
        contents.map((content) =>
          createHash('sha256').update(content).digest('hex').toUpperCase(),
        ),
      )
      for (const archive of archives) {
        expect(await Bun.file(archive).exists()).toBe(false)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  20_000,
)
