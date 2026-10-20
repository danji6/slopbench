import { spawn } from 'node:child_process'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout } from 'node:timers'

let count = 0
const children = []
process.stderr.write('fixture ready\n')
if (process.env.FIXTURE_SECRET) {
  process.stderr.write(process.env.FIXTURE_SECRET.slice(0, 3))
  setTimeout(
    () => process.stderr.write(process.env.FIXTURE_SECRET.slice(3) + '\n'),
    Number(process.env.FIXTURE_SECRET_DELAY) || 10,
  )
}
function answer(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
createInterface({ input: process.stdin }).on('line', async (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'initialize') {
    if (process.env.FIXTURE_HANG_STARTUP) return
    answer(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fixture', version: '1' },
    })
  } else if (request.method === 'tools/list') {
    answer(request.id, {
      tools: [
        { name: 'counter', inputSchema: { type: 'object', properties: {} } },
      ],
    })
  } else if (request.method === 'tools/call') {
    const args = request.params.arguments ?? {}
    if (args.crash) process.exit(1)
    if (args.delay)
      await new Promise((resolve) => setTimeout(resolve, args.delay))
    let childPid
    if (args.child) {
      const child = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        { stdio: 'ignore' },
      )
      children.push(child)
      childPid = child.pid
    }
    answer(request.id, {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            count: ++count,
            pid: process.pid,
            childPid,
            secret: !!process.env.FIXTURE_SECRET,
            leaked: !!process.env.SIDECAR_SECRET,
            arg: process.argv[2],
          }),
        },
      ],
    })
  }
})
process.stdin.on('end', () => process.exit(0))
