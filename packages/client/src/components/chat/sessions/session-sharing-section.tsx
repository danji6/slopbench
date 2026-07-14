import { Button, CopyButton, Input, SettingsList } from '@/components/ui'
import {
  useCreateOrRotateToken,
  useRevokeToken,
  useSessionShares,
} from '@/hooks/chat/sharing'
import { useState } from 'react'

export function SessionSharingSection() {
  const shares = useSessionShares()
  const createOrRotate = useCreateOrRotateToken()
  const revoke = useRevokeToken()
  const [token, setToken] = useState<string | null>(null)

  const active = shares?.find((share) => share.revokedAt === undefined)

  const handleCreate = async () => {
    const result = await createOrRotate()
    if (result) setToken(result.token)
  }

  return (
    <SettingsList>
      <SettingsList.Item
        orientation="vertical"
        unclickable
        label="Invite token"
        description={
          active ? 'An invite token is active.' : 'No active invite token.'
        }
      >
        {token && (
          <div className="flex w-full flex-col gap-1.5">
            <p className="text-muted-foreground text-xs">
              {"Copy this token. It won't be shown again."}
            </p>
            <div className="flex items-center gap-1.5">
              <Input readOnly value={token} className="font-mono text-xs" />
              <CopyButton value={token} />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="input"
            size="sm"
            onClick={() => void handleCreate()}
          >
            {active ? 'Rotate token' : 'Create token'}
          </Button>
          {active && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void revoke(active._id)
                setToken(null)
              }}
            >
              Revoke
            </Button>
          )}
        </div>
      </SettingsList.Item>
    </SettingsList>
  )
}
