import { ConfirmDialog } from '@/components/ui'
import {
  useIsSessionOwner,
  useRemoveMember,
  useSessionMembers,
} from '@/hooks/chat'
import { FALLBACK_DISPLAY_NAME } from '@sb/core/const'
import type { Id } from '@sb/convex/_generated/dataModel'
import { useState } from 'react'

import { ParticipantList } from './participant-list'
import { SessionMemberItem } from './session-member-item'

export function SessionMemberList() {
  const members = useSessionMembers()
  const isOwner = useIsSessionOwner()
  const remove = useRemoveMember()
  const [pending, setPending] = useState<Id<'users'> | null>(null)

  return (
    <>
      <ParticipantList
        items={members}
        getKey={({ membership }) => membership._id}
        getSearchText={({ settings }) =>
          settings?.displayName ?? FALLBACK_DISPLAY_NAME
        }
        emptyLabel="No members."
        renderItem={(member) => (
          <SessionMemberItem
            member={member}
            canRemove={isOwner && member.membership.role !== 'owner'}
            onRemove={() => setPending(member.membership.userId)}
          />
        )}
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Remove member?"
        description="They will immediately lose access to this session."
        confirmText="Remove"
        variant="destructive"
        onConfirm={() => {
          if (pending) void remove(pending)
          setPending(null)
        }}
      />
    </>
  )
}
