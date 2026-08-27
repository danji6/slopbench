import { v } from 'convex/values'

import { internalQuery, query } from './_generated/server'
import { authQuery } from './functions'
import {
  KNOWN_PROVIDER_TYPES,
  providerRequiresBaseURL,
} from './model/provider/known'
import * as Models from './model/provider/providers'

export const list = authQuery({
  args: {},
  handler: Models.list,
})

export const providerIds = query({
  args: {},
  handler: () =>
    KNOWN_PROVIDER_TYPES.map(
      ({ value, label, defaultReasoning, binaryReasoningParameter }) => ({
        value,
        label,
        requiresBaseURL: providerRequiresBaseURL(value),
        defaultReasoning,
        binaryReasoningParameter,
      }),
    ).sort((a, b) => a.label.localeCompare(b.label)),
})

export const _getProviderForModel = internalQuery({
  args: { ownerId: v.id('users'), modelId: v.string() },
  handler: Models._getProviderForModel,
})
