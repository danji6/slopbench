import { RippleButton, SettingsSwitch } from '@/components/ui'
import { useToolkitSkills } from '@/hooks/chat/toolkit-skills'
import { toolkitDisabledSkills } from '@/lib/chat/toolkits'
import type { ToolkitCardFeedback, ToolkitView } from '@/lib/chat/toolkits'

import { ToolkitFeedback } from './toolkit-feedback'

type Props = {
  row: ToolkitView
  busy?: boolean
  feedback?: ToolkitCardFeedback
  onChange: (enabled: boolean, disabled: string[], name?: string) => void
}

/** Previews sibling metadata on request and keeps skill controls independent of process activation. */
export function ToolkitSkills({ row, busy, feedback, onChange }: Props) {
  const { page, loading, error, load } = useToolkitSkills(row._id)

  function toggle(name: string, enabled: boolean) {
    const disabled = toolkitDisabledSkills(row.disabledSkills, name, enabled)
    onChange(row.skillsEnabled, disabled, name)
  }

  return (
    <div className="flex flex-col gap-2">
      <RippleButton
        variant="input"
        size="sm"
        className="my-1"
        disabled={loading || busy}
        onClick={() => void load()}
      >
        Preview skills
      </RippleButton>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {page && (
        <>
          {page.entries.map((skill) => (
            <div key={skill.path} className="flex flex-col gap-1">
              <SettingsSwitch
                label={skill.name}
                reserveActionSpace={false}
                checked={!row.disabledSkills.includes(skill.name)}
                disabled={busy || !!skill.error}
                onCheckedChange={(enabled) => toggle(skill.name, enabled)}
                help={skill.description}
              />
              <ToolkitFeedback feedback={feedback?.[`skill:${skill.name}`]} />
              {skill.error && (
                <p role="alert" className="text-destructive text-xs">
                  {skill.error}
                </p>
              )}
            </div>
          ))}
          {page.nextOffset !== null && (
            <RippleButton
              type="button"
              size="sm"
              disabled={loading || busy}
              onClick={() => void load(page.nextOffset!)}
            >
              Next skill components
            </RippleButton>
          )}
        </>
      )}
    </div>
  )
}
