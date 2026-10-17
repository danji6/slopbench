import type { Id } from '@sb/convex/_generated/dataModel'
import { providerFeatures } from '@sb/core/provider-registry'
import { Suspense, lazy } from 'react'

const ChatGPTConnection = lazy(() =>
  import('./openai/sign-in').then((module) => ({
    default: module.ChatGPTConnection,
  })),
)

type Props = {
  provider: string
  auth?: 'apiKey' | 'chatgpt'
  providerId?: Id<'modelProviders'>
  ensureConnection: () => Promise<Id<'modelProviders'>>
  onConnected: () => Promise<void>
}

const controls = { chatgpt: ChatGPTConnection }

export function AccountControls({
  provider,
  auth = 'apiKey',
  ...props
}: Props) {
  if (!providerFeatures(provider, auth).accountSignIn) return null
  const Component = controls[auth as keyof typeof controls]
  return Component ? (
    <Suspense fallback={<p>Loading account controls…</p>}>
      <Component {...props} />
    </Suspense>
  ) : null
}
