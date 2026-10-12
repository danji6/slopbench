import { RippleButton } from '@/components/ui'
import type { Doc } from '@sb/convex/_generated/dataModel'

export type SkillListItem =
  | Pick<Doc<'skills'>, '_id' | 'name' | 'description'>
  | Pick<Doc<'agentSkills'>, '_id' | 'name' | 'description'>

type SkillListProps = {
  items: SkillListItem[]
  actionLabel: string
  busy: boolean
  onAction: (item: SkillListItem) => void
}

export function SkillList({
  items,
  actionLabel,
  busy,
  onAction,
}: SkillListProps) {
  if (!items.length) {
    return (
      <p className="text-muted-foreground py-3 pl-4 text-sm">
        No skills on this page.
      </p>
    )
  }
  return (
    <ul className="divide-border divide-y">
      {items.map((item) => (
        <li key={item._id} className="flex items-start gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium wrap-break-word">
              {item.name || 'Installing skill…'}
            </p>
            <p className="text-muted-foreground text-sm wrap-break-word">
              {item.description}
            </p>
          </div>
          <RippleButton
            size="sm"
            variant="input"
            disabled={busy}
            onClick={() => onAction(item)}
          >
            {actionLabel}
          </RippleButton>
        </li>
      ))}
    </ul>
  )
}

export function SkillPageControls({
  canBack,
  back,
  isDone,
  next,
}: {
  canBack: boolean
  back: () => void
  isDone: boolean
  next: () => void
}) {
  if (!canBack && isDone) return null
  return (
    <div className="flex gap-2">
      <RippleButton
        size="sm"
        variant="input"
        disabled={!canBack}
        onClick={back}
      >
        Previous
      </RippleButton>
      <RippleButton size="sm" variant="input" disabled={isDone} onClick={next}>
        Next
      </RippleButton>
    </div>
  )
}
