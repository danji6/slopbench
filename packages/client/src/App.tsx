import { AuthGate } from '@/components/auth/auth-gate'
import { ProfileGate } from '@/components/auth/profile-gate'
import { Chat } from '@/components/chat'
import { LightboxProvider } from '@/components/ui/lightbox'
import { Toaster } from '@/components/ui/sonner'
import { AttachmentUrlProvider, AvatarUrlProvider } from '@/hooks/chat'
import { FontProvider } from '@/providers/font'
import { Route, Router, Switch } from 'wouter'

function AppRoutes() {
  return (
    <Switch>
      <Route path="/*" component={ChatApp} />
    </Switch>
  )
}

function ChatApp() {
  return (
    <>
      <AvatarUrlProvider />
      <AttachmentUrlProvider />
      <Chat />
    </>
  )
}

export default function App() {
  return (
    <LightboxProvider>
      <Toaster />
      <AuthGate>
        <ProfileGate>
          <FontProvider>
            <Router>
              <AppRoutes />
            </Router>
          </FontProvider>
        </ProfileGate>
      </AuthGate>
    </LightboxProvider>
  )
}
