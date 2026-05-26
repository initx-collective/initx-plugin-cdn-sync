import type { GitChangedImageFilesResult, GitImageChangeType, GitImagePathChange } from './types'
import { ScannerAbstract } from './abstract'
import { isImageFile } from './image'

/**
 * 获取 Git 变更文件
 */
class GitStatusImageScanner extends ScannerAbstract<GitChangedImageFilesResult> {
  protected async scanInternal(): Promise<GitChangedImageFilesResult> {
    const git = await this.ensureGitRepo()

    const status = await git.status()
    const changesByPath = new Map<string, { changeType: GitImageChangeType, previousPath?: string }>()
    const changePriority: Record<GitImageChangeType, number> = { M: 1, A: 2, R: 3, D: 4 }

    const upsert = (filePath: string | undefined, changeType: GitImageChangeType, previousPath?: string) => {
      if (!filePath || !isImageFile(filePath)) {
        return
      }

      const existing = changesByPath.get(filePath)
      if (!existing || changePriority[changeType] >= changePriority[existing.changeType]) {
        changesByPath.set(filePath, { changeType, previousPath })
      }
    }

    status.not_added.forEach(filePath => upsert(filePath, 'A'))
    status.created.forEach(filePath => upsert(filePath, 'A'))
    status.modified.forEach(filePath => upsert(filePath, 'M'))
    status.deleted.forEach(filePath => upsert(filePath, 'D'))
    status.renamed.forEach(({ from, to }) => upsert(to, 'R', from))

    const imageChanges: GitImagePathChange[] = []
    for (const [filePath, meta] of changesByPath) {
      imageChanges.push({
        path: filePath,
        changeType: meta.changeType,
        previousPath: meta.previousPath
      })
    }

    return this.buildCommitImageFilesResult(imageChanges)
  }
}

export async function getGitChangedFiles(cwd: string): Promise<GitChangedImageFilesResult> {
  return new GitStatusImageScanner(cwd).scan()
}
