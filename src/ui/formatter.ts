import type { FileInfo } from '../types'
/**
 * 树形结构格式化
 */
import { styleText } from 'node:util'

/**
 * 格式化文件为树形结构显示
 */
export function formatTreeStructure(file: FileInfo, allFiles: FileInfo[], showStatus = false, base = ''): string {
  const parts = file.relativePath.split('/')
  const fileName = parts.at(-1)!

  // 构建完整路径显示（包含 base）
  const fullPath = base ? `${base}/${file.relativePath}` : file.relativePath
  const dirPath = fullPath.substring(0, fullPath.lastIndexOf('/'))

  // 检查是否是同目录最后一个文件
  const isLast = isLastInDirectory(file, allFiles)
  const prefix = isLast ? '└─ ' : '├─ '

  // 显示文件状态
  let statusTag = ''
  if (showStatus && file.exists) {
    statusTag = ` ${styleText('green', '[exist]')}`
  }

  return `${dirPath}\n  ${prefix}${fileName}${statusTag}`
}

/**
 * 检查文件是否是同目录最后一个
 */
function isLastInDirectory(file: FileInfo, allFiles: FileInfo[]): boolean {
  const parts = file.relativePath.split('/')
  const dirPath = parts.slice(0, -1).join('/')

  // 找到同目录的所有文件
  const siblings = allFiles.filter((f) => {
    const fParts = f.relativePath.split('/')
    const fDirPath = fParts.slice(0, -1).join('/')
    return fDirPath === dirPath
  })

  // 按文件名排序
  siblings.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  // 检查是否是最后一个
  return siblings.at(-1)?.relativePath === file.relativePath
}
