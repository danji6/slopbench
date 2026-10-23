import process from 'node:process'
import { createInterface } from 'node:readline'

const mode = process.argv.at(-1)
let value = null
let calls = 0
let changed = false
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const answer = (id, result) => send({ id, result })
const definition = (index) => ({
  name: `tool_${String(index).padStart(3, '0')}`,
  description: `Tool ${index} for static investigation. ${index === 249 ? 'Long description '.repeat(100) : ''}`,
  inputSchema: {
    type: 'object',
    properties: {
      value: {
        type: index === 17 ? 'unsupported-type' : 'string',
        description: index === 249 ? 'λ😀'.repeat(30_000) : 'Saved value',
      },
      changeCatalog: { type: 'boolean' },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: { value: { type: ['string', 'null'] } },
  },
  annotations: { readOnlyHint: true, title: `Audited tool ${index}` },
  _meta: { provenance: { source: 'catalog-fixture' } },
  title: `Tool title ${index}`,
})

createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  if (request.method === 'initialize')
    answer(request.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: 'catalog-fixture', version: '3' },
    })
  if (request.method === 'tools/list') {
    const start = Number(request.params?.cursor ?? 0)
    if (mode === 'failure' && start)
      return send({
        id: request.id,
        error: { code: -32603, message: 'fixture page failed' },
      })
    if (mode === 'malformed' && start)
      return answer(request.id, { tools: [{}] })
    const count = changed ? 251 : 250
    const tools = Array.from(
      { length: Math.min(40, count - start) },
      (_, offset) => definition(start + offset),
    )
    if (mode === 'duplicate' && start) tools[0] = definition(0)
    answer(request.id, {
      tools,
      ...(start + 40 < count
        ? { nextCursor: mode === 'loop' ? '40' : String(start + 40) }
        : {}),
    })
  }
  if (request.method === 'tools/call') {
    const args = request.params.arguments ?? {}
    if (args.value !== undefined) value = args.value
    if (args.changeCatalog) {
      changed = true
      send({ method: 'notifications/tools/list_changed' })
    }
    answer(request.id, {
      structuredContent: { value },
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            name: request.params.name,
            value,
            calls: ++calls,
            pid: process.pid,
          }),
        },
      ],
    })
  }
})
process.stdin.on('end', () => process.exit(0))
