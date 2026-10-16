import type { Completion } from '@/components/ui/code-completion'

import { SCRIPT_HELPER_NAMES, SCRIPT_VARIABLES } from './apply-script'

/** Tab-completion entries for the script editor. */
export const SCRIPT_COMPLETIONS: Completion[] = [
  ...SCRIPT_VARIABLES.map((name) => ({ label: name, detail: 'variable' })),
  ...SCRIPT_HELPER_NAMES.map((name) => ({
    label: name,
    detail: 'function',
    snippet: `${name}($0)`,
  })),
]
