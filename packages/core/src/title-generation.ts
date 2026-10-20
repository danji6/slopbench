/** Default system instructions for generating session titles. */
export const DEFAULT_TITLE_SYSTEM_PROMPT = [
  'Your task is to generate a concise title for a chat conversation.',
  'Rules:',
  '- 3 to 6 words, summarizing the topic as a plain noun phrase.',
  '- No surrounding quotes, no trailing punctuation.',
  '- Do not start with "Chat", "Conversation", "Title", or similar filler.',
  '- Match the language of the conversation.',
  '',
  'Return only the title.',
].join('\n')
