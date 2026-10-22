import type { McpRuntimeScope } from '@sb/core/types'
import type { McpOperationStatus } from '@sb/core/types/mcp-operation'
import { createHash } from 'node:crypto'

import type { OperationStart } from './operation'
import type { OperationRecord } from './operation-store'

export function operationFingerprint(input: OperationStart) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        scope: input.scope,
        protocol: input.protocol,
        bootId: input.bootId,
        generation: input.generation,
        name: input.name,
        args: input.args,
        requestTimeoutMs: input.requestTimeoutMs,
        maxTotalTimeoutMs: input.maxTotalTimeoutMs,
        deadlineAt: input.deadlineAt,
      }),
    )
    .digest('hex')
}

export function assertOperationScope(
  record: OperationRecord,
  scope: McpRuntimeScope,
) {
  if (JSON.stringify(record.scope) !== JSON.stringify(scope)) {
    throw new Error('MCP operation scope mismatch')
  }
}

export function operationView(record: OperationRecord): McpOperationStatus {
  const {
    scope: _scope,
    fingerprint: _fingerprint,
    updatedAt: _updatedAt,
    ...status
  } = record
  return structuredClone(status)
}

/** Bounds transport diagnostics and marks shortened output explicitly. */
export function operationDiagnostic(error: unknown) {
  const text = error instanceof Error ? error.message : 'MCP operation failed'
  return text.length <= 8192
    ? text
    : text.slice(0, 8192) + '\n[diagnostic shortened]'
}
