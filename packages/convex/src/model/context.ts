import type { ModelMessage } from '@ai-sdk/provider-utils'

const TRIM_PADDING = 5

async function getTokenizer() {
  const [{ Tiktoken }, { default: cl100k_base }] = await Promise.all([
    import('js-tiktoken/lite'),
    import('js-tiktoken/ranks/cl100k_base'),
  ])
  const tokenizer = new Tiktoken(cl100k_base)
  return {
    encode(text: string) {
      return { length: tokenizer.encode(text).length }
    },
  }
}

export async function estimateTokens(text: string): Promise<number> {
  if (!text) return 0
  return (await getTokenizer()).encode(text).length
}

export async function trimContextToThreshold(
  messages: ModelMessage[],
  system: string | undefined,
  threshold: number,
): Promise<ModelMessage[]> {
  if (messages.length === 0) return messages

  const encoding = await getTokenizer()

  const systemTokens = system ? encoding.encode(system).length : 0

  let totalTokens = systemTokens
  const messageTokens: { index: number; tokens: number }[] = []

  for (let i = 0; i < messages.length; i++) {
    const content = getModelMessageText(messages[i])
    const tokens = encoding.encode(content).length + TRIM_PADDING
    messageTokens.push({ index: i, tokens })
    totalTokens += tokens
  }

  if (totalTokens <= threshold) return messages

  const minMessagesToKeep = 1
  const trimmedIndices = new Set<number>()

  for (let i = 0; i < messageTokens.length; i++) {
    if (
      totalTokens <= threshold ||
      messageTokens.length - trimmedIndices.size <= minMessagesToKeep
    ) {
      break
    }

    const msg = messageTokens[i]
    const isLastUser =
      msg.index === messages.length - 1 && messages[msg.index].role === 'user'

    if (isLastUser) continue

    trimmedIndices.add(msg.index)
    totalTokens -= msg.tokens
  }

  return messages.filter((_, i) => !trimmedIndices.has(i))
}

function getModelMessageText(message: ModelMessage): string {
  const { content } = message

  if (typeof content === 'string') return content

  return (content as Array<{ type: string; text?: string }>)
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('')
}
