import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Exercises the production JS supervisor under Node, rather than Bun's TS loader. */
test('bundled stdio supervision runs under Node with a minimal environment', async () => {
  const directory = await mkdtemp(path.join(process.cwd(), '.data-mcp-bundle-'))
  try {
    const result = await Bun.build({
      entrypoints: [
        'packages/sidecar/src/mcp/external/stdio.ts',
        'packages/sidecar/src/mcp/external/stdio-supervisor.ts',
      ],
      outdir: directory,
      target: 'node',
      format: 'esm',
      naming: '[name].js',
      external: ['@modelcontextprotocol/sdk'],
    })
    expect(result.success).toBe(true)
    const fixture = fileURLToPath(
      new URL('./fixtures/stateful.mjs', import.meta.url),
    )
    const runner = path.join(directory, 'runner.mjs')
    await writeFile(
      runner,
      `
      import { Client } from '@modelcontextprotocol/sdk/client/index.js';
      import { localTransport } from './stdio.js';
      const client = new Client({name:'node-test',version:'1'});
      await client.connect(localTransport({transport:'stdio',command:process.execPath,url:'',args:[${JSON.stringify(fixture)}]}));
      const result = await client.callTool({name:'counter',arguments:{}});
      await client.close();
      console.log(result.content[0].text);
    `,
    )
    const process = Bun.spawn(['node', runner], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ])
    expect(code).toBe(0)
    expect(stderr).not.toContain('Error')
    expect(JSON.parse(stdout).leaked).toBe(false)
    expect(JSON.parse(stdout).count).toBe(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 15000)
