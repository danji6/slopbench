import { authQuery } from './functions'
import { listTools } from './model/tool/metas'

export const list = authQuery({
  args: {},
  handler: listTools,
})
