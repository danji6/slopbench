import type React from 'react'

export type ChatProps = React.ComponentProps<'div'> & {
  width?: string
  layoutConstraint?: 'dvw' | '%'
  onError?: (error: Error) => void
}
