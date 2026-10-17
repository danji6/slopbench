import { RippleButton } from '@/components/ui'
import { api } from '@sb/convex/_generated/api'
import type { Id } from '@sb/convex/_generated/dataModel'
import type { AccountStatus } from '@sb/convex/model/provider/openai/account'
import { useAction } from 'convex/react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

type Props = {
  providerId?: Id<'modelProviders'>
  ensureConnection: () => Promise<Id<'modelProviders'>>
  onConnected: () => Promise<void>
}

export function ChatGPTConnection({
  providerId,
  ensureConnection,
  onConnected,
}: Props) {
  const remoteSetup = useAction(api.actions.providerConnections.remoteSetup)
  const start = useAction(api.actions.providerConnections.signIn)
  const getStatus = useAction(api.actions.providerConnections.status)
  const disconnect = useAction(api.actions.providerConnections.disconnect)
  const cancel = useAction(api.actions.providerConnections.cancelSignIn)
  const [status, setStatus] = useState<AccountStatus>()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)

  const latest = useRef(onConnected)
  useEffect(() => {
    latest.current = onConnected
  }, [onConnected])

  useEffect(() => {
    const connectionId = providerId
    if (!connectionId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const next = await getStatus({ providerId: connectionId! })
        if (disposed) return
        setStatus(next)
        if (next.status === 'connected' && pending.current)
          await latest.current()
        pending.current = next.status === 'pending'
        timer = setTimeout(() => void poll(), pending.current ? 1500 : 5000)
      } catch {
        if (!disposed) timer = setTimeout(() => void poll(), 15000)
      }
    }

    void poll()

    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [getStatus, providerId])

  async function signIn() {
    // Reserve the tab during the click so the asynchronous start isn't popup-blocked
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    setBusy(true)
    try {
      const id = providerId ?? (await ensureConnection())
      const result = await start({ providerId: id })
      if (tab) tab.location.href = result.url
      else window.location.assign(result.url)
      pending.current = true
      setStatus({ status: 'pending', planEnabled: false })
    } catch {
      tab?.close()
      toast.error(
        'Could not start ChatGPT sign-in. Check that the sidecar is running.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    if (!providerId) return
    setBusy(true)
    try {
      const result = await disconnect({ providerId })
      setStatus({ status: 'disconnected', planEnabled: false })
      if (!result.revoked) {
        toast.warning(
          'Signed out locally. Remote revocation was not confirmed; disconnect the app in ChatGPT settings.',
        )
      }
    } catch {
      toast.error('Could not disconnect. Check the sidecar and retry.')
    } finally {
      setBusy(false)
    }
  }

  async function downloadSetup() {
    try {
      const id = providerId ?? (await ensureConnection())
      const contents = await remoteSetup({ providerId: id })
      const url = URL.createObjectURL(
        new Blob([contents], { type: 'application/json' }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'slopbench-chatgpt-setup.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.info(
        'Remote setup file downloaded. Follow the ChatGPT remote setup guide in the project documentation.',
      )
    } catch {
      toast.error('Could not prepare remote setup. Check the sidecar.')
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        {status?.status === 'connected'
          ? `Connected as ${status.email ?? 'ChatGPT account'} (${status.registration ?? ''})`
          : status?.status === 'pending'
            ? 'Complete sign-in in your browser.'
            : 'Sign in to use your eligible ChatGPT subscription.'}
      </p>
      {status?.status === 'connected' && !status.planEnabled && (
        <p role="alert">
          Plan access was not granted. Reconnect and authorize plan usage.
        </p>
      )}
      {status?.message && <p role="alert">{status.message}</p>}
      <div className="flex flex-wrap gap-2">
        <RippleButton
          size="sm"
          variant="input"
          disabled={busy}
          onClick={() => void signIn()}
        >
          Continue with ChatGPT
        </RippleButton>
        {status?.status === 'pending' && (
          <RippleButton
            size="sm"
            variant="stealth"
            onClick={() =>
              void (
                providerId ? cancel({ providerId }) : Promise.resolve()
              ).then(() =>
                setStatus({ status: 'disconnected', planEnabled: false }),
              )
            }
          >
            Cancel sign-in
          </RippleButton>
        )}
        {status?.status === 'connected' && (
          <RippleButton
            size="sm"
            variant="stealth"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Disconnect
          </RippleButton>
        )}
      </div>
      <p className="text-muted-foreground text-xs">
        Account changes save immediately and remain when settings are cancelled.
      </p>
      <p className="text-muted-foreground text-xs">
        Shared agents use their owner's selected connection and consume that
        account's allowance.
      </p>
      <a
        href="https://chatgpt.com/settings/usage"
        target="_blank"
        rel="noreferrer"
        className="underline"
      >
        Manage usage and access in ChatGPT
      </a>
      <RippleButton
        size="sm"
        variant="stealth"
        onClick={() => void downloadSetup()}
      >
        Set up on a remote server
      </RippleButton>
    </div>
  )
}
