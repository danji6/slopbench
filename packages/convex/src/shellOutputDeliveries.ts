import { internalQuery } from './_generated/server'
import {
  executionPosition,
  reportPosition,
} from './model/shellOutputDeliveries'
import {
  shellDeliveryPositionArgsValidator,
  shellJobExecutionArgsValidator,
} from './validators/shell'

export const _position = internalQuery({
  args: shellDeliveryPositionArgsValidator.fields,
  handler: executionPosition,
})

export const _reportPosition = internalQuery({
  args: shellJobExecutionArgsValidator.fields,
  handler: reportPosition,
})
