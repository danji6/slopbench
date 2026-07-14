import { isServer } from '@/lib/utils'
import { useEffect, useState } from 'react'

export function useStyleProperty(name?: string, element?: HTMLElement | null) {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (isServer || !name) return

    const updateValue = () => {
      let newValue: string | null | undefined

      if (name.startsWith('--')) {
        const style = getComputedStyle(element || document.documentElement)
        newValue = style.getPropertyValue(name)
      }

      setValue(newValue ?? name ?? '')
    }

    updateValue()

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === 'attributes' &&
          (mutation.attributeName === 'style' ||
            mutation.attributeName === 'class')
        ) {
          updateValue()
        }
      })
    })

    // Always observe the root for global theme changes
    const rootParams = {
      attributes: true,
      attributeFilter: ['style', 'class'],
    }
    observer.observe(document.documentElement, rootParams)

    // If a specific element is provided and it's not the root, observe it too
    if (element && element !== document.documentElement) {
      observer.observe(element, rootParams)
    }

    // Dispatched by applyScheme/resetScheme
    const handleStyleChange = () => updateValue()
    window.addEventListener('stylechange', handleStyleChange)

    return () => {
      observer.disconnect()
      window.removeEventListener('stylechange', handleStyleChange)
    }
  }, [name, element])

  return value
}
