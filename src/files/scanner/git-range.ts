import type { SimpleGit } from 'simple-git'
import type { GitCommitImageFilesResult, GitImagePathChange, GitRevertRestoreEntry, ParsedGitCommitRange } from './types'
import path from 'node:path'
import { ScannerAbstract } from './abstract'
import { extractImageChangesFromNameStatusOutput } from './git-name-status'
import { isImageFile } from './image'

export interface GitCommitRangeScanOptions {
  revertOnly?: boolean
}

/**
 * 对合并后仍为删除的路径，从时间线从新到旧找到该路径最后一次出现 D 的提交。
 */
export function findLastDeleteCommitPerPath(
  commitHashes: string[],
  changesByCommit: GitImagePathChange[][],
  merged: GitImagePathChange[]
): Map<string, string> {
  const result = new Map<string, string>()

  for (const change of merged) {
    if (change.changeType !== 'D') {
      continue
    }

    for (let i = commitHashes.length - 1; i >= 0; i--) {
      const hash = commitHashes[i]
      const commitChanges = changesByCommit[i]
      if (!hash || !commitChanges) {
        continue
      }

      const hasDelete = commitChanges.some(c => c.path === change.path && c.changeType === 'D')
      if (hasDelete) {
        result.set(change.path, hash)
        break
      }
    }
  }

  return result
}

/**
 * 合并结果中仍为 R 时，旧路径在重命名提交中从树上消失；
 * 从时间线从新到旧找到该 R（同 from→to）最后一次出现的提交。
 */
export function findLastRenameCommitPerPreviousPath(
  commitHashes: string[],
  changesByCommit: GitImagePathChange[][],
  merged: GitImagePathChange[]
): Map<string, string> {
  const result = new Map<string, string>()

  for (const change of merged) {
    if (change.changeType !== 'R' || !change.previousPath || !isImageFile(change.previousPath)) {
      continue
    }

    for (let i = commitHashes.length - 1; i >= 0; i--) {
      const hash = commitHashes[i]
      const commitChanges = changesByCommit[i]
      if (!hash || !commitChanges) {
        continue
      }

      const hasSameRename = commitChanges.some(
        c =>
          c.changeType === 'R'
          && c.path === change.path
          && c.previousPath === change.previousPath
      )
      if (hasSameRename) {
        result.set(change.previousPath, hash)
        break
      }
    }
  }

  return result
}

function buildRevertRestores(
  cwd: string,
  lastDeleteByPath: Map<string, string>
): GitRevertRestoreEntry[] {
  const list: GitRevertRestoreEntry[] = []
  for (const [repoPath, deleteCommit] of lastDeleteByPath) {
    list.push({
      path: repoPath,
      absolutePath: path.resolve(cwd, repoPath),
      deleteCommit
    })
  }
  return list.sort((a, b) => a.path.localeCompare(b.path))
}

export function parseGitCommitRangeArg(input: string): ParsedGitCommitRange | null {
  if (!input.includes('...')) {
    return null
  }

  const parts = input.split('...')
  if (parts.length !== 2) {
    return null
  }

  const left = parts[0]?.trim() ?? ''
  const right = parts[1]?.trim() ?? ''

  if (!left && !right) {
    return null
  }

  if (!left && right) {
    return { refA: 'HEAD', refB: right }
  }

  if (left && !right) {
    return { refA: left, refB: 'HEAD' }
  }

  return { refA: left, refB: right }
}

export function mergeImageChangesByLatest(changesByCommit: GitImagePathChange[][]): GitImagePathChange[] {
  const latestByPath = new Map<string, GitImagePathChange>()

  for (const commitChanges of changesByCommit) {
    for (const change of commitChanges) {
      latestByPath.set(change.path, change)
    }
  }

  return Array.from(latestByPath.values())
}

class GitCommitRangeImageScanner extends ScannerAbstract<GitCommitImageFilesResult> {
  constructor(
    cwd: string,
    private readonly refA: string,
    private readonly refB: string,
    private readonly scanOptions?: GitCommitRangeScanOptions
  ) {
    super(cwd)
  }

  protected async scanInternal(): Promise<GitCommitImageFilesResult> {
    const git = await this.ensureGitRepo()
    const commitHashes = await this.getOrderedCommitHashesInclusive(git, this.refA, this.refB)
    if (commitHashes.length === 0) {
      return this.emptyRangeResult()
    }

    const changesByCommit: GitImagePathChange[][] = []
    for (const hash of commitHashes) {
      const output = await this.readCommitNameStatus(hash)
      changesByCommit.push(extractImageChangesFromNameStatusOutput(output))
    }

    const merged = mergeImageChangesByLatest(changesByCommit)

    if (this.scanOptions?.revertOnly) {
      const lastDeleteByPath = findLastDeleteCommitPerPath(commitHashes, changesByCommit, merged)
      const lastRenameFromByPath = findLastRenameCommitPerPreviousPath(commitHashes, changesByCommit, merged)
      const revertByPath = new Map<string, string>(lastDeleteByPath)
      for (const [repoPath, commitHash] of lastRenameFromByPath) {
        if (!revertByPath.has(repoPath)) {
          revertByPath.set(repoPath, commitHash)
        }
      }
      const revertRestores = buildRevertRestores(this.cwd, revertByPath)
      const changes = revertRestores.map((r) => {
        const absolutePath = this.resolveAbsolutePath(r.path)
        return {
          path: r.path,
          absolutePath,
          changeType: 'D' as const,
          previousPath: undefined,
          exists: false
        }
      })

      return {
        images: [],
        missingImages: [],
        deletedImages: [],
        changes,
        revertRestores
      }
    }

    return this.buildCommitImageFilesResult(merged)
  }

  private emptyRangeResult(): GitCommitImageFilesResult {
    if (this.scanOptions?.revertOnly) {
      return {
        images: [],
        missingImages: [],
        deletedImages: [],
        changes: [],
        revertRestores: []
      }
    }
    return { images: [], missingImages: [], deletedImages: [], changes: [] }
  }

  private async isAncestor(git: SimpleGit, possibleAncestorRef: string, descendantRef: string): Promise<boolean> {
    const mergeBase = (await git.raw(['merge-base', possibleAncestorRef, descendantRef])).trim()
    return mergeBase === possibleAncestorRef
  }

  private async getOrderedCommitHashesInclusive(git: SimpleGit, refA: string, refB: string): Promise<string[]> {
    const resolvedA = await this.resolveCommitRef(refA)
    const resolvedB = await this.resolveCommitRef(refB)

    if (resolvedA === resolvedB) {
      return [resolvedA]
    }

    if (await this.isAncestor(git, resolvedA, resolvedB)) {
      const output = await git.raw(['rev-list', '--reverse', `${resolvedA}^..${resolvedB}`])
      return output.split('\n').map(item => item.trim()).filter(Boolean)
    }

    if (await this.isAncestor(git, resolvedB, resolvedA)) {
      const output = await git.raw(['rev-list', '--reverse', `${resolvedB}^..${resolvedA}`])
      return output.split('\n').map(item => item.trim()).filter(Boolean)
    }

    const output = await git.raw(['rev-list', '--reverse', `${resolvedA}...${resolvedB}`])
    return output.split('\n').map(item => item.trim()).filter(Boolean)
  }
}

export async function getGitCommitRangeImageFiles(
  cwd: string,
  refA: string,
  refB: string,
  options?: GitCommitRangeScanOptions
): Promise<GitCommitImageFilesResult> {
  return new GitCommitRangeImageScanner(cwd, refA, refB, options).scan()
}
