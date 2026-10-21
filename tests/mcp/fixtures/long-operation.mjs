import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { createInterface } from 'node:readline'
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from 'node:timers'

let calls = 0
const operations = new Map()
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const answer = (id, result) => send({ id, result })
createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.method === 'notifications/cancelled') {
    const operation = operations.get(request.params.requestId)
    if (operation?.args.cancelFile)
      appendFileSync(operation.args.cancelFile, 'cancelled\n')
    if (operation && !operation.args.ignoreCancel) {
      clearTimeout(operation.finish)
      clearInterval(operation.progress)
      operations.delete(request.params.requestId)
    }
    return
  }
  if (request.id === undefined) return
  if (request.method === 'initialize') {
    answer(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'long-fixture', version: '1' },
    })
  } else if (request.method === 'tools/call') {
    const args = request.params.arguments ?? {}
    const count = ++calls
    if (args.dispatchFile) appendFileSync(args.dispatchFile, `${count}\n`)
    if (args.crash) process.exit(1)
    let amount = 0
    const token = request.params._meta?.progressToken
    const progress =
      args.progressInterval &&
      setInterval(
        () =>
          send({
            method: 'notifications/progress',
            params: {
              progressToken: token,
              progress: ++amount,
              ...(args.total ? { total: args.total } : {}),
              message: 'Analyzing fixture',
            },
          }),
        args.progressInterval,
      )
    const finish = setTimeout(() => {
      clearInterval(progress)
      operations.delete(request.id)
      answer(request.id, {
        content: [
          {
            type: 'text',
            text:
              args.output ?? JSON.stringify({ count, token, pid: process.pid }),
          },
        ],
      })
    }, args.delay ?? 0)
    operations.set(request.id, { args, progress, finish })
  }
})
process.stdin.on('end', () => process.exit(0))
