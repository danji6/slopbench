import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Access from './model/toolkits/access'
import * as Components from './model/toolkits/components'
import { executionToolkits } from './model/toolkits/execution'
import { observe } from './model/toolkits/observation'
import { publish } from './model/toolkits/publication'
import { select as selectToolkit } from './model/toolkits/selection'
import * as Settings from './model/toolkits/settings'
import { skillAccess, skillContext } from './model/toolkits/skills'
import * as Views from './model/toolkits/views'
import { toolkitSkillReadArgsValidator } from './validators/skills'
import { streamExecutionArgsValidator } from './validators/streams'
import {
  toolkitComponentValidator,
  toolkitIdValidator,
  toolkitListValidator,
  toolkitMissingValidator,
  toolkitObservationValidator,
  toolkitPublishValidator,
  toolkitSelectionValidator,
  toolkitSettingsValidator,
} from './validators/toolkits'

export const list = authQuery({
  args: toolkitListValidator,
  handler: Views.list,
})

export const get = authQuery({
  args: toolkitIdValidator,
  handler: Views.get,
})

export const settings = authMutation({
  args: toolkitSettingsValidator,
  handler: Settings.settings,
})

export const select = authMutation({
  args: toolkitSelectionValidator,
  handler: selectToolkit,
})

export const component = authMutation({
  args: toolkitComponentValidator,
  handler: Components.configureComponent,
})

export const remove = authMutation({
  args: toolkitIdValidator,
  handler: (ctx, args) => Settings.remove(ctx, args.toolkitId),
})

export const _publish = internalMutation({
  args: toolkitPublishValidator,
  handler: publish,
})

export const _missing = internalMutation({
  args: toolkitMissingValidator,
  handler: Settings.missing,
})

export const _available = internalQuery({
  args: { agentId: v.id('agents'), sessionId: v.optional(v.id('sessions')) },
  handler: (ctx, args) =>
    Access.availableToolkits(ctx, args.agentId, args.sessionId),
})

export const sources = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Views.sources,
})

export const _skillAccess = internalQuery({
  args: toolkitSkillReadArgsValidator,
  handler: skillAccess,
})

export const _skillContext = internalQuery({
  args: streamExecutionArgsValidator,
  handler: skillContext,
})

export const _observe = internalMutation({
  args: toolkitObservationValidator,
  handler: observe,
})

export const _execution = internalQuery({
  args: streamExecutionArgsValidator,
  handler: executionToolkits,
})

export const bindings = authQuery({
  args: toolkitIdValidator,
  handler: Views.bindings,
})
