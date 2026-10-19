import { LabeledCheckbox } from '@/components/ui/labeled-checkbox'

/** Controls discovery for the selected project directory. */
export function SkillDiscoveryToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange?: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <LabeledCheckbox
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className="text-xs"
    >
      Allow <code>.agents/skills</code>
    </LabeledCheckbox>
  )
}
