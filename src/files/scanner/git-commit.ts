import type { GitCommitImageFilesResult, GitRevertRestoreEntry } from './types'
import { ScannerAbstract } from './abstract'
import { extractImageChangesFromNameStatusOutput } from './git-name-status'
import { isImageFile } from './image'

export interface GitCommitScanOptions {
  revertOnly?: boolean
}

class GitCommitImageScanner extends ScannerAbstract<GitCommitImageFilesResult> {
  constructor(
    cwd: string,
    private readonly commitHash: string,
    private readonly scanOptions?: GitCommitScanOptions
  ) {
    super(cwd)
  }

  protected async scanInternal(): Promise<GitCommitImageFilesResult> {
    const resolved = await this.resolveCommitRef(this.commitHash)
    const output = await this.readCommitNameStatus(this.commitHash)
    const extracted = extractImageChangesFromNameStatusOutput(output)

    if (this.scanOptions?.revertOnly) {
      const revertRestores: GitRevertRestoreEntry[] = []
      for (const c of extracted) {
        if (c.changeType === 'D') {
          revertRestores.push({
            path: c.path,
            absolutePath: this.resolveAbsolutePath(c.path),
            deleteCommit: resolved
          })
        }
        else if (c.changeType === 'R' && c.previousPath && isImageFile(c.previousPath)) {
          revertRestores.push({
            path: c.previousPath,
            absolutePath: this.resolveAbsolutePath(c.previousPath),
            deleteCommit: resolved
          })
        }
      }
      revertRestores.sort((a, b) => a.path.localeCompare(b.path))

      const changes = revertRestores.map(r => ({
        path: r.path,
        absolutePath: r.absolutePath,
        changeType: 'D' as const,
        previousPath: undefined,
        exists: false
      }))

      return {
        images: [],
        missingImages: [],
        deletedImages: [],
        changes,
        revertRestores
      }
    }

    return this.buildCommitImageFilesResult(extracted)
  }
}

export async function getGitCommitImageFiles(
  cwd: string,
  commitHash: string,
  options?: GitCommitScanOptions
): Promise<GitCommitImageFilesResult> {
  return new GitCommitImageScanner(cwd, commitHash, options).scan()
}
