import { createClient } from '@convex-dev/better-auth'
import type { GenericCtx } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@sb/core/auth'
import { betterAuth } from 'better-auth'
import { username } from 'better-auth/plugins'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { query } from './_generated/server'
import authConfig from './auth.config'
import { frontendUrl, isAllowedOrigin } from './origins'

export const authComponent = createClient<DataModel>(components.betterAuth)

type AuthOptions = {
  siteUrl?: string
  trustedOrigin?: string | null
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.getAuthUser(ctx),
})

export const canSignUp = query({
  args: {},
  handler: () => process.env.DISABLE_SIGNUP !== 'true',
})

export function createAuth(
  ctx: GenericCtx<DataModel>,
  options: AuthOptions = {},
) {
  const siteUrl =
    options.siteUrl ?? process.env.SITE_URL ?? 'http://localhost:3211'

  return betterAuth({
    baseURL: siteUrl,
    trustedOrigins: getTrustedOrigins(siteUrl, options.trustedOrigin),
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      requireEmailVerification: false,
      disableSignUp: process.env.DISABLE_SIGNUP === 'true',
    },
    rateLimit: {
      enabled: false, // done through our own HTTP handlers
    },
    plugins: [convex({ authConfig: getAuthConfig(siteUrl) }), username()],
  })
}

function getTrustedOrigins(
  siteUrl: string,
  origin: string | null | undefined,
): string[] {
  const dynamicOrigin =
    origin && isAllowedOrigin(origin, siteUrl) ? origin : undefined

  return Array.from(
    new Set(
      [frontendUrl(), dynamicOrigin].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  )
}

function getAuthConfig(siteUrl: string): typeof authConfig {
  return {
    ...authConfig,
    providers: authConfig.providers.map((provider) => ({
      ...provider,
      domain: siteUrl,
    })),
  }
}
