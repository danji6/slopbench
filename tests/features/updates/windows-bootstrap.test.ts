import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectRoot } from '~/scripts/runner/config'

const powershell = Bun.which('powershell') ?? Bun.which('pwsh')

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
    const archive = join(directory, "Bun's [download].zip")
    const literalPath = archive.replaceAll("'", "''")
    const script = `$ErrorActionPreference = 'Stop'
function Get-FileHash { throw 'Get-FileHash is unavailable' }
${helper}
Get-Sha256Hash '${literalPath}'
[System.IO.File]::Delete('${literalPath}')
`

    try {
      for (const content of [
        Buffer.alloc(0),
        Buffer.from([0, 1, 127, 128, 255]),
      ]) {
        await writeFile(archive, content)
        const result = Bun.spawnSync(
          [
            powershell!,
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ],
          { stdout: 'pipe', stderr: 'pipe' },
        )

        expect(result.stderr.toString()).toBe('')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.toString().trim()).toBe(
          createHash('sha256').update(content).digest('hex').toUpperCase(),
        )
        expect(await Bun.file(archive).exists()).toBe(false)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
