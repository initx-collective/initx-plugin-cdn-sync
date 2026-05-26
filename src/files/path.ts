/**
 * 路径处理和映射
 */
import path from 'node:path'
import process from 'node:process'

const OUTSIDE_SOURCE_DIR_MESSAGE = '不在配置的本地目录范围内'

export class PathMapper {
  constructor(
    private root: string,
    private base: string,
    private cdnBasePath: string,
    private cdnUrl: string
  ) {}

  /**
   * 将本地路径转换为相对路径
   */
  toRelativePath(localPath: string): string {
    const absolutePath = path.isAbsolute(localPath)
      ? localPath
      : path.resolve(process.cwd(), localPath)

    const baseDir = path.join(this.root, this.base)
    const relativePath = path.relative(baseDir, absolutePath)

    if (path.isAbsolute(relativePath) || relativePath.startsWith('..') || relativePath === '') {
      throw new Error(`文件 ${localPath} ${OUTSIDE_SOURCE_DIR_MESSAGE}`)
    }

    return relativePath
  }

  /**
   * 生成 CDN 路径
   */
  toCDNPath(relativePath: string): string {
    // 使用 posix 路径确保在 Windows 上也是正斜杠
    const normalizedPath = relativePath.split(path.sep).join('/')
    return path.posix.join(this.cdnBasePath, normalizedPath)
  }

  /**
   * 生成 CDN URL
   */
  toCDNUrl(cdnPath: string): string {
    return `${this.cdnUrl}${cdnPath}`
  }

  /**
   * 获取显示路径（基于 base）
   */
  toDisplayPath(relativePath: string): string {
    return path.join(this.base, relativePath)
  }
}
