import type { ProviderFormValues } from '@/components/chat/entities/user/settings-schema'
import { modelReference } from '@sb/core/model-reference'
import type { ConvexReactClient } from 'convex/react'
import { type FunctionReference, getFunctionName } from 'convex/server'
import { type Value, convexToJson, jsonToConvex } from 'convex/values'

const listeners = new Set<() => void>()
const cache = new Map<string, unknown>()
const settings: Record<string, unknown> = {}
type Row = ProviderFormValues & {
  _id: string
  ownerId: string
  identityKey?: string
}
let rows: Row[] = [
  {
    _id: 'personal',
    connectionId: 'personal',
    ownerId: 'owner',
    id: 'openai',
    name: 'Personal API',
    auth: 'apiKey',
    hasKey: true,
    enabled: true,
    configRevision: 0,
    models: [{ id: 'same', label: 'Same model' }],
  },
]
let failure = false
let connected = false
const models = [
  { id: 'same', label: 'Same model' },
  { id: 'new', label: 'New discovered model', contextWindow: 100000 },
]
function update() {
  cache.clear()
  for (const listener of listeners) listener()
}
function query(name: string, args: Record<string, unknown>) {
  if (name === 'settings:get') return { ...settings }
  if (name === 'providers:list') return rows
  if (name === 'providers:get')
    return rows.find((row) => row._id === args.providerId)
  if (name === 'providers:catalog' || name === 'providers:previewCatalog')
    return {
      models,
      refreshedAt: 1,
      error: failure ? 'Provider unavailable' : undefined,
    }
  if (name === 'models:list')
    return {
      models: rows.flatMap((row) =>
        row.enabled
          ? row.models.map((model) => ({
              ...model,
              label: model.label ?? model.discovered?.label,
              id: modelReference(row._id, model.id),
              connectionId: row._id,
              connectionName: row.name,
            }))
          : [],
      ),
    }
  return null
}
export function failProviderDiscovery() {
  failure = true
  update()
}
function create(args: Record<string, unknown>) {
  const id = `connection-${rows.length}`
  const { apiKey, key, clientId, ...fields } = args
  rows.push({
    ...fields,
    id: key,
    name: fields.name || 'OpenAI',
    identityKey: clientId,
    hasKey: !!apiKey,
    _id: id,
    connectionId: id,
    ownerId: 'owner',
    configRevision: 0,
  } as Row)
  return id
}
export const providerConnectionsClient = {
  watchQuery(
    reference: FunctionReference<'query'>,
    args: Record<string, unknown> = {},
  ) {
    const name = getFunctionName(reference)
    const key = name + JSON.stringify(args)
    return {
      onUpdate(callback: () => void) {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
      localQueryResult() {
        if (!cache.has(key)) cache.set(key, query(name, args))
        return cache.get(key)
      },
      localQueryLogs: () => [],
      journal: () => undefined,
    }
  },
  async mutation(
    reference: FunctionReference<'mutation'>,
    input: Record<string, Value>,
  ) {
    const args = jsonToConvex(convexToJson(input)) as typeof input
    const name = getFunctionName(reference)
    if (name === 'settings:update') {
      Object.assign(settings, args.patch)
      update()
      return
    }
    if (name === 'settings:remove') {
      delete settings[args.key as string]
      update()
      return
    }
    if (
      name === 'prompts:replaceScope' ||
      name === 'reminders:replaceScope' ||
      name === 'mcp:replaceAll'
    )
      return
    if (name === 'providers:ensureConnection') {
      const existing = rows.find((row) => row.identityKey === args.clientId)
      const id =
        existing?._id ?? create({ ...args, enabled: false, models: [] })
      update()
      return id
    }
    if (name === 'providers:save') {
      const removed = args.removed as { providerId: string }[]
      rows = rows.filter(
        (row) => !removed.some((item) => item.providerId === row._id),
      )
      const result = (args.connections as Record<string, unknown>[]).map(
        (input) => {
          const id = (input.providerId as string) || create(input)
          rows = rows.map((row) =>
            row._id === id
              ? ({
                  ...row,
                  ...input,
                  id: input.key,
                  configRevision: (row.configRevision ?? 0) + 1,
                } as Row)
              : row,
          )
          return {
            clientId: input.clientId,
            providerId: id,
            configRevision: rows.find((row) => row._id === id)!.configRevision,
          }
        },
      )
      update()
      return result
    }
    throw new Error(`Unexpected fixture mutation: ${name}`)
  },
  async action(reference: FunctionReference<'action'>) {
    const name = getFunctionName(reference)
    if (name.endsWith(':discover'))
      return {
        attemptId: 'manual',
        error: failure ? 'Model discovery failed.' : undefined,
      }
    if (name.endsWith(':preview')) return { previewId: 'preview', models }
    if (name.endsWith(':status'))
      return {
        status: connected ? 'connected' : 'disconnected',
        planEnabled: connected,
        email: 'fixture@example.test',
      }
    if (name.endsWith(':signIn')) {
      connected = true
      return { url: 'about:blank', expiresAt: Date.now() + 300000 }
    }
    if (name.endsWith(':disconnect')) {
      connected = false
      return { revoked: true }
    }
    throw new Error(`Unexpected fixture action: ${name}`)
  },
} as unknown as ConvexReactClient
