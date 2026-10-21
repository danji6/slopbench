import type { McpRuntimeScope } from '@sb/core/types'
import type { McpProgress } from '@sb/core/types/mcp-operation'

import { withWorkspaceOperation } from '../workspace/context'
import {
  assertOperationScope,
  operationDiagnostic,
  operationFingerprint,
  operationView,
} from './operation-record'
import type { McpOperationStore, OperationRecord } from './operation-store'
import type { McpRegistry } from './registry'

export type OperationStart = {
  id: string
  scope: McpRuntimeScope
  bootId: string
  generation: string
  expiresAt: number
  deadlineAt: number
  name: string
  args: Record<string, unknown>
  requestTimeoutMs: number
  maxTotalTimeoutMs: number
}

export type OperationAccess = Pick<OperationStart, 'id' | 'scope'>

type Active = {
  record: OperationRecord
  abort: AbortController
  work?: Promise<void>
  dispatched: boolean
  absolute?: ReturnType<typeof setTimeout>
  inactivity?: ReturnType<typeof setTimeout>
  grace?: ReturnType<typeof setTimeout>
}

type Limits = {
  operations: number
  resultBytes: number
  cancellationGraceMs: number
  forgetGraceMs?: number
  maxResultBytes?: number
}

const DEFAULT_LIMITS: Limits = {
  operations: 4096,
  resultBytes: 128 * 1024 * 1024,
  cancellationGraceMs: 2000,
}

/** Owns work independently of HTTP watchers; journals never permit uncertain replay. */
export class McpOperations {
  private records = new Map<string, OperationRecord>()
  private active = new Map<string, Active>()
  private ready?: Promise<void>
  private queue = Promise.resolve()
  private resultBytes = 0

  constructor(
    private readonly registry: McpRegistry,
    private readonly store: McpOperationStore,
    private readonly limits = DEFAULT_LIMITS,
  ) {}

  private initialize() {
    return (this.ready ??= (async () => {
      await this.store.initialize()
      for (const record of await this.store.records()) {
        if (record.acknowledged) await this.store.acknowledge(record.id)
        const retainedBytes = await this.store.resultSize(record.id)
        record.resultBytes = retainedBytes || undefined

        if (record.state === 'running') {
          record.updatedAt = Date.now()
          record.state = 'lost'
          record.error =
            'Sidecar restarted during execution; outcome unknown. This operation will not be replayed.'
          await this.store.save(record)
        }

        this.records.set(record.id, record)
        this.resultBytes += retainedBytes
      }
    })())
  }

  /** Serializes journal publication and terminal transitions, never toolkit work. */
  private transaction<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue
      .catch(() => {})
      .then(async () => {
        await this.initialize()
        return fn()
      })
    this.queue = next.then(
      () => {},
      () => {},
    )
    return next
  }

  start(input: OperationStart) {
    return this.transaction(() => this.startOnce(input))
  }

  private async startOnce(input: OperationStart) {
    if (input.expiresAt < Date.now())
      throw new Error('MCP authorization expired')

    const fingerprint = operationFingerprint(input)
    const previous = this.records.get(input.id)
    if (previous) {
      assertOperationScope(previous, input.scope)
      const sameInvocation =
        previous.fingerprint === fingerprint ||
        previous.fingerprint === 'cancelled-before-dispatch'
      if (!sameInvocation) {
        throw new Error(
          'MCP operation identity was reused with changed arguments or configuration',
        )
      }
      return operationView(previous)
    }

    this.assertCapacity()
    const record = this.initialRecord(input, fingerprint)
    await this.store.save(record)
    this.records.set(input.id, record)
    if (record.state === 'running') this.dispatch(input, record)

    return operationView(record)
  }

  private assertCapacity() {
    if (this.records.size >= this.limits.operations) {
      throw new Error(
        'MCP operation capacity reached; remove old operations before dispatch',
      )
    }
    if (this.resultBytes >= this.limits.resultBytes) {
      throw new Error(
        'MCP retained-result capacity reached; acknowledge completed results before dispatch',
      )
    }
  }

  private initialRecord(
    input: OperationStart,
    fingerprint: string,
  ): OperationRecord {
    const record: OperationRecord = {
      id: input.id,
      scope: input.scope,
      fingerprint,
      bootId: input.bootId,
      generation: input.generation,
      state: 'running',
      updatedAt: Date.now(),
    }
    if (this.connectionLost(input)) {
      record.state = 'lost'
      record.error =
        'MCP session lost before dispatch; outcome may be unknown. Reconnect explicitly.'
    } else if (input.deadlineAt <= Date.now()) {
      record.state = 'timedOut'
      record.error = 'MCP absolute operation deadline elapsed before dispatch'
    }
    return record
  }

  private connectionLost(input: OperationStart) {
    if (input.bootId !== this.registry.bootId) return true
    const status = this.registry.status(input.scope)
    if (!status || status.state !== 'connected') return true
    return status.generation !== input.generation
  }

  private dispatch(input: OperationStart, record: OperationRecord) {
    const active: Active = {
      record,
      abort: new AbortController(),
      dispatched: false,
    }
    this.active.set(input.id, active)
    active.absolute = setTimeout(
      () =>
        void this.timeout(
          input,
          'MCP absolute operation deadline exceeded',
        ).catch(() => {}),
      Math.max(0, input.deadlineAt - Date.now()),
    )
    this.resetInactivity(input, active)
    active.work = this.execute(input, active).finally(() => {
      clearTimeout(active.absolute)
      clearTimeout(active.inactivity)
      this.active.delete(input.id)
    })
    // A journal failure keeps the durable running marker, which recovers as lost.
    void active.work.catch(() => {})
  }

  private async execute(input: OperationStart, active: Active) {
    try {
      const text = await withWorkspaceOperation(input.scope.sessionId, () =>
        this.registry.call(
          input.scope,
          input.name,
          input.args,
          {
            bootId: input.bootId,
            generation: input.generation,
            expiresAt: input.deadlineAt,
          },
          active.abort.signal,
          {
            timeout: input.requestTimeoutMs + 1000,
            maxTotalTimeout: Math.max(1, input.deadlineAt - Date.now()) + 1000,
            ondispatch: () => {
              active.dispatched = true
            },
            onprogress: (progress) => this.progress(input, active, progress),
          },
        ),
      )
      await this.complete(active.record, text)
    } catch (error) {
      await this.transaction(async () => {
        if (active.record.state !== 'running') return
        const status = this.registry.status(input.scope)
        active.record.updatedAt = Date.now()
        active.record.state = status?.state === 'connected' ? 'failed' : 'lost'
        active.record.error = operationDiagnostic(error)
        await this.store.save(active.record)
      })
    }
  }

  private complete(record: OperationRecord, text: string) {
    return this.transaction(async () => {
      if (record.state !== 'running') return
      const bytes = Buffer.byteLength(JSON.stringify(text))
      const tooLarge = bytes > (this.limits.maxResultBytes ?? 32 * 1024 * 1024)
      if (tooLarge || this.resultBytes + bytes > this.limits.resultBytes) {
        throw new Error(
          'MCP result exceeds retained-result capacity; the tool finished but its canonical output could not be stored. Outcome may be unknown.',
        )
      }
      record.resultBytes = await this.store.saveResult(record.id, text)
      this.resultBytes += record.resultBytes
      record.updatedAt = Date.now()
      record.state = 'completed'
      await this.store.save(record)
    })
  }

  private progress(
    input: OperationStart,
    active: Active,
    progress: McpProgress,
  ) {
    if (active.record.state !== 'running') return
    if (!Number.isFinite(progress.progress)) return
    active.record.progress = {
      progress: progress.progress,
      total: Number.isFinite(progress.total) ? progress.total : undefined,
      message: progress.message?.slice(0, 2000),
    }
    this.resetInactivity(input, active)
  }

  private resetInactivity(input: OperationStart, active: Active) {
    clearTimeout(active.inactivity)
    active.inactivity = setTimeout(
      () =>
        void this.timeout(input, 'MCP inactivity timeout exceeded').catch(
          () => {},
        ),
      input.requestTimeoutMs,
    )
  }

  private async timeout(input: OperationAccess, reason: string) {
    await this.cancel(input, reason, 'timedOut')
  }

  cancel(
    input: OperationAccess,
    reason = 'MCP operation cancelled',
    state: 'cancelled' | 'timedOut' = 'cancelled',
  ) {
    return this.transaction(async () => {
      let record = this.lookup(input)
      if (!record) {
        if (this.records.size >= this.limits.operations) {
          throw new Error('MCP operation capacity reached')
        }
        record = {
          id: input.id,
          scope: input.scope,
          fingerprint: 'cancelled-before-dispatch',
          state: 'cancelled',
          bootId: this.registry.bootId,
          generation: '',
          updatedAt: Date.now(),
          error: reason,
        }
        this.records.set(record.id, record)
        await this.store.save(record)
        return operationView(record)
      }
      if (record.state !== 'running') return operationView(record)
      record.state = state
      record.error = `${reason}. Session state may be lost; cancellation does not imply rollback.`
      record.updatedAt = Date.now()
      try {
        await this.store.save(record)
      } finally {
        this.interrupt(input, reason)
      }
      return operationView(record)
    })
  }

  private interrupt(input: OperationAccess, reason: string) {
    const active = this.active.get(input.id)
    if (!active) return
    if (active.dispatched) {
      this.registry.quiesce(
        input.scope,
        'MCP cancellation requested; session state may be lost',
      )
      active.grace = setTimeout(() => {
        void this.registry
          .disconnect(
            input.scope,
            'MCP cancellation grace elapsed; session state may be lost',
          )
          .catch(() => {})
      }, this.limits.cancellationGraceMs)
    }
    active.abort.abort(new Error(reason))
  }

  status(input: OperationAccess) {
    return this.transaction(async () => {
      const record = this.lookup(input)
      return record ? operationView(record) : null
    })
  }

  result(input: OperationAccess) {
    return this.transaction(async () => {
      const record = this.lookup(input)
      if (!record || record.state !== 'completed' || record.acknowledged) {
        throw new Error('MCP canonical result is unavailable')
      }
      return this.store.result(input.id)
    })
  }

  acknowledge(input: OperationAccess) {
    return this.transaction(async () => {
      const record = this.lookup(input)
      if (!record || record.state === 'running') return
      const retainedBytes = await this.store.resultSize(input.id)
      record.acknowledged = true
      await this.store.save(record)
      await this.store.acknowledge(input.id)
      this.resultBytes -= retainedBytes
    })
  }

  forget(input: OperationAccess) {
    return this.transaction(async () => {
      const record = this.lookup(input)
      if (!record) return
      if (record.state === 'running' || this.active.has(input.id)) {
        throw new Error('MCP operation still settling')
      }
      if (
        Date.now() - record.updatedAt <
        (this.limits.forgetGraceMs ?? 60_000)
      ) {
        throw new Error(
          'MCP operation is inside its stale-request grace period',
        )
      }
      const retainedBytes = await this.store.resultSize(input.id)
      await this.store.forget(input.id)
      this.records.delete(input.id)
      this.resultBytes -= retainedBytes
    })
  }

  list(cursor: string | null, limit: number) {
    return this.transaction(async () => {
      const records = [...this.records.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      )
      const items = records
        .filter((record) => !cursor || record.id.localeCompare(cursor) > 0)
        .slice(0, limit)
      return {
        items: items.map((record) => ({
          ...operationView(record),
          scope: record.scope,
        })),
        nextCursor: items.length === limit ? items.at(-1)!.id : null,
      }
    })
  }

  /** Waits for terminal journal writes after owned connections have closed. */
  async drain() {
    await Promise.allSettled(
      [...this.active.values()].flatMap((active) =>
        active.work ? [active.work] : [],
      ),
    )
    await this.queue
  }

  private lookup(input: OperationAccess) {
    const record = this.records.get(input.id)
    if (record) assertOperationScope(record, input.scope)
    return record
  }
}
