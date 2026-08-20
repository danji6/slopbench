export const KNOWN_PROVIDER_TYPES = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'alibaba', label: 'Alibaba' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'moonshotai', label: 'MoonshotAI' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'qwen', label: 'QwenCloud' },
] as const

export type KnownProviderType = (typeof KNOWN_PROVIDER_TYPES)[number]
