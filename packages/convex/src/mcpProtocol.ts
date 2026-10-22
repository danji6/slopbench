import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authQuery } from './functions'
import * as Protocol from './model/mcpProtocol'
import * as V from './validators/mcpProtocol'

export const _launch = internalQuery({
  args: { serverId: v.id('mcpServers') },
  handler: Protocol.settingsLaunch,
})

export const _publish = internalMutation({
  args: V.protocolPublishValidator.fields,
  handler: Protocol.publish,
})

export const check = authQuery({
  args: V.protocolCheckValidator.fields,
  handler: Protocol.check,
})

export const _expire = internalMutation({
  args: V.protocolCheckValidator.fields,
  handler: Protocol.expire,
})

export const _reference = internalQuery({
  args: { resultRef: v.id('_storage') },
  handler: Protocol.reference,
})
