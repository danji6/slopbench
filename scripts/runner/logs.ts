import { type WriteStream, createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export type LogSink = {
  close(): void
  handleChunk(
    chunk: Uint8Array,
    stream: NodeJS.WriteStream,
    channel: LogChannel,
  ): void
  onLine(listener: (line: string) => void): void
}

export type LogChannel = 'stderr' | 'stdout'
export type LogFilterMode = 'dev' | 'start'

const bootstrapWorkerReason =
  'Search indexes bootstrapping and not yet available for use|Table count unavailable while bootstrapping'

const sharedNoisyLinePatterns = [
  /Module not in functions: _deps\//,
  new RegExp(
    `Caught feature_unavailable error .*\\w+ died: (${bootstrapWorkerReason})`,
  ),
  new RegExp(`\\w+ died, num_failures: \\d+\\..*(${bootstrapWorkerReason})`),
]

const productionNoisyLinePatterns = [
  /^\(node:\d+\) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided\.$/,
  /^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/,
  /\[Better Auth\]: Rate limiting skipped: could not determine client IP address\./,
  /INFO common::http: stats_middleware: matched_path is None, uri: \/(api\/auth\/(get-session|convex\/(token|jwks))|\.well-known\/openid-configuration)$/,
  /INFO convex-cloud-http: .*"GET \/(http\/)?(api\/auth\/(get-session|convex\/(token|jwks))|\.well-known\/openid-configuration) HTTP\/1\.1" 200 /,
  /INFO convex-cloud-http: .*"GET \/api\/[0-9.]+\/sync HTTP\/1\.1" 101 /,
]

export async function createLogSink(options: {
  filterLogs: boolean
  logDir: string
  mode: LogFilterMode
  name: string
}): Promise<LogSink> {
  await mkdir(options.logDir, { recursive: true })

  const rawLog = createWriteStream(
    join(options.logDir, `${timestamp()}-${safeName(options.name)}.log`),
    { flags: 'a' },
  )
  const listeners = new Set<(line: string) => void>()
  const buffers: Record<LogChannel, string> = {
    stderr: '',
    stdout: '',
  }
  const decoders: Record<LogChannel, TextDecoder> = {
    stderr: new TextDecoder(),
    stdout: new TextDecoder(),
  }

  return {
    close() {
      flushLine(buffers.stdout, process.stdout, rawLog, listeners, options)
      flushLine(buffers.stderr, process.stderr, rawLog, listeners, options)
      buffers.stdout = ''
      buffers.stderr = ''
      rawLog.end()
    },
    handleChunk(chunk, stream, channel) {
      rawLog.write(chunk)
      buffers[channel] += decoders[channel].decode(chunk, { stream: true })

      const lines = buffers[channel].split(/\r?\n/)
      buffers[channel] = lines.pop() ?? ''

      for (const line of lines) {
        writeLine(line, stream, listeners, options)
      }
    },
    onLine(listener) {
      listeners.add(listener)
    },
  }
}

function flushLine(
  line: string,
  stream: NodeJS.WriteStream,
  rawLog: WriteStream,
  listeners: Set<(line: string) => void>,
  options: LogFilterOptions,
) {
  if (!line) return
  rawLog.write('\n')
  writeLine(line, stream, listeners, options)
}

function writeLine(
  line: string,
  stream: NodeJS.WriteStream,
  listeners: Set<(line: string) => void>,
  options: LogFilterOptions,
) {
  for (const listener of listeners) {
    listener(line)
  }
  if (!shouldSuppressLogLine(line, options)) {
    stream.write(`${line}\n`)
  }
}

export function shouldSuppressLogLine(line: string, options: LogFilterOptions) {
  if (!options.filterLogs) return false

  const patterns =
    options.mode === 'start'
      ? [...sharedNoisyLinePatterns, ...productionNoisyLinePatterns]
      : sharedNoisyLinePatterns

  return patterns.some((pattern) => pattern.test(line))
}

type LogFilterOptions = {
  filterLogs: boolean
  mode: LogFilterMode
}

function safeName(name: string) {
  return name.replace(/[^a-z0-9._-]/gi, '-')
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}
