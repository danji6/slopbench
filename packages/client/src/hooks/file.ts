
import { useEffect, useState } from 'react'

export function useTextFile(url: string): string | undefined {
  const [data, setData] = useState<string | undefined>(undefined)

  // prettier-ignore
  useEffect(() => void (async () => {
    const res = await fetch(url)
    const data = await res.text()
    setData(data)
  })(), [url])

  return data
}
