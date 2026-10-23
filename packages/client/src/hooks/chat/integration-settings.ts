import { optimisticallyUpdateIntegrationSkills } from '@/lib/chat/integration-optimistic'
import type {
  IntegrationCardFeedback,
  IntegrationCommand,
  IntegrationFeedback,
  IntegrationView,
} from '@/lib/chat/integrations'
import { extractErrorMessage } from '@/lib/errors'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useAction, useMutation } from 'convex/react'
import { useState } from 'react'

import { useIsAdmin } from './tools'

type CommandOptions<T> = {
  message?: string | ((result: T) => string)
  blockControls?: boolean
}

/** Coordinates owner integration commands separately from their settings presentation. */
export function useIntegrationSettings() {
  const admin = useIsAdmin()
  const rows = useQuery(api.integrations.list, admin ? {} : 'skip')
  const link = useAction(api.actions.integrations.link)
  const refresh = useAction(api.actions.integrations.refresh)
  const settings = useMutation(api.integrations.settings).withOptimisticUpdate(optimisticallyUpdateIntegrationSkills) // prettier-ignore
  const remove = useMutation(api.integrations.remove)
  const [busy, setBusy] = useState(false)
  const [linkFeedback, setLinkFeedback] = useState<IntegrationFeedback>()
  const [cardFeedback, setCardFeedback] = useState<Record<string, IntegrationCardFeedback>>({}) // prettier-ignore

  async function run<T>(
    operation: () => Promise<T>,
    report: (feedback?: IntegrationFeedback) => void,
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
    row: IntegrationView,
    action: keyof IntegrationCardFeedback,
    clearCard = false,
  ) {
    return (feedback?: IntegrationFeedback) => {
      setCardFeedback((current) => {
        const next = { ...current }
        const card: IntegrationCardFeedback = clearCard
          ? {}
          : { ...next[row._id] }
        if (feedback) card[action] = feedback
        else delete card[action]
        if (Object.keys(card).length) next[row._id] = card
        else delete next[row._id]
        return next
      })
    }
  }

  function command(row: IntegrationView, command: IntegrationCommand) {
    const integrationId = row._id
    const report = reporter(row, command, true)
    if (command === 'remove') {
      void run(() => remove({ integrationId }), report)
      return
    }
    void run(() => refresh({ integrationId }), report, {
      message: ({ changed }) =>
        changed
          ? 'Manifest changed. Updated configuration applied.'
          : 'Manifest refreshed.',
    })
  }

  function skills(
    row: IntegrationView,
    skillsEnabled: boolean,
    disabledSkills: string[],
    name?: string,
  ) {
    return run(
      () =>
        settings({
          integrationId: row._id,
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
