import { RippleButton, SettingsList } from '@/components/ui'
import { useProjectToolkits } from '@/hooks/chat/project-toolkits'
import type { Id } from '@cv/convex/_generated/dataModel'

type Props = { sessionId: Id<'sessions'>; hasEnabledSources: boolean }

/** Discovers project toolkits and offers separate registration. */
export function ProjectToolkits({ sessionId, hasEnabledSources }: Props) {
  const { admin, rows, busy, message, scan, register } = useProjectToolkits(sessionId) // prettier-ignore

  if (!admin) return null
  return (
    <SettingsList.Item
      orientation="vertical"
      unclickable
      label="Toolkits"
      description="Discover skills and MCP tools in sources with discovery enabled."
    >
      <RippleButton
        variant="input"
        size="sm"
        disabled={busy || !hasEnabledSources}
        onClick={scan}
      >
        Discover
      </RippleButton>
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
    </SettingsList.Item>
  )
}
