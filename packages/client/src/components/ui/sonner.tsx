import { Toaster as Sonner, type ToasterProps } from 'sonner'

export { toast } from '@/lib/notifications'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-right"
      style={
        {
          '--normal-bg': 'var(--base-popover)',
          '--normal-text': 'var(--base-popover-foreground)',
          '--normal-border': 'var(--base-border)',
        } as React.CSSProperties
      }
      toastOptions={{
        style: {
          borderRadius: 'var(--radius-4xl)',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
