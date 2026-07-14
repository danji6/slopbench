import { authClient } from '@/lib/auth/client'
import { getConvexClientUrl } from '@/lib/auth/site-url'
import { ConvexBetterAuthProvider } from '@convex-dev/better-auth/react'
import type { AuthClient } from '@convex-dev/better-auth/react'
import { ConvexQueryCacheProvider } from 'convex-helpers/react/cache'
import { ConvexReactClient } from 'convex/react'

const convex = new ConvexReactClient(
  getConvexClientUrl({
    CURRENT_ORIGIN: window.location.origin,
    VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
  }),
)

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ConvexBetterAuthProvider
      client={convex}
      authClient={authClient as unknown as AuthClient} // TODO temporary versioning fix
    >
      <ConvexQueryCacheProvider>{children}</ConvexQueryCacheProvider>
    </ConvexBetterAuthProvider>
  )
}
