import {
  RippleButton,
  SettingsCollapsible,
  SettingsSwitch,
  TrashButton,
} from '@/components/ui'
import type {
  IntegrationCardFeedback,
  IntegrationCommand,
  IntegrationView,
} from '@/lib/chat/integrations'

import { IntegrationBindings } from './integration-bindings'
import { IntegrationFeedback } from './integration-feedback'
import { IntegrationSkills } from './integration-skills'

type Props = {
  row: IntegrationView
  busy?: boolean
  feedback?: IntegrationCardFeedback
  onCommand: (command: IntegrationCommand) => void
  onSkills: (enabled: boolean, disabled: string[], name?: string) => void
}

/** Shows integration availability and refresh feedback without launching tools. */
export function IntegrationCard({
  row,
  busy,
  feedback,
  onCommand,
  onSkills,
}: Props) {
  return (
    <article aria-label={`${row.name} integration`}>
      <SettingsCollapsible
        label={row.name}
        contentClassName="gap-3 pb-3"
        actions={
          <div className="flex max-w-48 flex-col items-end gap-1">
            <TrashButton
              aria-label={`Remove ${row.name} link`}
              title="Remove link"
              disabled={busy}
              onClick={() => onCommand('remove')}
            />
            <IntegrationFeedback feedback={feedback?.remove} />
          </div>
        }
      >
        <p className="text-muted-foreground text-xs break-all">{row.root}</p>
        <p className="text-muted-foreground text-xs">
          {row.status === 'ready' ? 'Ready' : 'Toolkit unavailable'}
        </p>
        <div className="flex flex-col items-start gap-1">
          <RippleButton
            variant="input"
            size="sm"
            disabled={busy}
            onClick={() => onCommand('refresh')}
          >
            Refresh manifest
          </RippleButton>
          <IntegrationFeedback
            feedback={
              row.diagnostic
                ? { message: row.diagnostic, error: row.status === 'missing' }
                : feedback?.refresh
            }
          />
        </div>
        <IntegrationBindings integrationId={row._id} />
        <SettingsSwitch
          label="Include skills"
          reserveActionSpace={false}
          checked={row.skillsEnabled}
          disabled={busy}
          onCheckedChange={(on) => onSkills(on, row.disabledSkills)}
        />
        <IntegrationFeedback feedback={feedback?.skills} />
        <IntegrationSkills
          key={row.revision}
          row={row}
          busy={busy}
          feedback={feedback}
          onChange={onSkills}
        />
        {row.cleanupPending > 0 && (
          <p role="status" className="text-muted-foreground text-xs">
            Cleaning up connections…
          </p>
        )}
      </SettingsCollapsible>
    </article>
  )
}
