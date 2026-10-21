import { internalMutation, internalQuery } from './_generated/server'
import * as Operations from './model/mcpOperations'
import * as V from './validators/mcpOperations'
import { streamExecutionArgsValidator } from './validators/streams'

export const _reserve = internalMutation({
  args: V.mcpReserveArgsValidator.fields,
  handler: Operations.reserve,
})

export const _get = internalQuery({
  args: V.mcpOperationExecutionValidator.fields,
  handler: Operations.get,
})

export const _pending = internalQuery({
  args: streamExecutionArgsValidator.fields,
  handler: Operations.pending,
})
export const _allowed = internalQuery({
  args: V.mcpOperationExecutionValidator.fields,
  handler: Operations.lease,
})

export const _observe = internalMutation({
  args: V.mcpObserveArgsValidator.fields,
  handler: Operations.observe,
})

export const _deliver = internalMutation({
  args: V.mcpOperationExecutionValidator.fields,
  handler: Operations.deliver,
})

export const _acknowledged = internalMutation({
  args: V.mcpOperationArgsValidator.fields,
  handler: Operations.acknowledged,
})

export const _inspect = internalQuery({
  args: V.mcpOperationArgsValidator.fields,
  handler: Operations.inspect,
})

export const _unsettled = internalQuery({
  args: {},
  handler: Operations.unsettled,
})

export const _forgetDeleted = internalMutation({
  args: V.mcpOperationArgsValidator.fields,
  handler: Operations.forgetDeleted,
})

export const _find = internalQuery({
  args: V.mcpOperationFindValidator.fields,
  handler: Operations.find,
})
