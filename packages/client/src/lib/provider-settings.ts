import type { ProviderFormValues } from '@/components/chat/entities/user/settings-schema'
import { providerSchema } from '@/components/chat/entities/user/settings-schema'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { ModelProviderView } from '@sb/convex/model/providers'

export function providerForm(
  connection: ModelProviderView,
): ProviderFormValues {
  return {
    ...connection,
    connectionId: connection._id,
    _clientId: connection.identityKey ?? connection._id,
    models: connection.models.map((model) => ({
      ...model,
      _clientId: `${connection._id}:${model.id}`,
    })),
  }
}

export function providerInput(value: ProviderFormValues) {
  const parsed = providerSchema.parse(value)
  return {
    key: parsed.id,
    auth: parsed.auth,
    name: parsed.name,
    baseURL: parsed.baseURL ?? '',
    extraHeaders: parsed.extraHeaders ?? '',
    enabled: parsed.enabled,
    apiKey: parsed.apiKey,
    models: parsed.models.map(({ _clientId: _, ...model }) => model),
  }
}

export function providerSaveInput(value: ProviderFormValues) {
  return {
    ...providerInput(value),
    clientId: value._clientId ?? value.connectionId!,
    providerId: value.connectionId as Id<'modelProviders'> | undefined,
    configRevision: value.configRevision,
    previewId: value.previewId as Id<'discoveryPreviews'> | undefined,
  }
}

export function networkChanged(
  before: ProviderFormValues,
  patch: Partial<ProviderFormValues>,
) {
  const fields = ['id', 'auth', 'apiKey', 'baseURL', 'extraHeaders'] as const
  return fields.some(
    (field) => field in patch && (before[field] ?? '') !== (patch[field] ?? ''),
  )
}
