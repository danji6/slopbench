import { authQuery } from './functions'
import * as Tools from './model/tools'

export const list = authQuery({
  args: {},
  handler: Tools.listTools,
})
