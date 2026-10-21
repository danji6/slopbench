'use node'

import { internalAction } from '../_generated/server'
import * as V from '../validators/mcpCatalogs'

export const _expire = internalAction({
  args: V.catalogIdValidator.fields,
  handler: async (ctx, args) => {
    const { expireCatalog } = await import('../model/mcpCatalogActions')
    return expireCatalog(ctx, args)
  },
})

export const _refreshActive = internalAction({
  args: V.catalogRefreshActiveValidator.fields,
  handler: async (ctx, args) => {
    const { refreshActiveCatalog } = await import('../model/mcpCatalogActions')
    return refreshActiveCatalog(ctx, args)
  },
})
