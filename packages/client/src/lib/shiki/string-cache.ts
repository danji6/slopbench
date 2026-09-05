type Entry = {
  value: string
  bytes: number
}

/** A LRU string cache with both count and memory limits. */
export class StringCache {
  private readonly entries = new Map<string, Entry>()
  private bytes = 0

  constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
  ) {}

  get(key: string): string | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined

    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: string) {
    const bytes = stringBytes(key) + stringBytes(value)
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.bytes -= existing.bytes
    }

    if (bytes > this.maxBytes) return

    this.entries.set(key, { value, bytes })
    this.bytes += bytes
    this.trim()
  }

  private trim() {
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value
      if (!oldest) break
      this.entries.delete(oldest[0])
      this.bytes -= oldest[1].bytes
    }
  }
}

/** Conservative size estimate for strings retained by V8. */
export function stringBytes(value: string) {
  return value.length * 2
}
