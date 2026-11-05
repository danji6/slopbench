import {
  RippleButton,
  SettingsCollapsible,
  SettingsSwitch,
  TrashButton,
} from '@/components/ui'
import type {
  ToolkitCardFeedback,
  ToolkitCommand,
  ToolkitView,
} from '@/lib/chat/toolkits'

import { ToolkitBindings } from './toolkit-bindings'
import { ToolkitFeedback } from './toolkit-feedback'
import { ToolkitSkills } from './toolkit-skills'

type Props = {
  row: ToolkitView
  busy?: boolean
  feedback?: ToolkitCardFeedback
  onCommand: (command: ToolkitCommand) => void
  onSkills: (enabled: boolean, disabled: string[], name?: string) => void
}

/** Shows toolkit availability and refresh feedback without launching tools. */
export function ToolkitCard({
  row,
  busy,
  feedback,
  onCommand,
  onSkills,
}: Props) {
  return (
    <article aria-label={`${row.name} toolkit`}>
      <SettingsCollapsible
        label={row.name}
        contentClassName="gap-3 pb-3"
        actions={
          <>
            <span className="text-muted-foreground rounded-full bg-black/10 px-4 py-2 text-xs whitespace-nowrap">
              {row.status === 'ready' ? 'Ready' : 'Unavailable'}
            </span>
            <div className="flex max-w-48 flex-col items-end gap-1">
              <TrashButton
                aria-label={`Remove ${row.name} link`}
                title="Remove link"
                disabled={busy}
                onClick={() => onCommand('remove')}
              />
              <ToolkitFeedback feedback={feedback?.remove} />
            </div>
          </>
        }
      >
        <p className="text-muted-foreground text-xs break-all">{row.root}</p>
        <div className="flex flex-col items-start gap-1">
          <RippleButton
            variant="input"
            size="sm"
            disabled={busy}
            onClick={() => onCommand('refresh')}
          >
            Refresh manifest
          </RippleButton>
          <ToolkitFeedback
            feedback={
              row.diagnostic
                ? { message: row.diagnostic, error: row.status === 'missing' }
                : feedback?.refresh
            }
          />
        </div>
        <ToolkitBindings toolkitId={row._id} />
        <SettingsSwitch
          label="Include skills"
          reserveActionSpace={false}
          checked={row.skillsEnabled}
          disabled={busy}
          onCheckedChange={(on) => onSkills(on, row.disabledSkills)}
        />
        <ToolkitFeedback feedback={feedback?.skills} />
        <ToolkitSkills
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
