import { useSession } from '@/lib/auth/client'

import { LoginForm } from './login-form'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession()
  if (isPending) return null
  if (!session) return <LoginForm />
  return <>{children}</>
}
