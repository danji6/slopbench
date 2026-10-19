import { convexClient } from '@convex-dev/better-auth/client/plugins'
import { APP_ID } from '@sb/core/const'
import { getGlobalBroadcastChannel } from 'better-auth/client'
import { usernameClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { getAuthSiteUrl } from './site-url'

// Set the shared channel name before session subscriptions initialize it.
getGlobalBroadcastChannel(`${APP_ID}-better-auth.message`)

export const authClient = createAuthClient({
  baseURL: getAuthSiteUrl({
    CURRENT_ORIGIN: window.location.origin,
    VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL,
    VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
  }),
  fetchOptions: { credentials: 'include' },
  plugins: [convexClient(), usernameClient()],
})

export const { useSession, signIn, signOut, signUp, changePassword } =
  authClient
