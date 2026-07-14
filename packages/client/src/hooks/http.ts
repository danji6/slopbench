import { getAuthSiteUrl } from '@/lib/auth/site-url'
import { ConvexError } from 'convex/values'
import { useCallback, useRef, useState } from 'react'

let cachedBaseUrl: string | undefined

/** The Convex HTTP site base URL. */
export const convexSiteUrl = () => {
  if (!cachedBaseUrl) {
    cachedBaseUrl = getAuthSiteUrl({
      CURRENT_ORIGIN: window.location.origin,
      VITE_CONVEX_SITE_URL: import.meta.env.VITE_CONVEX_SITE_URL,
      VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL,
    })
  }
  return cachedBaseUrl
}

const baseUrl = convexSiteUrl

export interface ProgressEvent {
  loaded: number
  total: number
  percentage: number
}

export function useHttpAction<TBody extends XMLHttpRequestBodyInit, TResponse>(
  name: string,
  method = 'POST',
) {
  const [isPending, setIsPending] = useState(false)
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  const call = useCallback(
    async (data: TBody): Promise<TResponse | null> => {
      try {
        if (xhrRef.current) return null
        setIsPending(true)

        return await request(
          `${baseUrl()}/${name.replace(/^\/+/, '')}`,
          method,
          data,
          xhrRef,
          await getConvexToken(),
          setProgress,
        )
      } finally {
        setIsPending(false)
        setProgress(null)
      }
    },
    [name, method],
  )

  const abort = useCallback(() => {
    xhrRef.current?.abort()
  }, [])

  return { call, abort, isPending, progress } as const
}

export async function getConvexToken(): Promise<string | undefined> {
  const response = await fetch(`${baseUrl()}/api/auth/convex/token`, {
    credentials: 'include',
  })
  if (!response.ok) return undefined

  const body = (await response.json()) as { token?: string }
  return body.token
}

function request<TBody extends XMLHttpRequestBodyInit, TResponse>(
  url: string,
  method: string,
  data: TBody,
  xhrRef: React.RefObject<XMLHttpRequest | null>,
  sessionToken: string | null | undefined,
  onProgress: (progress: ProgressEvent) => void,
): Promise<TResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage: Math.round((event.loaded / event.total) * 100),
        })
      }
    })

    xhr.addEventListener('load', () => {
      xhrRef.current = null

      try {
        const json = JSON.parse(xhr.responseText)

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(json as TResponse)
        } else {
          reject(new ConvexError(json))
        }
      } catch {
        reject(new Error('Failed to parse response'))
      }
    })

    xhr.addEventListener('error', () => {
      xhrRef.current = null
      reject(new Error('Network error'))
    })

    xhr.addEventListener('abort', () => {
      xhrRef.current = null
      reject(new Error('Upload was aborted'))
    })

    xhr.open(method, url)

    if (sessionToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${sessionToken}`)
    }

    xhr.send(data)
  })
}
