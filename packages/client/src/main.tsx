import { installFonts } from '@/fonts'
import { ConvexClientProvider } from '@/providers/convex'
import 'katex/dist/katex.min.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './globals.css'

installFonts()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConvexClientProvider>
      <App />
    </ConvexClientProvider>
  </StrictMode>,
)
