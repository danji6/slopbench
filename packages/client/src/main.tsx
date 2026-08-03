import { AppErrorFallback, ErrorBoundary } from '@/components/ui/error-boundary'
import { installFonts } from '@/fonts'
import { installCloseGuard } from '@/lib/close-guard'
import { ConvexClientProvider } from '@/providers/convex'
import 'katex/dist/katex.min.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './globals.css'

installFonts()
installCloseGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexClientProvider>
      <ErrorBoundary fallback={(props) => <AppErrorFallback {...props} />}>
        <App />
      </ErrorBoundary>
    </ConvexClientProvider>
  </StrictMode>,
)
