import { v } from 'convex/values'

import { authQuery } from './functions'
import * as Appearances from './model/appearances'

export const getMap = authQuery({
  args: { ids: v.array(v.id('appearances')) },
  handler: Appearances.getMap,
})
