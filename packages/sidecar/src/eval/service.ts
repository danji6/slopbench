import { z } from 'zod'

import { withAgentFiles } from '../agent-files/access'
import { evaluateInWorker } from './pool'
import type { messageSchema, promptsSchema } from './schemas'

export async function evaluatePrompts(
  inputValue: z.infer<typeof promptsSchema>,
) {
  const { items, ...input } = inputValue
  const indices = items.flatMap((item, index) =>
    !('type' in item) && item.enabled ? [index] : [],
  )
  const texts = indices.map((index) => z.string().parse(items[index].content))
  const result = await withAgentFiles(input.authorizedAgentId, () =>
    evaluateInWorker({ ...input, texts, kind: 'prompt' }),
  )
  const rendered = [...items]
  indices.forEach((index, offset) => {
    rendered[index] = { ...items[index], content: result.texts[offset] }
  })

  return {
    items: rendered,
    environment: result.environment,
    dirty: result.dirty,
  }
}

export async function evaluateMessage(
  inputValue: z.infer<typeof messageSchema>,
) {
  const { parts, ...input } = inputValue
  const indices = parts.flatMap((part, index) =>
    part.type === 'text' ? [index] : [],
  )
  const texts = indices.map((index) => z.string().parse(parts[index].text))
  const result = await withAgentFiles(input.authorizedAgentId, () =>
    evaluateInWorker({ ...input, texts, kind: 'message' }),
  )
  const rendered = [...parts]
  indices.forEach((index, offset) => {
    rendered[index] = { ...parts[index], text: result.texts[offset] }
  })

  return {
    parts: rendered,
    environment: result.environment,
    dirty: result.dirty,
  }
}
