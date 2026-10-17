import type { InferenceAdapter } from './inferenceTypes'

const adapters: Record<string, () => Promise<{ create: InferenceAdapter }>> = {
  anthropic: () => import('./anthropic/inference'),
  alibaba: () => import('./alibaba/inference'),
  deepseek: () => import('./deepseek/inference'),
  mistral: () => import('./mistral/inference'),
  moonshotai: () => import('./moonshotai/inference'),
  openai: () => import('./openai/inference'),
  openrouter: () => import('./openrouter/inference'),
  ollama: () => import('./ollama/inference'),
}
export async function inferenceAdapter(
  provider: string,
): Promise<InferenceAdapter> {
  const load = adapters[provider] ?? (() => import('./compatible/inference'))
  return (await load()).create
}
