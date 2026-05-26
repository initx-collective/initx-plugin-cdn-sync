import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PathMapper } from '../../src/files/path'

describe('path mapper', () => {
  it('converts absolute local path to relative path within source directory', () => {
    const root = '/project'
    const mapper = new PathMapper(root, 'src/static', '/cdn', 'https://cdn.example.com')
    const absolutePath = path.join(root, 'src/static/images/logo.png')

    expect(mapper.toRelativePath(absolutePath)).toBe('images/logo.png')
  })

  it('throws when file is outside source directory boundary', () => {
    const root = '/project'
    const mapper = new PathMapper(root, 'src', '/cdn', 'https://cdn.example.com')
    const outsidePath = path.join(root, 'src-static/images/logo.png')

    expect(() => mapper.toRelativePath(outsidePath)).toThrow(/不在配置的本地目录范围内/)
  })

  it('creates normalized CDN path with posix separator', () => {
    const mapper = new PathMapper('/project', 'src', '/assets', 'https://cdn.example.com')

    expect(mapper.toCDNPath('icons/logo.svg')).toBe('/assets/icons/logo.svg')
  })
})
