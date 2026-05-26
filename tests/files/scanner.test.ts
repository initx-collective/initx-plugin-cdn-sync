import type { GitImagePathChange } from '../../src/files/scanner'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  extractImageChangesFromNameStatusOutput,
  extractImagePathsFromNameStatusOutput,
  findLastDeleteCommitPerPath,
  findLastRenameCommitPerPreviousPath,
  isImageFile,
  mergeImageChangesByLatest,
  parseGitCommitRangeArg,
  scanDirectory
} from '../../src/files/scanner'

describe('scanner helpers', () => {
  it('detects image extension', () => {
    expect(isImageFile('a/b/c.png')).toBe(true)
    expect(isImageFile('a/b/c.txt')).toBe(false)
  })

  it('extracts image paths from git name-status output', () => {
    const output = [
      'A\tsrc/static/new.png',
      'M\tsrc/static/update.jpg',
      'D\tsrc/static/deleted.webp',
      'R100\tsrc/static/old-name.png\tsrc/static/new-name.png',
      'M\tsrc/static/not-image.ts'
    ].join('\n')

    expect(extractImagePathsFromNameStatusOutput(output)).toEqual([
      'src/static/new.png',
      'src/static/update.jpg',
      'src/static/new-name.png'
    ])
  })

  it('extracts image changes with delete and rename', () => {
    const output = [
      'D\tsrc/static/deleted.webp',
      'R100\tsrc/static/old-name.png\tsrc/static/new-name.png',
      'M\tsrc/static/update.jpg'
    ].join('\n')

    expect(extractImageChangesFromNameStatusOutput(output)).toEqual([
      { path: 'src/static/deleted.webp', changeType: 'D', previousPath: undefined },
      { path: 'src/static/new-name.png', changeType: 'R', previousPath: 'src/static/old-name.png' },
      { path: 'src/static/update.jpg', changeType: 'M', previousPath: undefined }
    ])
  })

  it('parses commit range syntax with head shorthand', () => {
    expect(parseGitCommitRangeArg('...abc1234')).toEqual({ refA: 'HEAD', refB: 'abc1234' })
    expect(parseGitCommitRangeArg('aaa...bbb')).toEqual({ refA: 'aaa', refB: 'bbb' })
    expect(parseGitCommitRangeArg('aaa...')).toEqual({ refA: 'aaa', refB: 'HEAD' })
    expect(parseGitCommitRangeArg('abc1234')).toBeNull()
  })

  it('keeps latest change for duplicate image path across commits', () => {
    const changesByCommit = [
      [{ path: 'src/static/a.png', changeType: 'M' }],
      [{ path: 'src/static/a.png', changeType: 'D' }],
      [{ path: 'src/static/a.png', changeType: 'A' }]
    ] satisfies GitImagePathChange[][]
    const merged = mergeImageChangesByLatest(changesByCommit)

    expect(merged).toEqual([
      { path: 'src/static/a.png', changeType: 'A' }
    ])
  })

  it('findLastDeleteCommitPerPath picks chronologically last delete for final delete', () => {
    const commitHashes = ['c1', 'c2', 'c3', 'c4']
    const changesByCommit = [
      [{ path: 'src/static/1.png', changeType: 'A' }],
      [{ path: 'src/static/1.png', changeType: 'D' }],
      [{ path: 'src/static/1.png', changeType: 'A' }],
      [{ path: 'src/static/1.png', changeType: 'D' }]
    ] satisfies GitImagePathChange[][]
    const merged = mergeImageChangesByLatest(changesByCommit)
    const last = findLastDeleteCommitPerPath(commitHashes, changesByCommit, merged)

    expect(merged.find(c => c.path === 'src/static/1.png')).toEqual({
      path: 'src/static/1.png',
      changeType: 'D',
      previousPath: undefined
    })
    expect(last.get('src/static/1.png')).toBe('c4')
  })

  it('findLastDeleteCommitPerPath ignores path when merged state is not delete', () => {
    const commitHashes = ['c1', 'c2']
    const changesByCommit = [
      [{ path: 'src/static/x.png', changeType: 'D' }],
      [{ path: 'src/static/x.png', changeType: 'A' }]
    ] satisfies GitImagePathChange[][]
    const merged = mergeImageChangesByLatest(changesByCommit)
    const last = findLastDeleteCommitPerPath(commitHashes, changesByCommit, merged)

    expect(merged.find(c => c.path === 'src/static/x.png')?.changeType).toBe('A')
    expect(last.has('src/static/x.png')).toBe(false)
  })

  it('findLastRenameCommitPerPreviousPath picks last commit for same rename edge', () => {
    const commitHashes = ['a', 'b', 'c']
    const changesByCommit = [
      [{ path: 'src/new.png', changeType: 'A' }],
      [{ path: 'src/new.png', changeType: 'R', previousPath: 'src/old.png' }],
      [{ path: 'src/new.png', changeType: 'M' }]
    ] satisfies GitImagePathChange[][]
    const merged = mergeImageChangesByLatest(changesByCommit)
    const last = findLastRenameCommitPerPreviousPath(commitHashes, changesByCommit, merged)

    expect(merged.find(c => c.path === 'src/new.png')).toEqual({
      path: 'src/new.png',
      changeType: 'M',
      previousPath: undefined
    })
    expect(last.has('src/old.png')).toBe(false)
  })

  it('findLastRenameCommitPerPreviousPath maps old path when merged is R', () => {
    const commitHashes = ['c1', 'c2']
    const changesByCommit = [
      [{ path: 'src/new.png', changeType: 'A' }],
      [{ path: 'src/new.png', changeType: 'R', previousPath: 'src/old.png' }]
    ] satisfies GitImagePathChange[][]
    const merged = mergeImageChangesByLatest(changesByCommit)
    const last = findLastRenameCommitPerPreviousPath(commitHashes, changesByCommit, merged)

    expect(merged.find(c => c.path === 'src/new.png')).toEqual({
      path: 'src/new.png',
      changeType: 'R',
      previousPath: 'src/old.png'
    })
    expect(last.get('src/old.png')).toBe('c2')
  })

  it('scans directory recursively via tinyglobby', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scanner-test-'))
    try {
      const nestedDir = path.join(root, 'nested')
      await fs.mkdir(nestedDir, { recursive: true })
      await fs.writeFile(path.join(root, 'a.txt'), 'a')
      await fs.writeFile(path.join(root, '.env'), 'x')
      await fs.writeFile(path.join(nestedDir, 'b.txt'), 'b')

      const scanned = await scanDirectory(root)
      const relative = scanned.map(file => path.relative(root, file)).sort()
      expect(relative).toEqual(['.env', 'a.txt', 'nested/b.txt'])
    }
    finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
