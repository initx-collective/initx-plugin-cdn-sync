/**
 * CDN 同步插件类型定义
 */
import type { CDNClientType } from './client/clients/abstract'

export interface ClientRemoteConfig {
  // Bucket 名称
  bucket: string
  // 所属地域
  region: string
  // CDN 上传基础路径（不包含本地目录映射部分）
  basePath: string
  // CDN 基础地址（只包含域名，不含路径）
  cdnUrl: string
  // 检查文件存在性的并发数（可选，默认 5）
  statusCheckConcurrency?: number
  // 上传文件的并发数（可选，默认 5）
  uploadConcurrency?: number
}

export interface ClientInstanceConfig extends ClientRemoteConfig {
  // 凭证 Profile（可选，默认 default）
  profile?: string
}

export interface TargetConfig {
  // CDN 类型（可选，未配置时自动推断）
  type?: CDNClientType
  // 客户端实例名（可选，优先使用 clients[type].default）
  client?: string
  // 凭证 Profile（可选，默认 default）
  profile?: string
  // 目标级额外覆写
  override?: Partial<ClientRemoteConfig>
}

// 配置存储结构（持久化凭证）
export interface Store {
  clients: {
    [type in CDNClientType]?: {
      [profile: string]: Record<string, any>
    }
  }
}

// 用户配置（cdn.config.ts）
export interface UserConfig {
  // 本地文件基础路径（相对于项目根目录）
  sourceDir: string
  // 各 CDN 类型下的客户端实例
  clients: {
    [type in CDNClientType]?: {
      [name: string]: ClientInstanceConfig
    }
  }
  // 部署目标（可选：单类型且仅 default 实例时可省略）
  targets?: Record<string, TargetConfig>
}

// 运行时解析后的配置
export interface ResolvedConfig {
  target: string
  client: ClientRemoteConfig & {
    sourceDir: string
    type: CDNClientType
    profile: string
  }
}

// 文件信息
export interface FileInfo {
  localPath: string // 本地绝对路径
  relativePath: string // 相对于本地文件基础路径
  cdnPath: string // CDN 路径
  cdnUrl: string // 完整 CDN URL
  syncAction?: 'upload' | 'delete' // 同步动作（默认 upload）
  gitChangeType?: 'A' | 'M' | 'D' | 'R' // Git 变更类型
  gitPreviousPath?: string // Git 重命名前路径
  gitPreviousCDNPath?: string // Git 重命名前 CDN 路径
  /** 从删除恢复上传：在父提交中取 blob，上传前写入临时文件 */
  gitRevertSource?: { deleteCommit: string, repoRelativePath: string }
  exists: boolean // 线上是否存在
  size: number // 本地文件大小
  remoteSize?: number // 远端文件大小
  remoteETag?: string // 远端 ETag
  sameContent?: boolean | null // true 一致 / false 不一致 / null 无法可靠判断
}

// 上传结果
export interface UploadResult {
  file: FileInfo
  success: boolean
  error?: string
}
