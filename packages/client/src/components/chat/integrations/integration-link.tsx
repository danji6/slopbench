import { WorkspacePickerDialog } from '@/components/chat/sessions/workspace-picker-dialog'
import { Input, RippleButton } from '@/components/ui'
import type { IntegrationFeedback as Feedback } from '@/lib/chat/integrations'
import { useState } from 'react'

import { IntegrationFeedback } from './integration-feedback'

type Props = {
  busy?: boolean
  feedback?: Feedback
  onLink: (root: string) => void
}

/** Collects the toolkit directory for an explicit link request. */
export function IntegrationLink({ busy, feedback, onLink }: Props) {
  const [root, setRoot] = useState('')
  const [browsing, setBrowsing] = useState(false)

  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        <Input
          className="min-w-48 flex-1"
          aria-label="Toolkit directory"
          placeholder="Toolkit directory"
          value={root}
          onValueChange={setRoot}
        />
        <RippleButton
          type="button"
          variant="input"
          disabled={busy}
          onClick={() => setBrowsing(true)}
        >
          Browse
        </RippleButton>
        <div className="flex max-w-sm flex-col items-start gap-1">
          <RippleButton
            type="button"
            disabled={busy || !root.trim()}
            onClick={() => onLink(root.trim())}
          >
            Link
          </RippleButton>
          <IntegrationFeedback feedback={feedback} />
        </div>
      </div>
      <WorkspacePickerDialog
        open={browsing}
        onOpenChange={setBrowsing}
        title="Select a toolkit directory"
        initialPath={root.trim()}
        onSelect={setRoot}
      />
    </>
  )
}
