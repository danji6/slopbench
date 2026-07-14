import { createClient } from '@convex-dev/better-auth'
import type { GenericCtx } from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { betterAuth } from 'better-auth'
import { username } from 'better-auth/plugins'

import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { query } from './_generated/server'
import authConfig from './auth.config'

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
      requireEmailVerification: false,
      disableSignUp: process.env.DISABLE_SIGNUP === 'true',
    },
    plugins: [convex({ authConfig: getAuthConfig(siteUrl) }), username()],
  })
}

function getTrustedOrigins(
  siteUrl: string,
  origin: string | null | undefined,
): string[] {
  const trustAll = process.env.TRUST_ALL_ORIGINS === 'true'
  const dynamicOrigin =
    trustAll || isLocalNetworkUrl(siteUrl) ? origin : undefined

  return Array.from(
    new Set(
      [
        process.env.FRONTEND_URL ?? 'http://localhost:5173',
        dynamicOrigin,
      ].filter((value): value is string => Boolean(value)),
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

function isLocalNetworkUrl(value: string): boolean {
  const { hostname } = new URL(value)

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1'
  ) {
    return true
  }

  if (hostname.endsWith('.local')) {
    return true
  }

  const octets = hostname.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet))) {
    return false
  }

  const [a, b] = octets
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  )
}
