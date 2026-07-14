
import { createOptionalContext } from '@/hooks'
import { XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

import { LoadingIndicator } from './loading-indicator'

type LightboxControls = {
  open: (src: string, alt?: string) => void
}

const [LightboxContext, useLightbox] = createOptionalContext<LightboxControls>()

export { useLightbox }

export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [src, setSrc] = useState<string | null>(null)
  const [alt, setAlt] = useState<string | undefined>()
  const [isLoaded, setIsLoaded] = useState(false)

  const open = useCallback((src: string, alt?: string) => {
    setIsLoaded(false)
    setSrc(src)
    setAlt(alt)
  }, [])

  const close = useCallback(() => setSrc(null), [])

  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [src, close])

  return (
    <LightboxContext.Provider value={{ open }}>
      {children}
      <AnimatePresence>
        {src && (
          <motion.div
            key="lightbox-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={close}
          >
            <AnimatePresence>
              {!isLoaded && (
                <motion.div
                  key="lightbox-spinner"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15, delay: 0.25 }}
                  className="absolute"
                >
                  <LoadingIndicator />
                </motion.div>
              )}
            </AnimatePresence>
            <img
              key={src}
              src={src}
              alt={alt ?? ''}
              onLoad={() => requestAnimationFrame(() => setIsLoaded(true))}
              className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl select-none"
              style={{
                opacity: isLoaded ? 1 : 0,
                transform: isLoaded ? 'scale(1)' : 'scale(0.94)',
                transition: 'opacity 0.35s ease-out, transform 0.2s ease-out',
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              aria-label="Close"
              onClick={close}
              className="absolute top-4 right-4 rounded-full bg-black/20 p-2 text-white transition-colors hover:bg-black/50"
            >
              <XIcon className="size-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </LightboxContext.Provider>
  )
}
