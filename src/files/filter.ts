/**
 * 文件过滤器
 */
import path from 'node:path'

// 默认忽略的文件
const IGNORED_FILES = [
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.gitkeep'
]

// 默认忽略的目录
const IGNORED_DIRS = [
  '.git',
  'node_modules',
  '.idea',
  '.vscode'
]

/**
 * 检查文件是否应该被忽略
 */
export function shouldIgnoreFile(filePath: string): boolean {
  const basename = path.basename(filePath)

  // 检查文件名
  if (IGNORED_FILES.includes(basename)) {
    return true
  }

  // 检查路径中是否包含忽略的目录
  const parts = filePath.split(path.sep)
  for (const part of parts) {
    if (IGNORED_DIRS.includes(part)) {
      return true
    }
  }

  return false
}

/**
 * 过滤文件列表
 */
export function filterFiles(files: string[]): string[] {
  return files.filter(file => !shouldIgnoreFile(file))
}
