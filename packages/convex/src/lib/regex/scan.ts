'use node'

import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { ToolError } from '../../errors'

type GoRuntime = {
  argv: string[]
  importObject: WebAssembly.Imports
  run: (instance: WebAssembly.Instance) => Promise<void>
}

type ScanInput = {
  pattern: string
  size: number
  position: number
  line: number
  backward: boolean
  read: (start: number, end: number) => Promise<Uint8Array>
  hit: (
    line: number,
    offset: number,
    start: number,
    end: number,
    base: number,
    preview: Uint8Array,
  ) => boolean
}

const host = globalThis as typeof globalThis & {
  Go: new () => GoRuntime
} & Record<string, unknown>

let compiledModule: Promise<WebAssembly.Module> | undefined

async function loadModule() {
  // The Convex WASM loader emitted by esbuild can use fromBase64, which can be missing on Node 22.
  const needsDecoder = !('fromBase64' in Uint8Array)
  if (needsDecoder) {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      configurable: true,
      value: (value: string) => Buffer.from(value, 'base64'),
    })
  }
  try {
    const [{ default: matcher }] = await Promise.all([
      import('./matcher.wasm'),
      import('./wasm.exec.js'),
    ])
    // Bun's test loader can return an asset path.
    return typeof matcher === 'string'
      ? await WebAssembly.compile(await readFile(matcher))
      : matcher
  } finally {
    if (needsDecoder) Reflect.deleteProperty(Uint8Array, 'fromBase64')
  }
}

/** Searches UTF-8 lines from a byte-range reader with an isolated host bridge. */
export async function scanRegex(input: ScanInput) {
  const id = `regex-${randomUUID()}`
  compiledModule ??= loadModule()
  const module = await compiledModule
  const go = new host.Go()
  go.argv = ['regex', id]
  const instance = await WebAssembly.instantiate(module, go.importObject)
  let result: { position: number; line: number } | undefined
  let failure: unknown
  host[id] = {
    ...input,
    read: async (start: number, end: number) => {
      try {
        return await input.read(start, end)
      } catch (error) {
        failure = error
        throw error
      }
    },
    hit: (...args: Parameters<ScanInput['hit']>) => {
      try {
        return input.hit(...args)
      } catch (error) {
        failure = error
        return false
      }
    },
    finish: (position: number, line: number) => {
      result = { position, line }
    },
    fail: (message: string) => {
      failure ??= new ToolError(message)
    },
  }
  try {
    await go.run(instance)
    if (failure) throw failure
    if (!result) throw new ToolError('Regex scan did not finish')
    return result
  } finally {
    delete host[id]
  }
}
