
import { createContext, useContext } from 'react'

function createUsableContext<T>(
  name: string,
): [context: React.Context<T | null>, use: () => T] {
  const context = createContext<T | null>(null)

  const use = () => {
    const ctx = useContext(context)
    if (ctx === null) {
      throw new Error(`use${name} must be used within its provider`)
    }
    return ctx
  }

  return [context, use]
}

function createOptionalContext<T>(): [
  context: React.Context<T | null>,
  use: () => T | null,
] {
  const context = createContext<T | null>(null)
  const use = () => useContext(context) || null

  return [context, use]
}

export { createUsableContext, createOptionalContext }
