import { v } from 'convex/values'

import { internalMutation, internalQuery } from './_generated/server'
import { authMutation, authQuery } from './functions'
import * as Access from './model/integrations/access'
import * as Components from './model/integrations/components'
import { executionIntegrations } from './model/integrations/execution'
import { observe } from './model/integrations/observation'
import { publish } from './model/integrations/publication'
import { select as selectIntegration } from './model/integrations/selection'
import * as Settings from './model/integrations/settings'
import { skillAccess, skillContext } from './model/integrations/skills'
import * as Views from './model/integrations/views'
import {
  integrationComponentValidator,
  integrationIdValidator,
  integrationListValidator,
  integrationMissingValidator,
  integrationObservationValidator,
  integrationPublishValidator,
  integrationSelectionValidator,
  integrationSettingsValidator,
  integrationSkillReadValidator,
} from './validators/integrations'
import { streamExecutionArgsValidator } from './validators/streams'

export const list = authQuery({
  args: integrationListValidator,
  handler: Views.list,
})

export const get = authQuery({
  args: integrationIdValidator,
  handler: Views.get,
})

export const settings = authMutation({
  args: integrationSettingsValidator,
  handler: Settings.settings,
})

export const select = authMutation({
  args: integrationSelectionValidator,
  handler: selectIntegration,
})

export const component = authMutation({
  args: integrationComponentValidator,
  handler: Components.configureComponent,
})

export const remove = authMutation({
  args: integrationIdValidator,
  handler: (ctx, args) => Settings.remove(ctx, args.integrationId),
})

export const _publish = internalMutation({
  args: integrationPublishValidator,
  handler: publish,
})

export const _missing = internalMutation({
  args: integrationMissingValidator,
  handler: Settings.missing,
})

export const _available = internalQuery({
  args: { agentId: v.id('agents'), sessionId: v.optional(v.id('sessions')) },
  handler: (ctx, args) =>
    Access.availableIntegrations(ctx, args.agentId, args.sessionId),
})

export const sources = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Views.sources,
})

export const _skillAccess = internalQuery({
  args: integrationSkillReadValidator,
  handler: skillAccess,
})

export const _skillContext = internalQuery({
  args: streamExecutionArgsValidator,
  handler: skillContext,
})

export const _observe = internalMutation({
  args: integrationObservationValidator,
  handler: observe,
})

export const _execution = internalQuery({
  args: streamExecutionArgsValidator,
  handler: executionIntegrations,
})
