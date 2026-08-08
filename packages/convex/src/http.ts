import { httpRouter } from 'convex/server'
import { ConvexError } from 'convex/values'

import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { httpAction } from './_generated/server'
import { uploadAvatar } from './actions/io/avatar'
import { createAuth } from './auth'
import { type ErrorPayload, extractErrorMessage } from './errors'
import { authorizeAdmin } from './functions'
import { sidecarUrl } from './model/sidecar'
import { isAllowedOrigin, siteUrl } from './origins'

const http = httpRouter()

// httpActions cap a response body at 20 MiB, so we recycle the connection
// once it goes above this limit
const STREAM_BYTE_BUDGET = 8 * 1024 * 1024

/**
 * The origin to answer with, or `null` when the caller is not allowed one.
 * A same-origin request carries no `Origin` header and needs no CORS headers.
 */
function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get('Origin')
  if (!origin) return null

  return isAllowedOrigin(origin, req.url) ? origin : null
}

const corsHeaders = (origin: string | null) => ({
  ...(origin
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
      }
    : {}),
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  Vary: 'Origin',
})

const authHandler = httpAction(async (ctx, req) => {
  const origin = allowedOrigin(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const auth = createAuth(ctx, {
    siteUrl: siteUrl(req.url),
    trustedOrigin: origin,
  })
  const response = await auth.handler(req)

  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(corsHeaders(origin))) {
    headers.set(k, v)
  }

  return new Response(response.body, { status: response.status, headers })
})

// Convex does OIDC discovery at {issuer}/.well-known/openid-configuration.
// The actual endpoint is at /api/auth/convex/.well-known/openid-configuration,
// so we proxy the standard path to it.
const oidcDiscoveryHandler = httpAction(async (ctx, req) => {
  const auth = createAuth(ctx, { siteUrl: siteUrl(req.url) })
  const url = new URL(req.url)
  url.pathname = '/api/auth/convex/.well-known/openid-configuration'
  return auth.handler(new Request(url.toString(), req))
})

const avatarUploadHandler = httpAction(async (ctx, req) => {
  const origin = allowedOrigin(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    return jsonResponse({ error: 'Unauthorized' }, 401, origin)
  }

  const form = await req.formData()
  const target = form.get('target')
  const file = form.get('file')

  if (!(file instanceof Blob)) {
    return jsonResponse({ error: 'Missing file' }, 400, origin)
  }

  try {
    if (target === 'profile') {
      const result = await uploadAvatar(ctx, { target: 'profile', file })
      return jsonResponse(result, 200, origin)
    }

    const agentId = form.get('agentId')
    if (typeof agentId !== 'string') {
      return jsonResponse({ error: 'Missing agentId' }, 400, origin)
    }

    const result = await uploadAvatar(ctx, {
      target: 'agent',
      agentId: agentId as Id<'agents'>,
      file,
    })
    return jsonResponse(result, 200, origin)
  } catch (error) {
    return jsonResponse({ error: extractErrorMessage(error) }, 500, origin)
  }
})

/**
 * Streams a terminal's live output to the browser by proxying the
 * sidecar SSE endpoint. The client reconnects with its last offset.
 */
const termStreamHandler = httpAction(async (ctx, req) => {
  const origin = allowedOrigin(req)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  const jobId = url.searchParams.get('jobId')
  const offset = url.searchParams.get('offset') ?? '0'
  if (!sessionId || !jobId) {
    return jsonResponse({ error: 'Missing sessionId or jobId' }, 400, origin)
  }

  try {
    const identity = await authorizeAdmin(ctx)
    await ctx.runQuery(internal.sessions._getMemberWorkspaceContext, {
      sessionId: sessionId as Id<'sessions'>,
      subject: identity.subject,
    })
  } catch (error) {
    const code =
      error instanceof ConvexError
        ? ((error.data as ErrorPayload).code ?? 403)
        : 401
    return jsonResponse({ error: 'Unauthorized' }, code, origin)
  }

  const query = new URLSearchParams({
    sessionId,
    jobId,
    offset,
    maxBytes: String(STREAM_BYTE_BUDGET),
  })
  let upstream: Response
  try {
    upstream = await fetch(`${sidecarUrl()}/shell/stream?${query.toString()}`, {
      headers: { Accept: 'text/event-stream' },
      signal: req.signal,
    })
  } catch {
    return jsonResponse({ error: 'Sidecar unavailable' }, 502, origin)
  }

  if (!upstream.ok || !upstream.body) {
    return jsonResponse({ error: 'Stream failed' }, upstream.status, origin)
  }

  // Pass the SSE bytes through, preserving event frames and pings
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})

function jsonResponse(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
    },
  })
}

http.route({
  pathPrefix: '/api/auth/',
  method: 'GET',
  handler: authHandler,
})

http.route({
  pathPrefix: '/api/auth/',
  method: 'POST',
  handler: authHandler,
})

http.route({
  pathPrefix: '/api/auth/',
  method: 'OPTIONS',
  handler: authHandler,
})

http.route({
  path: '/.well-known/openid-configuration',
  method: 'GET',
  handler: oidcDiscoveryHandler,
})

http.route({
  path: '/io/avatar/upload',
  method: 'POST',
  handler: avatarUploadHandler,
})

http.route({
  path: '/io/avatar/upload',
  method: 'OPTIONS',
  handler: avatarUploadHandler,
})

http.route({
  path: '/shell/stream',
  method: 'GET',
  handler: termStreamHandler,
})

http.route({
  path: '/shell/stream',
  method: 'OPTIONS',
  handler: termStreamHandler,
})

export default http
