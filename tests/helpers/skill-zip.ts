import { deflateRawSync } from 'node:zlib'

/** Builds small ZIP fixtures, including intentionally invalid entry paths and modes. */
export function skillZip(
  entries: readonly { name: string; content: string | Buffer; mode?: number }[],
): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const bytes = Buffer.from(entry.content)
    const compressed = deflateRawSync(bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(bytes), 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50)
    header.writeUInt16LE(0x314, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x800, 8)
    header.writeUInt16LE(8, 10)
    header.writeUInt32LE(crc32(bytes), 16)
    header.writeUInt32LE(compressed.length, 20)
    header.writeUInt32LE(bytes.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38)
    header.writeUInt32LE(offset, 42)
    locals.push(local, name, compressed)
    central.push(header, name)
    offset += local.length + name.length + compressed.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}
