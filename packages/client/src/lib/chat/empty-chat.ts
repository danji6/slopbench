type WelcomeState = {
  providersLoaded: boolean
  hasProviders: boolean
  selectionLoaded: boolean
  hasAgent: boolean
  promptsLoaded: boolean
  hasPrompts: boolean
  folderLoaded: boolean
}

/** Resolves setup before selection, configured prompts, and fallback suggestions. */
export function resolveWelcomeView(state: WelcomeState) {
  if (!state.providersLoaded) return 'loading'
  if (!state.hasProviders) return 'providers'
  if (!state.selectionLoaded) return 'loading'
  if (!state.hasAgent) return 'agents'
  if (!state.promptsLoaded || !state.folderLoaded) return 'loading'
  return state.hasPrompts ? 'prompts' : 'starters'
}
