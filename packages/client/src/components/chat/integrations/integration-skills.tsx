import { RippleButton, SettingsSwitch } from '@/components/ui'
import { useIntegrationSkills } from '@/hooks/chat/integration-skills'
import { integrationDisabledSkills } from '@/lib/chat/integrations'
import type {
  IntegrationCardFeedback,
  IntegrationView,
} from '@/lib/chat/integrations'

import { IntegrationFeedback } from './integration-feedback'

type Props = {
  row: IntegrationView
  busy?: boolean
  feedback?: IntegrationCardFeedback
  onChange: (enabled: boolean, disabled: string[], name?: string) => void
}

/** Previews sibling metadata on request and keeps skill controls independent of process activation. */
export function IntegrationSkills({ row, busy, feedback, onChange }: Props) {
  const { page, loading, error, load } = useIntegrationSkills(row._id)

  function toggle(name: string, enabled: boolean) {
    const disabled = integrationDisabledSkills(
      row.disabledSkills,
      name,
      enabled,
    )
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
              <IntegrationFeedback
                feedback={feedback?.[`skill:${skill.name}`]}
              />
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
