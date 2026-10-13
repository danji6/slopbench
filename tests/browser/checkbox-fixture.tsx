import { LabeledCheckbox } from '@/components/ui/labeled-checkbox'
import '@/globals.css'
import { useState } from 'react'

export function CheckboxFixture() {
  const [checked, setChecked] = useState(false)
  return (
    <main className="mx-auto w-full max-w-sm p-4">
      <div className="flex justify-center" data-testid="container">
        <LabeledCheckbox
          checked={checked}
          onCheckedChange={setChecked}
          labelClassName="text-center text-balance"
        >
          Also delete the managed folder and its contents
        </LabeledCheckbox>
      </div>
    </main>
  )
}
