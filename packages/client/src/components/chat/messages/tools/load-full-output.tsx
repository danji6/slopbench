import { RippleButton } from '@/components/ui'
import { ArrowDownFromLineIcon } from 'lucide-react'

export function LoadFullOutput({
  onLoad,
  loading,
}: {
  onLoad: () => void
  loading: boolean
}) {
  return (
    <RippleButton
      variant="input"
      size="sm"
      className="text-muted-foreground ml-auto text-xs"
      disabled={loading}
      onClick={onLoad}
    >
      <ArrowDownFromLineIcon /> {loading ? 'Loading…' : 'Load full output'}
    </RippleButton>
  )
}
