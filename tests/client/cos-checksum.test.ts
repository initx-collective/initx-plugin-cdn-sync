import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateFileMD5, isComparableMD5ETag, normalizeETag, parseContentLength } from '../../src/client/clients/cos-checksum'

const tempFiles: string[] = []

afterEach(async () => {
  await Promise.all(tempFiles.map(async (file) => {
    await fs.promises.rm(file, { force: true })
  }))
  tempFiles.length = 0
})

describe('cos-checksum helpers', () => {
  it('normalizes etag and strips quote', () => {
    expect(normalizeETag('"ABCDEF0123456789ABCDEF0123456789"')).toBe('abcdef0123456789abcdef0123456789')
    expect(normalizeETag(undefined)).toBeUndefined()
  })

  it('recognizes comparable md5 etag', () => {
    expect(isComparableMD5ETag('"abcdef0123456789abcdef0123456789"')).toBe(true)
    expect(isComparableMD5ETag('"abcdef0123456789abcdef0123456789-2"')).toBe(false)
    expect(isComparableMD5ETag(undefined)).toBe(false)
  })

  it('parses content-length from headers', () => {
    expect(parseContentLength({ 'content-length': '2497' })).toBe(2497)
    expect(parseContentLength({ 'Content-Length': '128' })).toBe(128)
    expect(parseContentLength({ 'content-length': 'x' })).toBeUndefined()
    expect(parseContentLength(undefined)).toBeUndefined()
  })

  it('calculates file md5', async () => {
    const filePath = path.join(os.tmpdir(), `cos-md5-test-${Date.now()}.txt`)
    await fs.promises.writeFile(filePath, 'hello world', 'utf8')
    tempFiles.push(filePath)

    const md5 = await calculateFileMD5(filePath)
    expect(md5).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3')
  })
})
