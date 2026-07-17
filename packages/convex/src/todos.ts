import { v } from 'convex/values'

import { internalMutation } from './_generated/server'
import { authQuery } from './functions'
import * as Todos from './model/todos'
import { todoStatusValidator } from './validators'

export const get = authQuery({
  args: { sessionId: v.id('sessions') },
  handler: Todos.get,
})

export const _write = internalMutation({
  args: { sessionId: v.id('sessions'), todos: v.array(v.string()) },
  handler: Todos._write,
})

export const _edit = internalMutation({
  args: {
    sessionId: v.id('sessions'),
    edits: v.array(
      v.object({ task: v.string(), status: todoStatusValidator }),
    ),
  },
  handler: Todos._edit,
})
