import type { FileInfo } from '../types'
import process from 'node:process'
import { styleText } from 'node:util'
import { Spinner } from 'picospinner'

export interface TaskSpinner {
  start: () => void
  setText: (text: string) => void
  succeed: (text: string) => void
  fail: (text: string) => void
  stop: () => void
}

/**
 * 创建任务级 spinner，用于长耗时阶段提示。
 */
export function createTaskSpinner(text: string): TaskSpinner {
  const spinner = new Spinner(text, {
    colors: {
      spinner: 'cyan',
      text: 'dim'
    }
  })
  return {
    start: () => spinner.start(),
    setText: value => spinner.setText(value),
    succeed: value => spinner.succeed(value),
    fail: value => spinner.fail(value),
    stop: () => spinner.stop()
  }
}

function formatCdnUrl(url: string, relativePath: string): string {
  const normalizedRelativePath = relativePath.replaceAll('\\', '/')
  const index = url.lastIndexOf(normalizedRelativePath)

  if (index < 0) {
    return styleText('dim', url)
  }

  const prefix = url.slice(0, index)
  const highlightedPath = url.slice(index)
  return `${styleText('dim', prefix)}${styleText('cyan', highlightedPath)}`
}

/**
 * 输出上传成功信息
 */
export function logUploadSuccess(file: FileInfo) {
  const icon = styleText('greenBright', '✓')
  const text = styleText('dim', `${file.relativePath} →`)
  process.stdout.write(`${icon} ${text} ${formatCdnUrl(file.cdnUrl, file.relativePath)}\n`)
}

/**
 * 输出上传失败信息
 */
export function logUploadError(file: FileInfo, error: string) {
  const icon = styleText('redBright', '✗')
  const text = styleText('dim', `${file.relativePath} →`)
  process.stdout.write(`${icon} ${text} ${error}\n`)
}

/**
 * 输出删除成功信息
 */
export function logDeleteSuccess(file: FileInfo) {
  const icon = styleText('yellowBright', '✓')
  const text = styleText('dim', `[D] ${file.relativePath} →`)
  process.stdout.write(`${icon} ${text} ${formatCdnUrl(file.cdnUrl, file.relativePath)}\n`)
}

/**
 * 输出删除失败信息
 */
export function logDeleteError(file: FileInfo, error: string) {
  const icon = styleText('redBright', '✗')
  const text = styleText('dim', `[D] ${file.relativePath} →`)
  process.stdout.write(`${icon} ${text} ${error}\n`)
}
