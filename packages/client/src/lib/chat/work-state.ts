import { createRowExpansionStore } from './row-expansion-state'

export {
  ROW_TRANSITION_MS as WORK_TRANSITION_MS,
  type RowTransition as WorkTransition,
  createRowExpansionStore as createWorkExpansionStore,
} from './row-expansion-state'

export const workExpansion = createRowExpansionStore()
