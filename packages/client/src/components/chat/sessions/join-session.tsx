import { Dialog, Input, QuickTooltip, RippleButton } from '@/components/ui'
import type { RippleButtonProps } from '@/components/ui'
import { useRedeemToken } from '@/hooks/chat/sharing'
import { toast } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { Loader2Icon, LogInIcon } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'wouter'

type JoinSessionButtonProps = RippleButtonProps & {
  collapsed?: boolean
}

export function JoinSessionButton({
  collapsed,
  className,
  onClick,
  ...props
}: JoinSessionButtonProps) {
  const [open, setOpen] = useState(false)

  const button = (
    <RippleButton
      {...props}
      variant={collapsed ? 'stealth' : 'outline'}
      size="icon"
      aria-label="Join session"
      onClick={(e) => {
        onClick?.(e)
        setOpen(true)
      }}
      className={cn(!collapsed && 'h-11 w-full justify-center', className)}
    >
      <LogInIcon />
    </RippleButton>
  )

  return (
    <>
      {collapsed ? (
        button
      ) : (
        <QuickTooltip text="Join Session">{button}</QuickTooltip>
      )}
      <JoinSession open={open} onOpenChange={setOpen} />
    </>
  )
}

interface JoinSessionProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function JoinSession({ open, onOpenChange }: JoinSessionProps) {
  const [, navigate] = useLocation()
  const redeem = useRedeemToken()
  const [token, setToken] = useState('')
  const [isJoining, setIsJoining] = useState(false)

  async function handleJoin() {
    const trimmed = token.trim()
    if (!trimmed || isJoining) return
    setIsJoining(true)
    try {
      const sessionId = await redeem(trimmed)
      if (!sessionId) {
        toast.error('That invite token is invalid or has been revoked.')
        return
      }
      setToken('')
      onOpenChange(false)
      navigate(`/?id=${sessionId}`, { replace: true })
    } catch {
      toast.error('Could not join the session. Check the token and try again.')
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content showCloseButton={false}>
        <Dialog.Header>
          <Dialog.Title>Join a session</Dialog.Title>
          <Dialog.Description className="text-muted-foreground">
            Paste an invite token to join a shared session.
          </Dialog.Description>
        </Dialog.Header>
        <div className="py-4">
          <Input
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleJoin()
              if (e.key === 'Escape') onOpenChange(false)
            }}
            placeholder="Invite token"
            disabled={isJoining}
            className="h-9 font-mono text-xs"
          />
        </div>
        <Dialog.Footer>
          <RippleButton
            variant="surface"
            onClick={() => onOpenChange(false)}
            disabled={isJoining}
          >
            Cancel
          </RippleButton>
          <RippleButton
            variant="primary"
            onClick={() => void handleJoin()}
            disabled={isJoining || !token.trim()}
          >
            {isJoining ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              'Join'
            )}
          </RippleButton>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  )
}
