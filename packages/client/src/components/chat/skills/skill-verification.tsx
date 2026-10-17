import { AlertMessage, ConfirmDialog, RippleButton } from '@/components/ui'
import { useSkillVerification } from '@/hooks/chat/skill-verification'

export function SkillVerification({ disabled }: { disabled: boolean }) {
  const verification = useSkillVerification()
  return (
    <div className="space-y-2">
      <RippleButton
        size="sm"
        variant="input"
        disabled={disabled || !!verification.phase}
        onClick={() => void verification.check()}
      >
        {verification.phase === 'checking'
          ? 'Checking skills…'
          : verification.phase === 'removing'
            ? 'Removing missing skills…'
            : 'Check installed skills'}
      </RippleButton>
      {verification.message && (
        <p role="status" className="text-muted-foreground text-sm">
          {verification.message}
        </p>
      )}
      {verification.error && (
        <AlertMessage role="alert" dismissible={false}>
          {verification.error}
        </AlertMessage>
      )}
      <ConfirmDialog
        open={verification.missing.length > 0}
        onOpenChange={(open) => !open && verification.dismiss()}
        title="Remove missing skills?"
        description={
          <>
            These skills have missing library data. Remove their library entries
            and agent assignments? Any surviving files in agent folders will be
            preserved.
            <span className="mt-2 block max-h-48 overflow-y-auto wrap-break-word whitespace-pre-line">
              {verification.missing.map((skill) => skill.name).join('\n')}
            </span>
          </>
        }
        confirmText="Remove missing skills"
        variant="destructive"
        onConfirm={() => void verification.remove()}
      />
    </div>
  )
}
