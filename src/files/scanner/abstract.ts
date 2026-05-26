import type { SimpleGit } from 'simple-git'
import type { GitCommitImageFilesResult, GitImagePathChange } from './types'
import fs from 'node:fs'
import path from 'node:path'
import { simpleGit } from 'simple-git'

export abstract class ScannerAbstract<TResult> {
  private gitClient?: SimpleGit

  constructor(protected readonly cwd: string) {}

  async scan(): Promise<TResult> {
    return this.scanInternal()
  }

  protected abstract scanInternal(): Promise<TResult>

  protected resolveAbsolutePath(filePath: string): string {
    return path.resolve(this.cwd, filePath)
  }

  protected createGitClient(): SimpleGit {
    if (!this.gitClient) {
      this.gitClient = simpleGit(this.cwd)
    }
    return this.gitClient
  }

  protected async ensureGitRepo(): Promise<SimpleGit> {
    const git = this.createGitClient()
    const isRepo = await git.checkIsRepo()
    if (!isRepo) {
      throw new Error('当前目录不是 Git 仓库')
    }
    return git
  }

  protected async resolveCommitRef(ref: string): Promise<string> {
    const git = await this.ensureGitRepo()
    try {
      const resolved = await git.revparse([`${ref}^{commit}`])
      return resolved.trim()
    }
    catch {
      throw new Error(`提交不存在: ${ref}`)
    }
  }

  protected async readCommitNameStatus(ref: string): Promise<string> {
    const git = await this.ensureGitRepo()
    return git.raw([
      'show',
      '--name-status',
      '--pretty=format:',
      ref
    ])
  }

  protected buildCommitImageFilesResult(imageChanges: GitImagePathChange[]): GitCommitImageFilesResult {
    const images: string[] = []
    const missingImages: string[] = []
    const deletedImages: string[] = []
    const changes = []

    for (const change of imageChanges) {
      const absolutePath = this.resolveAbsolutePath(change.path)
      const exists = fs.existsSync(absolutePath)
      changes.push({
        path: change.path,
        absolutePath,
        changeType: change.changeType,
        previousPath: change.previousPath,
        exists
      })

      if (change.changeType === 'D') {
        deletedImages.push(absolutePath)
        continue
      }

      if (exists) {
        images.push(absolutePath)
      }
      else {
        missingImages.push(absolutePath)
      }
    }

    return { images, missingImages, deletedImages, changes }
  }
}
