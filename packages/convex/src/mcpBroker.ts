import { internalMutation, internalQuery } from './_generated/server'
import * as Access from './model/mcpBrokerAccess'
import * as V from './validators/mcpBroker'
import { streamExecutionArgsValidator } from './validators/streams'

export const _servers = internalMutation({
  args: streamExecutionArgsValidator.fields,
  handler: Access.servers,
})

export const _server = internalQuery({
  args: V.brokerServerValidator.fields,
  handler: Access.server,
})

export const _target = internalQuery({
  args: V.brokerTargetValidator.fields,
  handler: Access.target,
})

export const _search = internalMutation({
  args: V.brokerSearchValidator.fields,
  handler: Access.search,
})

export const _output = internalQuery({
  args: V.brokerOutputValidator.fields,
  handler: Access.output,
})
