export const KNOWN_PROVIDER_TYPES = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'ollama', label: 'Ollama' },
] as const

export type KnownProviderType = (typeof KNOWN_PROVIDER_TYPES)[number]
