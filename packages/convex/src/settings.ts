import { authMutation, authQuery } from './functions'
import * as Settings from './model/settings'
import * as V from './validators/args'

export const get = authQuery({
  args: {},
  handler: Settings.getOrDefault,
})

export const update = authMutation({
  args: { patch: V.settingsPatchArgsValidator },
  handler: Settings.update,
})

export const remove = authMutation({
  args: { key: V.settingsKeyValidator },
  handler: Settings.remove,
})
