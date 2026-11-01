/** Opaque transport state; never include this in public projections or logs. */
export type ProviderContinuity = { token: string; authRevision: string }

export type ProviderResponseMetadata = {
  continuity?: ProviderContinuity
  continuitySent: boolean
  continuityReset: boolean
  invalidContinuity: boolean
  requestId?: string
  model?: string
  status: number
}

export type ProviderRequestContext = {
  continuity?: ProviderContinuity
  onResponse?: (metadata: ProviderResponseMetadata) => Promise<void>
  onError?: () => Promise<void>
}

/** Lets provider adapters participate in the stream's scoped persistence policy. */
export type ProviderTransportObserver = (
  body: Record<string, unknown>,
) => Promise<ProviderRequestContext>

/** Accepts bounded header values without HTTP normalization changing their identity. */
export function isRoutingHeader(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 8192) return false
  if (!/^[\t\x20-\x7e\x80-\xff]+$/.test(value)) return false
  return (
    new Headers({ 'x-routing-state': value }).get('x-routing-state') === value
  )
}
