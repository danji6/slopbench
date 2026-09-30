import { RippleButton, SettingsList } from '@/components/ui'
import { useActiveSession, useIsSessionOwner } from '@/hooks/chat'
import { useState } from 'react'

import { SessionFolderDialog } from './session-folder-dialog'

export function SessionWorkspaceSection() {
  const session = useActiveSession()
  const isOwner = useIsSessionOwner()
  const [moving, setMoving] = useState(false)
  return (
    <SettingsList>
      <SettingsList.Item
        orientation="vertical"
        unclickable
        label="Folder sources"
        description={
          session?.workspace ? (
            <div className="flex flex-col gap-1">
              <strong>{session.workspace.label}</strong>
              {session.workspace.sources?.map((source, index) => (
                <span
                  key={source.id}
                  className="truncate text-xs"
                  title={source.path}
                >
                  {source.path}
                  {index === 0 ? ' (Primary)' : ''}
                </span>
              ))}
            </div>
          ) : (
            'This session has no source directories.'
          )
        }
      >
        {isOwner && (
          <RippleButton
            variant="input"
            size="sm"
            onClick={() => setMoving(true)}
          >
            Move to folder…
          </RippleButton>
        )}
        {moving && session && (
          <SessionFolderDialog
            sessionId={session._id}
            folderId={session.folderId}
            onClose={() => setMoving(false)}
          />
        )}
      </SettingsList.Item>
    </SettingsList>
  )
}
