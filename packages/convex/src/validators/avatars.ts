import { v } from 'convex/values'

/** An avatar image and its thumbnail. */
export const avatarSchema = v.object({
  storageId: v.id('_storage'),
  thumbStorageId: v.id('_storage'),
})
