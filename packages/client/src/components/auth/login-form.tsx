import {
  AlertMessage,
  Card,
  Input,
  Label,
  LoadingButton,
  RippleButton,
} from '@/components/ui'
import { useCountdown } from '@/hooks/countdown'
import { signIn, signUp } from '@/lib/auth/client'
import { extractErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { api } from '@sb/convex/_generated/api'
import { useQuery } from 'convex/react'
import { useState } from 'react'

export function LoginForm() {
  const canSignUp = useQuery(api.auth.canSignUp)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)

  const isSignup = mode === 'signup'
  const remaining = useCountdown(lockedUntil)
  const locked = remaining > 0

  function lockForRetryWindow({ response }: { response: Response }) {
    const seconds = retryAfterSeconds(response)
    if (seconds) setLockedUntil(Date.now() + seconds * 1000)
  }

  // The lockout window is owned by the server, the form only obeys it
  const fetchOptions = { onError: lockForRetryWindow }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (locked || loading) return
    setError(null)
    setLoading(true)
    try {
      if (isSignup) {
        const res = await signUp.email({
          email: `${username}@sb.local`,
          password,
          name: username,
          username,
          fetchOptions,
        })
        if (res.error) setError(res.error.message ?? 'Sign up failed')
      } else {
        const res = await signIn.username({ username, password, fetchOptions })
        if (res.error) setError(res.error.message ?? 'Sign in failed')
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Unexpected error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card.Root className="w-full max-w-sm">
        <Card.Header>
          <Card.Title className="text-2xl">
            {isSignup ? 'Create account' : 'Sign in'}
          </Card.Title>
          <Card.Description>
            {isSignup
              ? 'Choose a username and password to get started.'
              : 'Enter your credentials to continue.'}
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isSignup ? 'new-password' : 'current-password'}
              />
            </div>
            {error && (
              <AlertMessage onDismiss={() => setError(null)}>
                {error}
              </AlertMessage>
            )}
            <LoadingButton
              type="submit"
              variant="primary"
              loading={loading}
              disabled={locked}
              className={cn(locked && 'opacity-40!')}
            >
              {isSignup ? 'Create account' : 'Sign in'}
            </LoadingButton>
            {canSignUp && (
              <RippleButton
                type="button"
                variant="link"
                size="sm"
                className="self-center"
                onClick={() => {
                  setMode(isSignup ? 'signin' : 'signup')
                  setError(null)
                }}
              >
                {isSignup ? 'Have an account? Sign in' : 'No account? Sign up'}
              </RippleButton>
            )}
          </form>
        </Card.Content>
      </Card.Root>
    </div>
  )
}

/** Seconds to wait, as decided by the server after an auth failure. */
function retryAfterSeconds(response: Response): number {
  const seconds = Number(response.headers.get('X-Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}
