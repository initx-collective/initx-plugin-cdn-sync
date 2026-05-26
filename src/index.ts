/**
 * CDN 同步插件
 */
import type { InitxContext, InitxMatcherRules } from '@initx-plugin/core'
import type { SimpleGit } from 'simple-git'
import type { CDNClient, CDNClientType } from './client/clients/abstract'
import type { GitCommitImageFilesResult, GitImageChange, GitImageChangeType, GitRevertRestoreEntry } from './files/scanner'
import type { FileInfo, ResolvedConfig, Store } from './types'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { styleText } from 'node:util'
import { InitxPlugin } from '@initx-plugin/core'
import { logger } from '@initx-plugin/utils'
import { checkbox, confirm, input, select } from '@inquirer/prompts'
import pLimit from 'p-limit'
import { simpleGit } from 'simple-git'
import { createCDNClient } from './client/factory'
import { loadConfig } from './config/loader'
import { resolveConfigByTarget, resolveDefaultConfig } from './config/resolve'
import { filterFiles, shouldIgnoreFile } from './files/filter'
import { PathMapper } from './files/path'
import { getGitChangedFiles, getGitCommitImageFiles, getGitCommitRangeImageFiles, isImageFile, parseGitCommitRangeArg, scanDirectory } from './files/scanner'
import { selectFilesCustom } from './ui/custom-selector'
import { createTaskSpinner, logDeleteError, logDeleteSuccess, logUploadError, logUploadSuccess } from './ui/progress'

const DEFAULT_STATUS_CHECK_CONCURRENCY = 5
const DEFAULT_UPLOAD_CONCURRENCY = 5
const STATUS_CHECK_CONFIRM_THRESHOLD = 20
const GIT_HASH_REGEX = /^[a-f0-9]{7,40}$/i
type UploadableGitChangeType = Exclude<GitImageChangeType, 'D'>

function parseBooleanOption(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
  }
  return false
}

function isLikelyGitHash(value: string): boolean {
  return GIT_HASH_REGEX.test(value)
}

function shouldTryResolveCommit(value: string): boolean {
  return isLikelyGitHash(value) || value === 'HEAD' || value.includes('~') || value.includes('^')
}

function posixRepoPath(repoRelativePath: string): string {
  return repoRelativePath.split(path.sep).join('/')
}

/**
 * 删除所在提交的**第一父**上的路径（供 `git rev-parse` / `git show`）。
 * `deleteCommit` 为 merge 时，`^` 为第一父提交。
 */
function revertDeleteParentRevSpec(deleteCommit: string, repoRelativePath: string): string {
  return `${deleteCommit}^:${posixRepoPath(repoRelativePath)}`
}

export default class CDNSyncPlugin extends InitxPlugin<Store> {
  defaultStore: Store = {
    clients: {}
  }

  private config!: ResolvedConfig
  private cdnClient!: CDNClient
  private configs: ResolvedConfig[] = []
  private diffMode = false
  private revertMode = false

  rules: InitxMatcherRules = [
    {
      matching: 'cdn',
      description: 'CDN 文件同步'
    }
  ]

  async init(ctx: InitxContext<Store>) {
    // 加载配置
    const userConfig = await loadConfig(process.cwd())
    const cliTarget = typeof ctx.cliOptions.target === 'string' ? ctx.cliOptions.target : undefined
    const targets = userConfig.targets ?? {}
    const targetNames = Object.keys(targets)
    if (targetNames.length === 0) {
      if (cliTarget) {
        throw new Error('当前配置未定义 targets，不能使用 --target')
      }
      this.configs = [resolveDefaultConfig(userConfig)]
      return
    }

    let selectedTargets: string[]
    if (cliTarget) {
      if (!targets[cliTarget]) {
        throw new Error(`target "${cliTarget}" 不存在，可选值: ${targetNames.join(', ')}`)
      }
      selectedTargets = [cliTarget]
    }
    else if (targetNames.length === 1) {
      selectedTargets = [targetNames[0]]
    }
    else {
      selectedTargets = await checkbox({
        message: '选择部署目标 (可多选):',
        choices: targetNames.map(name => ({ name, value: name }))
      })
      if (selectedTargets.length === 0) {
        logger.info('没有选择 target')
        process.exit(0)
      }
    }

    this.configs = selectedTargets.map(target => resolveConfigByTarget(userConfig, target))
  }

  async handle(ctx: InitxContext<Store>, ...args: string[]) {
    try {
      // 处理 config 子命令（不需要配置文件）
      if (args[0] === 'config') {
        if (args[1] === 'clean') {
          return await this.handleConfigClean(ctx)
        }
        return await this.handleConfig(ctx)
      }

      // 其他命令需要初始化配置
      this.diffMode = parseBooleanOption(ctx.cliOptions.diff)
      this.revertMode = parseBooleanOption(ctx.cliOptions.revert)
      await this.init(ctx)
      for (const config of this.configs) {
        this.config = config
        const credentials = ctx.store.clients[this.config.client.type]?.[this.config.client.profile]
        this.cdnClient = createCDNClient(this.config.client.type, credentials)
        this.cdnClient.validateConfig(this.config)
        await this.cdnClient.create()

        if (this.configs.length > 1) {
          logger.info(`处理 target: ${this.config.target}`)
        }

        await this.handleUpload(args)
      }
    }
    catch (error: any) {
      logger.error(`错误: ${error.message}`)
      process.exit(1)
    }
  }

  private async handleUpload(args: string[]) {
    let revertStagingDir: string | undefined
    try {
    // 2. 初始化路径映射器
      const pathMapper = new PathMapper(
        process.cwd(),
        this.config.client.sourceDir,
        this.config.client.basePath,
        this.config.client.cdnUrl
      )
      const statusCheckConcurrency = this.config.client.statusCheckConcurrency ?? DEFAULT_STATUS_CHECK_CONCURRENCY
      const uploadConcurrency = this.config.client.uploadConcurrency ?? DEFAULT_UPLOAD_CONCURRENCY

      // 3. 根据参数确定模式
      let localFiles: string[] = []
      let deletedFiles: string[] = []
      let revertScanItems: GitRevertRestoreEntry[] | undefined
      let renameSourceDeleteChanges: GitImageChange[] = []
      const gitChangeMetaByPath = new Map<string, { changeType: UploadableGitChangeType, previousPath?: string }>()

      if (args.length === 0 || args[0] === undefined) {
        if (this.revertMode) {
          throw new Error('使用 --revert 时必须指定单个提交或提交范围（例如 main...HEAD 或 abc1234），不支持工作区变更模式。')
        }
        // 模式 3: Git 变更文件
        logger.info('检测 Git 变更文件...')
        const { images, deletedImages, changes } = await getGitChangedFiles(process.cwd())
        localFiles = images
        deletedFiles = deletedImages
        this.collectGitChangeMeta(gitChangeMetaByPath, changes)

        this.logGitDeletedFiles(deletedFiles)
        renameSourceDeleteChanges = changes.filter(
          c => c.changeType === 'R' && Boolean(c.previousPath) && isImageFile(c.previousPath!)
        )
      }
      else {
        const targetPath = args[0]
        let handledAsGitInput = false
        if (this.revertMode && !parseGitCommitRangeArg(targetPath) && !shouldTryResolveCommit(targetPath)) {
          throw new Error('使用 --revert 时第一个参数必须是 Git 提交或提交范围（refA...refB），不能是本地路径或目录。')
        }
        const parsedCommitRange = parseGitCommitRangeArg(targetPath)
        if (parsedCommitRange) {
          const { refA, refB } = parsedCommitRange
          logger.info(this.revertMode
            ? `检测提交范围 ${refA}...${refB} 中合并后仍为删除的图片（恢复上传）...`
            : `检测提交范围 ${refA}...${refB} 的图片文件...`)
          const scanResult = await getGitCommitRangeImageFiles(
            process.cwd(),
            refA,
            refB,
            this.revertMode ? { revertOnly: true } : undefined
          )
          const applied = this.applyGitCommitImageScanResult(scanResult, gitChangeMetaByPath)
          localFiles = applied.localFiles
          deletedFiles = applied.deletedFiles
          revertScanItems = applied.revertScanItems
          renameSourceDeleteChanges = applied.renameSourceDeletes ?? []
          handledAsGitInput = true
        }
        else if (shouldTryResolveCommit(targetPath)) {
          logger.info(this.revertMode
            ? `检测提交 ${targetPath} 中的删除图片（恢复上传）...`
            : `检测提交 ${targetPath} 的图片文件...`)
          const scanResult = await getGitCommitImageFiles(
            process.cwd(),
            targetPath,
            this.revertMode ? { revertOnly: true } : undefined
          )
          const applied = this.applyGitCommitImageScanResult(scanResult, gitChangeMetaByPath)
          localFiles = applied.localFiles
          deletedFiles = applied.deletedFiles
          revertScanItems = applied.revertScanItems
          renameSourceDeleteChanges = applied.renameSourceDeletes ?? []
          handledAsGitInput = true
        }
        if (!handledAsGitInput) {
          const absolutePath = path.isAbsolute(targetPath)
            ? targetPath
            : path.resolve(process.cwd(), targetPath)

          // 检查路径是否存在
          if (!fs.existsSync(absolutePath)) {
            logger.error(`路径不存在: ${targetPath}`)
            process.exit(1)
          }

          const stat = await fs.promises.stat(absolutePath)

          if (stat.isFile()) {
            // 模式 1: 单文件
            localFiles = [absolutePath]
          }
          else if (stat.isDirectory()) {
            // 模式 2: 目录
            logger.info('扫描目录...')
            localFiles = await scanDirectory(absolutePath)
          }
          else {
            logger.error(`不支持的路径类型: ${targetPath}`)
            process.exit(1)
          }
        }
      }

      // 6. 过滤文件
      localFiles = filterFiles(localFiles)
      deletedFiles = filterFiles(deletedFiles)
      if (revertScanItems) {
        revertScanItems = revertScanItems.filter(r => !shouldIgnoreFile(r.absolutePath))
      }
      renameSourceDeleteChanges = renameSourceDeleteChanges.filter(
        ch => Boolean(ch.previousPath) && !shouldIgnoreFile(path.resolve(process.cwd(), ch.previousPath!))
      )

      const hasRevertWork = Boolean(revertScanItems && revertScanItems.length > 0)
      const hasRenameDeleteWork = renameSourceDeleteChanges.length > 0
      if (localFiles.length === 0 && deletedFiles.length === 0 && !hasRevertWork && !hasRenameDeleteWork) {
        if (this.revertMode && revertScanItems !== undefined) {
          logger.info('没有可恢复的图片（合并后删除或重命名旧路径）')
        }
        else {
          logger.info('没有需要同步的文件')
        }
        return
      }

      // 7. 构建文件信息（不检查线上状态）
      logger.info('准备文件列表...')
      const fileInfos: FileInfo[] = []

      for (const localPath of localFiles) {
        try {
          const relativePath = pathMapper.toRelativePath(localPath)
          const cdnPath = pathMapper.toCDNPath(relativePath)
          const cdnUrl = pathMapper.toCDNUrl(cdnPath)
          const stat = await fs.promises.stat(localPath)
          const gitChange = gitChangeMetaByPath.get(localPath)
          fileInfos.push({
            localPath,
            relativePath,
            cdnPath,
            cdnUrl,
            syncAction: 'upload',
            gitChangeType: gitChange?.changeType,
            gitPreviousPath: gitChange?.previousPath,
            exists: false, // 第一次选择时不需要知道状态
            size: stat.size
          })
        }
        catch (error: any) {
        // 跳过不在配置本地目录范围内的文件
          if (error.message.includes('不在配置的本地目录范围内')) {
            continue
          }
          throw error
        }
      }

      for (const deletedPath of deletedFiles) {
        try {
          const relativePath = pathMapper.toRelativePath(deletedPath)
          const cdnPath = pathMapper.toCDNPath(relativePath)
          const cdnUrl = pathMapper.toCDNUrl(cdnPath)
          fileInfos.push({
            localPath: deletedPath,
            relativePath,
            cdnPath,
            cdnUrl,
            syncAction: 'delete',
            gitChangeType: 'D',
            exists: false,
            size: 0
          })
        }
        catch (error: any) {
          if (error.message.includes('不在配置的本地目录范围内')) {
            continue
          }
          throw error
        }
      }

      this.pushRenameSourceDeleteFileInfos(pathMapper, fileInfos, renameSourceDeleteChanges)

      if (revertScanItems && revertScanItems.length > 0) {
        const gitForRevertSizes = simpleGit(process.cwd())
        for (const item of revertScanItems) {
          try {
            const relativePath = pathMapper.toRelativePath(item.absolutePath)
            const cdnPath = pathMapper.toCDNPath(relativePath)
            const cdnUrl = pathMapper.toCDNUrl(cdnPath)
            const size = await this.getRevertBlobByteSize(gitForRevertSizes, item.deleteCommit, item.path)
            fileInfos.push({
              localPath: item.absolutePath,
              relativePath,
              cdnPath,
              cdnUrl,
              syncAction: 'upload',
              gitChangeType: 'D',
              exists: false,
              size,
              gitRevertSource: {
                deleteCommit: item.deleteCommit,
                repoRelativePath: item.path
              }
            })
          }
          catch (error: any) {
            if (error.message.includes('不在配置的本地目录范围内')) {
              continue
            }
            throw error
          }
        }
      }

      if (fileInfos.length === 0) {
        logger.info('没有在配置的本地目录范围内的文件')
        return
      }

      if (fileInfos.length > STATUS_CHECK_CONFIRM_THRESHOLD) {
        const fileCountText = styleText('red', `${fileInfos.length}`)
        const warningMessage = `${styleText('yellow', '检测到文件过多（')}${fileCountText}${styleText('yellow', ' 个），推荐指定详细的目录，是否强制继续？')}`
        const shouldCheckStatus = await confirm({
          message: warningMessage,
          default: false
        })

        if (!shouldCheckStatus) {
          logger.info('已取消检查文件状态')
          return
        }
      }

      // 8. 检查文件的线上状态
      const statusLimit = pLimit(statusCheckConcurrency)
      const statusSpinner = createTaskSpinner('检查文件状态...')
      statusSpinner.start()
      const fileExistsResults = await (async () => {
        try {
          const results = await Promise.all(
            fileInfos.map(file =>
              statusLimit(async () => {
                try {
                  return await this.cdnClient.getRemoteFileStatus(
                    this.config.client.bucket,
                    this.config.client.region,
                    file.cdnPath,
                    file.syncAction === 'delete'
                      ? undefined
                      : {
                        // revert 条目尚无磁盘文件：--diff 时只比较大小，避免对不存在的 localPath 算 MD5
                          diff: this.diffMode,
                          localFilePath: this.diffMode && file.gitRevertSource ? undefined : file.localPath,
                          localFileSize: file.size
                        }
                  )
                }
                catch (error: any) {
                  throw new Error(`检查文件状态失败: ${file.relativePath} (${error.message})`)
                }
              })
            )
          )
          statusSpinner.succeed(`文件状态检查完成（${fileInfos.length} 个）`)
          return results
        }
        catch (error: any) {
          statusSpinner.fail('文件状态检查失败')
          throw error
        }
      })()
      fileInfos.forEach((file, index) => {
        const status = fileExistsResults[index]
        file.exists = status.exists
        file.remoteSize = this.diffMode ? status.size : undefined
        file.remoteETag = this.diffMode ? status.etag : undefined
        file.sameContent = this.diffMode ? status.sameAsLocal : undefined
      })

      // 9. 文件选择（显示云端状态，云端已存在的默认不选中）
      const selectedFiles = await selectFilesCustom(fileInfos, true, this.config.client.sourceDir, this.diffMode)

      if (selectedFiles.length === 0) {
        logger.info('没有选择文件')
        return
      }

      const selectedUploadFiles = selectedFiles.filter(file => file.syncAction !== 'delete')
      const selectedDeleteFiles = selectedFiles.filter(file => file.syncAction === 'delete')

      // 11. 检查是否有需要覆盖的文件
      const existingUploadFiles = selectedUploadFiles.filter(f => f.exists)
      if (existingUploadFiles.length > 0) {
        const hasRevert = existingUploadFiles.some(f => f.gitRevertSource)
        logger.warn(`以下 ${existingUploadFiles.length} 个文件在云端已存在，将被覆盖：`)
        existingUploadFiles.forEach((f) => {
          const text = styleText('dim', `  • ${f.relativePath}`)
          process.stdout.write(`${text}\n`)
        })
        process.stdout.write('\n')

        const confirmed = await confirm({
          message: hasRevert
            ? '确认用删除前的历史版本覆盖这些云端文件吗？'
            : '确认覆盖这些文件吗？',
          default: false
        })

        if (!confirmed) {
          logger.info('已取消同步')
          return
        }
      }

      if (selectedDeleteFiles.length > 0) {
        logger.warn(`以下 ${selectedDeleteFiles.length} 个文件将从云端删除：`)
        selectedDeleteFiles.forEach((f) => {
          const text = styleText('dim', `  • ${f.relativePath}`)
          process.stdout.write(`${text}\n`)
        })
        process.stdout.write('\n')

        const confirmed = await confirm({
          message: '确认删除这些云端文件吗？',
          default: false
        })

        if (!confirmed) {
          logger.info('已取消同步')
          return
        }
      }

      // 12. 执行同步操作
      process.stdout.write('\n')
      logger.info(`同步 ${selectedFiles.length} 个操作...`)

      const needRevertStage = selectedFiles.some(f => f.gitRevertSource)
      if (needRevertStage) {
        revertStagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdn-sync-revert-'))
        let stageIndex = 0
        for (const file of selectedFiles) {
          if (!file.gitRevertSource) {
            continue
          }
          const { deleteCommit, repoRelativePath } = file.gitRevertSource
          const ext = path.extname(file.relativePath) || path.extname(repoRelativePath) || '.bin'
          const stagePath = path.join(revertStagingDir, `restore-${stageIndex++}${ext}`)
          this.materializeRevertBlob(process.cwd(), deleteCommit, repoRelativePath, stagePath)
          file.localPath = stagePath
        }
      }

      const uploadLimit = pLimit(uploadConcurrency)
      const uploadResults = await Promise.all(
        selectedFiles.map(file =>
          uploadLimit(async () => {
            try {
              if (file.syncAction === 'delete') {
                await this.cdnClient.deleteFile(
                  this.config.client.bucket,
                  this.config.client.region,
                  file.cdnPath
                )
                logDeleteSuccess(file)
                return true
              }

              await this.cdnClient.uploadFile(
                this.config.client.bucket,
                this.config.client.region,
                file.cdnPath,
                file.localPath
              )

              logUploadSuccess(file)
              return true
            }
            catch (error: any) {
              if (file.syncAction === 'delete') {
                logDeleteError(file, error.message)
              }
              else {
                logUploadError(file, error.message)
              }
              return false
            }
          })
        )
      )

      const successCount = uploadResults.filter(Boolean).length
      const failCount = uploadResults.length - successCount

      // 13. 显示结果
      process.stdout.write('\n')
      if (failCount > 0) {
        logger.success(`完成！成功 ${successCount} 个，失败 ${failCount} 个`)
      }
      else {
        logger.success(`完成！成功 ${successCount} 个`)
      }
    }
    finally {
      if (revertStagingDir) {
        try {
          fs.rmSync(revertStagingDir, { recursive: true, force: true })
        }
        catch {
          // 忽略临时目录清理失败
        }
      }
    }
  }

  private async getRevertBlobByteSize(git: SimpleGit, deleteCommit: string, repoRelativePath: string): Promise<number> {
    const spec = revertDeleteParentRevSpec(deleteCommit, repoRelativePath)
    let objectId: string
    try {
      objectId = (await git.raw(['rev-parse', spec])).trim()
    }
    catch {
      throw new Error(`无法在删除提交的父版本解析文件: ${repoRelativePath}`)
    }
    const sizeStr = (await git.raw(['cat-file', '-s', objectId])).trim()
    const n = Number(sizeStr)
    if (!Number.isFinite(n)) {
      throw new TypeError(`无法读取 Git 对象大小: ${repoRelativePath}`)
    }
    return n
  }

  private materializeRevertBlob(cwd: string, deleteCommit: string, repoRelativePath: string, destPath: string): void {
    const spec = revertDeleteParentRevSpec(deleteCommit, repoRelativePath)
    const buf = execFileSync('git', ['show', spec], { cwd, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 })
    fs.writeFileSync(destPath, buf)
  }

  private warnMissingGitCommitImageFiles(missingImages: string[]): void {
    if (missingImages.length === 0) {
      return
    }

    logger.warn(`以下 ${missingImages.length} 个图片文件在本地不存在，将自动跳过：`)
    missingImages.forEach((missingPath) => {
      const relative = path.relative(process.cwd(), missingPath)
      process.stdout.write(`${styleText('dim', `  • ${relative}`)}\n`)
    })
    process.stdout.write('\n')
  }

  /**
   * 将单次「提交范围 / 单提交」扫描结果转为 handleUpload 使用的列表（含 --revert 分支）。
   */
  private applyGitCommitImageScanResult(
    result: GitCommitImageFilesResult,
    gitChangeMetaByPath: Map<string, { changeType: UploadableGitChangeType, previousPath?: string }>
  ): {
    localFiles: string[]
    deletedFiles: string[]
    revertScanItems: GitRevertRestoreEntry[] | undefined
    renameSourceDeletes: GitImageChange[] | undefined
  } {
    if (this.revertMode) {
      const items = result.revertRestores ?? []
      this.logGitDeletedFiles(items.map(r => r.absolutePath))
      return {
        localFiles: [],
        deletedFiles: [],
        revertScanItems: items,
        renameSourceDeletes: undefined
      }
    }

    this.warnMissingGitCommitImageFiles(result.missingImages)
    this.logGitDeletedFiles(result.deletedImages)
    this.logGitRenamedFiles(result.changes)
    this.collectGitChangeMeta(gitChangeMetaByPath, result.changes)

    const renameSourceDeletes = result.changes.filter(
      c => c.changeType === 'R' && Boolean(c.previousPath) && isImageFile(c.previousPath!)
    )

    return {
      localFiles: result.images,
      deletedFiles: result.deletedImages,
      revertScanItems: undefined,
      renameSourceDeletes
    }
  }

  private pushRenameSourceDeleteFileInfos(
    pathMapper: PathMapper,
    fileInfos: FileInfo[],
    renameChanges: GitImageChange[]
  ): void {
    const seen = new Set<string>()
    for (const ch of renameChanges) {
      const from = ch.previousPath
      if (!from || !isImageFile(from) || seen.has(from)) {
        continue
      }
      seen.add(from)
      try {
        const oldAbs = path.resolve(process.cwd(), from)
        const relativePath = pathMapper.toRelativePath(oldAbs)
        const cdnPath = pathMapper.toCDNPath(relativePath)
        const cdnUrl = pathMapper.toCDNUrl(cdnPath)
        fileInfos.push({
          localPath: oldAbs,
          relativePath,
          cdnPath,
          cdnUrl,
          syncAction: 'delete',
          gitChangeType: 'D',
          gitPreviousPath: ch.path,
          exists: false,
          size: 0
        })
      }
      catch (error: any) {
        if (error.message.includes('不在配置的本地目录范围内')) {
          continue
        }
        throw error
      }
    }
  }

  private collectGitChangeMeta(
    targetMap: Map<string, { changeType: UploadableGitChangeType, previousPath?: string }>,
    changes: Array<{ absolutePath: string, changeType: GitImageChangeType, previousPath?: string }>
  ) {
    changes.forEach((change) => {
      if (change.changeType === 'D') {
        return
      }
      targetMap.set(change.absolutePath, { changeType: change.changeType as UploadableGitChangeType, previousPath: change.previousPath })
    })
  }

  private logGitDeletedFiles(deletedImages: string[]) {
    if (deletedImages.length === 0) {
      return
    }

    logger.info(`检测到 ${deletedImages.length} 个删除状态图片文件：`)
    deletedImages.forEach((deletedPath) => {
      const relative = path.relative(process.cwd(), deletedPath)
      process.stdout.write(`${styleText('red', '[D]')} ${styleText('dim', relative)}\n`)
    })
    process.stdout.write('\n')
  }

  private logGitRenamedFiles(changes: Array<{ path: string, changeType: GitImageChangeType, previousPath?: string }>) {
    const renamedFiles = changes.filter(change => change.changeType === 'R')
    if (renamedFiles.length === 0) {
      return
    }

    logger.info(`检测到 ${renamedFiles.length} 个重命名图片文件：`)
    renamedFiles.forEach((change) => {
      const to = change.path
      const from = change.previousPath ?? '(unknown)'
      process.stdout.write(`${styleText('yellow', '[R]')} ${styleText('dim', `${from} -> ${to}`)}\n`)
    })
    process.stdout.write('\n')
  }

  /**
   * 处理 config 子命令
   */
  async handleConfig(ctx: InitxContext<Store>) {
    // 1. 选择 CDN 类型
    const availableTypes: CDNClientType[] = ['cos']
    let selectedType: CDNClientType

    if (availableTypes.length === 1) {
      selectedType = availableTypes[0]
    }
    else {
      selectedType = await select({
        message: '选择 CDN 类型:',
        choices: availableTypes.map(t => ({ name: t, value: t }))
      })
    }

    // 2. 创建对应类型的客户端实例
    const tempClient = createCDNClient(selectedType)

    // 3. 获取问题列表
    const questions = tempClient.getAnswersList()

    // 4. 收集配置
    const config: Record<string, any> = {}
    for (const question of questions) {
      if (question.type === 'input') {
        config[question.name] = await input({
          message: question.message,
          validate: question.validate
        })
      }
      else if (question.type === 'password') {
        config[question.name] = await input({
          message: question.message,
          validate: question.validate
        })
      }
    }

    // 5. 收集 profile
    const profile = await input({
      message: '配置名称 (Profile):',
      default: 'default',
      validate: (value: string) => {
        if (!value || value.trim().length === 0) {
          return 'Profile 不能为空'
        }
        return true
      }
    })

    // 6. 保存配置
    if (!ctx.store.clients[selectedType]) {
      ctx.store.clients[selectedType] = {}
    }
    ctx.store.clients[selectedType]![profile] = config

    logger.success(`✓ 配置已保存到 profile: ${profile}`)
  }

  /**
   * 处理 config clean 子命令
   */
  async handleConfigClean(ctx: InitxContext<Store>) {
    const availableTypes = Object.keys(ctx.store.clients) as CDNClientType[]

    if (availableTypes.length === 0) {
      logger.info('没有可清理的配置')
      return
    }

    // 1. 选择或自动确定 type
    let selectedType: CDNClientType
    if (availableTypes.length === 1) {
      selectedType = availableTypes[0]
    }
    else {
      selectedType = await select({
        message: '选择 CDN 类型:',
        choices: availableTypes.map(t => ({ name: t, value: t }))
      })
    }

    // 2. 获取该 type 下的所有 profiles
    const profiles = Object.keys(ctx.store.clients[selectedType] || {})

    if (profiles.length === 0) {
      logger.info(`${selectedType} 没有可清理的 profile`)
      return
    }

    // 3. 选择或自动确定 profile
    let selectedProfiles: string[]
    if (profiles.length === 1) {
      const confirmed = await confirm({
        message: `是否清理 ${selectedType} profile (${profiles[0]})?`,
        default: false
      })

      if (!confirmed) {
        logger.info('已取消清理')
        return
      }
      selectedProfiles = [profiles[0]]
    }
    else {
      selectedProfiles = await checkbox({
        message: '选择要清理的 Profile (可多选):',
        choices: profiles.map(p => ({ name: p, value: p }))
      })

      if (selectedProfiles.length === 0) {
        logger.info('没有选择 profile')
        return
      }

      const confirmed = await confirm({
        message: `确认清理 ${selectedProfiles.length} 个 profile?`,
        default: false
      })

      if (!confirmed) {
        logger.info('已取消清理')
        return
      }
    }

    // 4. 删除配置
    for (const profile of selectedProfiles) {
      delete ctx.store.clients[selectedType]![profile]
    }

    // 如果该 type 下没有 profile 了，删除整个 type
    if (Object.keys(ctx.store.clients[selectedType]!).length === 0) {
      delete ctx.store.clients[selectedType]
    }

    logger.success(`✓ 已清理 ${selectedProfiles.length} 个 profile: ${selectedProfiles.join(', ')}`)
  }
}

export { defineConfig } from './config/define'
