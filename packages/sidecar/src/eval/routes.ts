import { MAX_SCOPE_PROMPTS } from '@sb/core/limits'
import { Hono } from 'hono'
import { z } from 'zod'

import { EvaluationBusyError, evaluateInWorker } from './pool'

const contextSchema = z.object({
  user: z.string().optional(),
  assistant: z.string().optional(),
  owner: z.string().optional(),
  tools: z.array(z.string()).optional(),
  isAdmin: z.boolean().optional(),
  userCount: z.number().optional(),
  agentCount: z.number().optional(),
  workDir: z.string().optional(),
  workDirs: z.array(z.string()).optional(),
})

const requestSchema = z.object({
  context: contextSchema,
  environment: z.record(z.string(), z.json()).default({}),
  // Set by the authenticated backend from its trusted invoker/workspace state
  authorizedWorkDir: z.string().optional(),
  authorizedWorkDirs: z.array(z.string()).optional(),
})

const records = z
  .array(z.record(z.string(), z.unknown()))
  .max(MAX_SCOPE_PROMPTS * 4)

const promptsSchema = requestSchema.extend({ items: records })

const messageSchema = requestSchema.extend({ parts: records })

export const evaluationRoutes = new Hono()

evaluationRoutes.post('/prompts', async (c) => {
  const { items, ...input } = promptsSchema.parse(await c.req.json())
  const indices = items.flatMap((item, index) =>
    !('type' in item) && item.enabled ? [index] : [],
  )
  const texts = indices.map((index) => z.string().parse(items[index].content))
  const result = await evaluateInWorker({ ...input, texts, kind: 'prompt' })
  const rendered = [...items]
  indices.forEach((index, offset) => {
    rendered[index] = { ...items[index], content: result.texts[offset] }
  })
  return c.json({
    items: rendered,
    environment: result.environment,
    dirty: result.dirty,
  })
})

evaluationRoutes.post('/message', async (c) => {
  const { parts, ...input } = messageSchema.parse(await c.req.json())
  const indices = parts.flatMap((part, index) =>
    part.type === 'text' ? [index] : [],
  )
  const texts = indices.map((index) => z.string().parse(parts[index].text))
  const result = await evaluateInWorker({ ...input, texts, kind: 'message' })
  const rendered = [...parts]
  indices.forEach((index, offset) => {
    rendered[index] = { ...parts[index], text: result.texts[offset] }
  })
  return c.json({
    parts: rendered,
    environment: result.environment,
    dirty: result.dirty,
  })
})

evaluationRoutes.onError((error, c) => {
  if (error instanceof z.ZodError)
    return c.json({ error: 'Invalid evaluation request' }, 400)
  if (error instanceof EvaluationBusyError)
    return c.json({ error: error.message }, 503)
  return c.json(
    { error: 'Dynamic JavaScript failed or exceeded its resource limit' },
    422,
  )
})
