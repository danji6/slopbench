/** The program name of a shell path. */
export function shellBasename(value: string): string {
  return (value.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
}

/** How a shell is named to the model. */
export function shellLabel(value: string): string {
  const name = shellBasename(value)
  if (name === 'pwsh' || name === 'powershell') return 'PowerShell'
  if (name === 'cmd') return 'cmd.exe'
  return name
}
