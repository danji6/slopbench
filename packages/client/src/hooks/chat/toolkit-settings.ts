import { optimisticallyUpdateToolkitSkills } from '@/lib/chat/toolkit-optimistic'
import type {
  ToolkitCardFeedback,
  ToolkitCommand,
  ToolkitFeedback,
  ToolkitView,
} from '@/lib/chat/toolkits'
import { extractErrorMessage } from '@/lib/errors'
import { api } from '@cv/convex/_generated/api'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useAction, useMutation } from 'convex/react'
import { useState } from 'react'

import { useIsAdmin } from './tools'

type CommandOptions<T> = {
  message?: string | ((result: T) => string)
  blockControls?: boolean
}

/** Coordinates owner toolkit commands separately from their settings presentation. */
export function useToolkitSettings() {
  const admin = useIsAdmin()
  const rows = useQuery(api.toolkits.list, admin ? {} : 'skip')
  const link = useAction(api.actions.toolkits.link)
  const refresh = useAction(api.actions.toolkits.refresh)
  const settings = useMutation(api.toolkits.settings).withOptimisticUpdate(optimisticallyUpdateToolkitSkills) // prettier-ignore
  const remove = useMutation(api.toolkits.remove)
  const [busy, setBusy] = useState(false)
  const [linkFeedback, setLinkFeedback] = useState<ToolkitFeedback>()
  const [cardFeedback, setCardFeedback] = useState<Record<string, ToolkitCardFeedback>>({}) // prettier-ignore

  async function run<T>(
    operation: () => Promise<T>,
    report: (feedback?: ToolkitFeedback) => void,
    { message, blockControls = true }: CommandOptions<T> = {},
  ) {
    if (blockControls) setBusy(true)
    report()
    try {
      const result = await operation()
      const text = typeof message === 'function' ? message(result) : message
      report(text ? { message: text } : undefined)
    } catch (cause) {
      report({ message: extractErrorMessage(cause), error: true })
    } finally {
      if (blockControls) setBusy(false)
    }
  }

  function reporter(
    row: ToolkitView,
    action: keyof ToolkitCardFeedback,
    clearCard = false,
  ) {
    return (feedback?: ToolkitFeedback) => {
      setCardFeedback((current) => {
        const next = { ...current }
        const card: ToolkitCardFeedback = clearCard ? {} : { ...next[row._id] }
        if (feedback) card[action] = feedback
        else delete card[action]
        if (Object.keys(card).length) next[row._id] = card
        else delete next[row._id]
        return next
      })
    }
  }

  function command(row: ToolkitView, command: ToolkitCommand) {
    const toolkitId = row._id
    const report = reporter(row, command, true)
    if (command === 'remove') {
      void run(() => remove({ toolkitId }), report)
      return
    }
    void run(() => refresh({ toolkitId }), report, {
      message: ({ changed }) =>
        changed
          ? 'Manifest changed. Updated configuration applied.'
          : 'Manifest refreshed.',
    })
  }

  function skills(
    row: ToolkitView,
    skillsEnabled: boolean,
    disabledSkills: string[],
    name?: string,
  ) {
    return run(
      () =>
        settings({
          toolkitId: row._id,
          ...(name
            ? { skill: { name, enabled: !disabledSkills.includes(name) } }
            : { skillsEnabled }),
        }),
      reporter(row, name ? `skill:${name}` : 'skills'),
      { blockControls: false },
    )
  }

  return {
    admin,
    rows,
    busy,
    linkFeedback,
    cardFeedback,
    command,
    link: (root: string) => run(() => link({ root }), setLinkFeedback),
    skills,
  }
}
