import type { Id } from '../_generated/dataModel'
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { AuthQueryCtx } from '../functions'
import type { TodoItem, TodoStatus } from '../types'
import { getMember } from './session/memberships'

export type TodoEdit = { task: string; status: TodoStatus }

export type TodoEditResult = { ok: true } | { ok: false; error: string }

export function hasUnresolvedTodos(items: TodoItem[]) {
  return items.some((item) => item.status !== 'completed')
}

const STATUS_GLYPHS = { pending: ' ', in_progress: '-', completed: 'x' }

export function formatTodoList(items: TodoItem[]) {
  return items
    .map((item) => `[${STATUS_GLYPHS[item.status]}] ${item.content}`)
    .join('\n')
}

export async function getBySession(ctx: QueryCtx, sessionId: Id<'sessions'>) {
  return ctx.db
    .query('todos')
    .withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId))
    .unique()
}

export async function get(
  ctx: AuthQueryCtx,
  { sessionId }: { sessionId: Id<'sessions'> },
) {
  if (!(await getMember(ctx, sessionId, ctx.userId))) return null
  return getBySession(ctx, sessionId)
}

export async function remove(ctx: MutationCtx, sessionId: Id<'sessions'>) {
  const existing = await getBySession(ctx, sessionId)
  if (existing) await ctx.db.delete(existing._id)
}

/**
 * Fully replaces the session's todo list, keeping the status of existing ones.
 * The session's current turnCount becomes the baseline for the nudge reminder.
 */
export async function _write(
  ctx: MutationCtx,
  { sessionId, todos }: { sessionId: Id<'sessions'>; todos: string[] },
) {
  if (todos.length === 0) {
    await remove(ctx, sessionId)
    return
  }

  const existing = await getBySession(ctx, sessionId)
  const previous = new Map(
    existing?.items.map((item) => [item.content, item.status]),
  )
  const items = todos.map((content) => ({
    content,
    status: previous.get(content) ?? 'pending',
  }))

  await upsertItems(ctx, sessionId, existing, items)
}

/**
 * Scoped status updates by exact task text. Returns the current list on a
 * failed match.
 */
export async function _edit(
  ctx: MutationCtx,
  { sessionId, edits }: { sessionId: Id<'sessions'>; edits: TodoEdit[] },
): Promise<TodoEditResult> {
  const existing = await getBySession(ctx, sessionId)
  if (!existing) {
    return {
      ok: false,
      error: 'No todo list exists yet. Create one with write_todo first.',
    }
  }

  try {
    const items = applyTodoEdits(existing.items, edits)
    await upsertItems(ctx, sessionId, existing, items)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: `${message} Current todos:\n${formatTodoList(existing.items)}`,
    }
  }
}

/** Applies status edits against exact task text matches. */
export function applyTodoEdits(items: TodoItem[], edits: TodoEdit[]) {
  if (edits.length === 0) throw new Error('At least one edit is required.')

  const next = [...items]
  for (const edit of edits) {
    const matches = next.flatMap((item, index) =>
      item.content === edit.task ? [index] : [],
    )
    if (matches.length === 0) {
      throw new Error(
        `No todo matches "${edit.task}". The task must match its text exactly.`,
      )
    }
    if (matches.length > 1) {
      throw new Error(`${matches.length} todos match "${edit.task}".`)
    }
    next[matches[0]] = { content: edit.task, status: edit.status }
  }
  return next
}

async function upsertItems(
  ctx: MutationCtx,
  sessionId: Id<'sessions'>,
  existing: { _id: Id<'todos'> } | null,
  items: TodoItem[],
) {
  const session = await ctx.db.get(sessionId)
  const patch = {
    items,
    turnCount: session?.turnCount ?? 0,
    updatedAt: Date.now(),
  }

  if (existing) {
    await ctx.db.patch(existing._id, patch)
  } else {
    await ctx.db.insert('todos', { sessionId, ...patch })
  }
}
