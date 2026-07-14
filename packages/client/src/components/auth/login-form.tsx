import {
  AlertMessage,
  Card,
  Input,
  Label,
  LoadingButton,
  RippleButton,
} from '@/components/ui'
import { signIn, signUp } from '@/lib/auth/client'
import { useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '@sb/convex/_generated/api'

export function LoginForm() {
  const canSignUp = useQuery(api.auth.canSignUp)
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const isSignup = mode === 'signup'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (isSignup) {
        const res = await signUp.email({
          email: `${username}@sb.local`,
          password,
          name: username,
          username,
        })
        if (res.error) setError(res.error.message ?? 'Sign up failed')
      } else {
        const res = await signIn.username({ username, password })
        if (res.error) setError(res.error.message ?? 'Sign in failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
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
              className="mt-2 w-full"
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
