export type GitImageChangeType = 'A' | 'M' | 'D' | 'R'

export interface GitImageChange {
  path: string
  absolutePath: string
  changeType: GitImageChangeType
  previousPath?: string
  exists: boolean
}

export interface GitChangedImageFilesResult {
  images: string[]
  missingImages: string[]
  deletedImages: string[]
  changes: GitImageChange[]
}

/** 从删除或重命名恢复上传：取 deleteCommit 父提交中 path 的 blob（path 为删除路径或重命名的旧路径） */
export interface GitRevertRestoreEntry {
  path: string
  absolutePath: string
  deleteCommit: string
}

export interface GitCommitImageFilesResult {
  images: string[]
  missingImages: string[]
  deletedImages: string[]
  changes: GitImageChange[]
  /** 仅 `revertOnly` 扫描时返回：合并后仍为删除的图片，及合并后仍为重命名时的旧路径；均含最后一次相关提交 */
  revertRestores?: GitRevertRestoreEntry[]
}

export interface ParsedGitCommitRange {
  refA: string
  refB: string
}

export interface GitImagePathChange {
  path: string
  changeType: GitImageChangeType
  previousPath?: string
}
