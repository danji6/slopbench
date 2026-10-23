import { RippleButton } from '@/components/ui'
import { useProjectIntegrations } from '@/hooks/chat/project-integrations'
import type { Id } from '@sb/convex/_generated/dataModel'

type Props = { sessionId: Id<'sessions'> }

/** Discovers opted-in project roots, with separate explicit registration. */
export function ProjectIntegrations({ sessionId }: Props) {
  const { admin, rows, busy, message, scan, register } = useProjectIntegrations(sessionId) // prettier-ignore

  if (!admin) return null
  return (
    <div className="flex flex-col gap-2 p-2">
      <RippleButton variant="input" disabled={busy} onClick={scan}>
        Discover
      </RippleButton>
      <p className="text-muted-foreground text-xs">
        Only sources with “Discover integrations” enabled are inspected.
      </p>
      {rows.map((row) => (
        <div key={row.root} className="flex flex-col gap-1 text-xs">
          <span>
            {row.label}: {row.snapshot?.manifest.name ?? row.diagnostic}
          </span>
          {row.snapshot && (
            <RippleButton
              size="sm"
              disabled={busy}
              onClick={() => register(row.root)}
            >
              Link {row.snapshot.manifest.name}
            </RippleButton>
          )}
        </div>
      ))}
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </div>
  )
}
