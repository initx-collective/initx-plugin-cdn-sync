import crypto from 'node:crypto'
import fs from 'node:fs'

const MD5_ETAG_REGEX = /^[a-f0-9]{32}$/

export function normalizeETag(etag?: string): string | undefined {
  if (!etag) {
    return undefined
  }
  return etag.trim().replace(/^"|"$/g, '').toLowerCase()
}

export function isComparableMD5ETag(etag?: string): boolean {
  const normalized = normalizeETag(etag)
  if (!normalized) {
    return false
  }
  return MD5_ETAG_REGEX.test(normalized)
}

export function parseContentLength(headers: Record<string, any> | undefined): number | undefined {
  if (!headers) {
    return undefined
  }

  const value = headers['content-length'] ?? headers['Content-Length']
  if (value === undefined) {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined
  }
  return parsed
}

export async function calculateFileMD5(filePath: string): Promise<string> {
  const hash = crypto.createHash('md5')
  const stream = fs.createReadStream(filePath)

  return await new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}
