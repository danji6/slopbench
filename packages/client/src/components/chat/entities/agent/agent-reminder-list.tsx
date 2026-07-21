import { AddFromLibrary, ReminderPromptList } from '@/components/chat/prompts'
import { useSettings } from '@/hooks/chat'
import type { ReminderPrompt } from '@/lib/chat'
import type { Control } from 'react-hook-form'
import { useController } from 'react-hook-form'

import type { AgentFormValues } from './agent-form'

type AgentReminderListProps = {
  control: Control<AgentFormValues>
}

export function AgentReminderList({ control }: AgentReminderListProps) {
  const settings = useSettings()
  const library = (settings?.libraryReminders ?? []) as ReminderPrompt[]

  const { field: remindersField } = useController({
    control,
    name: 'reminderPrompts',
  })
  const { field: libraryIdsField } = useController({
    control,
    name: 'libraryReminderIds',
  })

  const libraryIds = libraryIdsField.value
  const libraryById = new Map(library.map((r) => [r.id, r]))
  const referenced = libraryIds
    .map((id) => libraryById.get(id))
    .filter((r): r is ReminderPrompt => r !== undefined)
  const referencedIds = new Set(referenced.map((r) => r.id))
  const available = library.filter((r) => !referencedIds.has(r.id))

  function handleAddLibrary(id: string) {
    libraryIdsField.onChange([...libraryIds, id])
  }

  function handleRemoveLibrary(id: string) {
    libraryIdsField.onChange(libraryIds.filter((ref) => ref !== id))
  }

  return (
    <ReminderPromptList
      reminders={remindersField.value}
      onChange={remindersField.onChange}
      libraryItems={referenced}
      onRemoveLibrary={handleRemoveLibrary}
      extraButtons={
        library.length > 0 && (
          <AddFromLibrary
            items={available}
            onSelect={handleAddLibrary}
            searchPlaceholder="Search reminders..."
            emptyText="No reminders found."
          />
        )
      }
    />
  )
}
