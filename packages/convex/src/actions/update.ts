'use node'

import { action } from '../_generated/server'
import { authorizeAdmin } from '../functions'
import type { UpdateStatus } from '../model/update'

/** Whether a newer release is available. Admin only. */
export const checkForUpdate = action({
  args: {},
  handler: async (ctx): Promise<UpdateStatus> => {
    await authorizeAdmin(ctx)

    const { readUpdateStatus } = await import('../model/update')
    return readUpdateStatus()
  },
})
