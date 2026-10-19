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
      size="xs"
      className="ml-auto shrink-0 gap-1.5 text-[0.625rem]"
      labelClassName="min-w-max whitespace-nowrap"
    >
      Allow <code>.agents/skills</code>
    </LabeledCheckbox>
  )
}
