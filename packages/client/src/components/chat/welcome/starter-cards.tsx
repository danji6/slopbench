import { RippleButton } from '@/components/ui'
import type { ComposerHandle } from '@/hooks/chat/composer-editor'
import {
  BugIcon,
  FileTextIcon,
  FolderSearchIcon,
  ListChecksIcon,
  PencilLineIcon,
} from 'lucide-react'
import type { RefObject } from 'react'

const projectStarters = [
  {
    title: 'Explore the project',
    description: 'Find your way around',
    icon: FolderSearchIcon,
    prompt: 'Help me understand how this project is organized.',
  },
  {
    title: 'Plan a change',
    description: 'Turn an idea into steps',
    icon: ListChecksIcon,
    prompt: 'Help me plan this change: ',
  },
  {
    title: 'Investigate an issue',
    description: 'Work through a problem',
    icon: BugIcon,
    prompt: 'Help me investigate this issue: ',
  },
]

const generalStarters = [
  {
    title: 'Work with a file',
    description: 'Get a summary, feedback, or answers',
    icon: FileTextIcon,
    prompt: null,
  },
  {
    title: 'Improve a draft',
    description: 'Make your writing clearer',
    icon: PencilLineIcon,
    prompt: 'Help me improve this draft: ',
  },
  {
    title: 'Make a plan',
    description: 'Turn a goal into practical steps',
    icon: ListChecksIcon,
    prompt: 'Help me make a plan for: ',
  },
]

type StarterCardsProps = {
  project: boolean
  disabled: boolean
  composerRef: RefObject<ComposerHandle | null>
}

export function StarterCards({
  project,
  disabled,
  composerRef,
}: StarterCardsProps) {
  const starters = project ? projectStarters : generalStarters
  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,175px),1fr))] gap-3 pt-7 pb-1"
      aria-label="Conversation starters"
    >
      {starters.map(({ title, description, icon: Icon, prompt }) => (
        <RippleButton
          key={title}
          variant="input"
          disabled={disabled}
          onClick={() => {
            if (prompt === null) composerRef.current?.openAttachments()
            else composerRef.current?.insertStarter(prompt)
          }}
          className="h-auto min-w-0 flex-col items-start justify-start gap-2 rounded-2xl p-4 text-left whitespace-normal"
        >
          <Icon className="text-primary mb-1 size-5" />
          <span className="font-medium wrap-anywhere">{title}</span>
          <span className="text-muted-foreground text-xs font-normal wrap-anywhere">
            {description}
          </span>
        </RippleButton>
      ))}
    </div>
  )
}
