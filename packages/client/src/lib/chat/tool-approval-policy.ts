import type { RememberScope } from '@/lib/chat'
import type { ApprovalHold } from '@sb/convex/lib/tool/approvalPolicy'
import type { PlanApprovalMeta } from '@sb/core/approval-presentation'
import { approvalRememberOption } from '@sb/core/approval-presentation'

export {
  PLAN_APPROVALS,
  getCommand,
  getDescription,
  summarizeInput,
  type PlanApprovalMeta,
} from '@sb/core/approval-presentation'
export {
  alwaysLabel,
  approvalHold,
  HOLD_HINTS,
  type ApprovalHold,
} from '@sb/convex/lib/tool/approvalPolicy'

export type ApprovalAction = {
  id: string
  label: string
  shortcut: string
  remember?: RememberScope
  approved: boolean
  abort?: boolean
}

export function buildApprovalActions(
  enabled: boolean,
  rememberLabel: string | null,
  hold: ApprovalHold,
  planApproval?: PlanApprovalMeta,
): ApprovalAction[] {
  if (!enabled) return []

  let key = 1
  const getKey = () => String(key++)

  const items: ApprovalAction[] = [
    {
      id: 'approve',
      label: planApproval?.approveLabel ?? 'Allow',
      shortcut: getKey(),
      approved: true,
    },
  ]

  if (planApproval) {
    items.push({
      id: 'deny',
      label: planApproval.denyLabel,
      shortcut: getKey(),
      approved: false,
      abort: planApproval.denyAborts,
    })
    return items
  }

  const remembered = approvalRememberOption(hold, rememberLabel)
  if (remembered) {
    items.push({
      id: `remember-${remembered.remember}`,
      label: remembered.label,
      shortcut: getKey(),
      approved: true,
      remember: remembered.remember,
    })
  }

  items.push({
    id: 'deny',
    label: 'Deny',
    shortcut: getKey(),
    approved: false,
  })

  items.push({
    id: 'abort',
    label: 'Abort',
    shortcut: getKey(),
    approved: false,
    abort: true,
  })

  return items
}

export { isPendingToolApproval as isApprovalRequested } from '@sb/core/utils/tool-parts'
