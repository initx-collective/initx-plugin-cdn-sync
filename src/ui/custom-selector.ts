/**
 * 自定义文件选择器
 */
import type { FileInfo } from '../types'
import process from 'node:process'
import readline from 'node:readline'
import { styleText } from 'node:util'

interface FileChoice {
  file: FileInfo
  checked: boolean
}

interface RenderLine {
  type: 'dir' | 'file' | 'blank'
  dirPath?: string
  choiceIndex?: number
  isLastInDir?: boolean
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = size
  let unitIndex = -1
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`
}

export async function selectFilesCustom(
  files: FileInfo[],
  showStatus = false,
  base = '',
  showDiffDetails = false
): Promise<FileInfo[]> {
  if (files.length === 0) {
    return []
  }

  // 按路径排序
  const sortedFiles = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  // 按目录分组
  const grouped = new Map<string, FileChoice[]>()
  for (const file of sortedFiles) {
    const parts = file.relativePath.split('/')
    const dirPath = parts.slice(0, -1).join('/')
    if (!grouped.has(dirPath)) {
      grouped.set(dirPath, [])
    }
    grouped.get(dirPath)!.push({
      file,
      checked: showStatus
        ? file.syncAction === 'delete'
          ? file.exists
          : (showDiffDetails ? (!file.exists || file.sameContent === false) : !file.exists)
        : true
    })
  }

  // 构建扁平的选择列表（只包含文件，不包含目录标题）
  const choices: FileChoice[] = []
  for (const dirFiles of grouped.values()) {
    choices.push(...dirFiles)
  }

  let currentIndex = 0

  // 预构建所有可渲染行（目录标题 + 文件 + 空行）
  const renderLines: RenderLine[] = []
  const fileRowIndexByChoice: number[] = []
  let choiceIndex = 0
  for (const [dirPath, dirFiles] of grouped) {
    renderLines.push({ type: 'dir', dirPath })
    dirFiles.forEach((_, index) => {
      renderLines.push({
        type: 'file',
        choiceIndex,
        isLastInDir: index === dirFiles.length - 1
      })
      fileRowIndexByChoice[choiceIndex] = renderLines.length - 1
      choiceIndex++
    })
    renderLines.push({ type: 'blank' })
  }

  // 滚动区域高度：可用终端行数 - 6（预留更多空间，避免接近全屏）
  const terminalRows = process.stdout.rows ?? 24
  const listWindowHeight = Math.max(3, terminalRows - 6)

  // 内容滚动窗口的起始行索引
  let scrollOffset = 0
  let lastRenderHeight = 0

  const ensureScrollOffset = () => {
    const cursorLine = fileRowIndexByChoice[currentIndex]
    const maxOffset = Math.max(0, renderLines.length - listWindowHeight)
    const topTriggerLine = 2
    const bottomTriggerLine = Math.max(0, listWindowHeight - 3)
    const relativeLine = cursorLine - scrollOffset

    // 到达倒数第三行开始向下滚动
    if (relativeLine >= bottomTriggerLine) {
      scrollOffset = Math.min(maxOffset, cursorLine - bottomTriggerLine)
      return
    }

    // 到达正数第三行开始向上滚动
    if (relativeLine <= topTriggerLine) {
      scrollOffset = Math.max(0, cursorLine - topTriggerLine)
    }
  }

  const formatDirPath = (dirPath: string) => {
    if (base && dirPath) {
      return `${base}/${dirPath}`
    }
    if (base && !dirPath) {
      return base
    }
    return dirPath
  }

  // 渲染界面
  const render = (isFirstRender = false) => {
    ensureScrollOffset()

    if (!isFirstRender && lastRenderHeight > 0) {
      readline.moveCursor(process.stdout, 0, -lastRenderHeight)
      readline.cursorTo(process.stdout, 0)
      readline.clearScreenDown(process.stdout)
    }

    process.stdout.write(`${styleText('cyan', `选择要同步的文件 (共 ${files.length} 个文件)`)}\n`)

    // 列表窗口按可用高度进行切片渲染（内容不足时不补空行）
    const visibleLineCount = Math.min(listWindowHeight, Math.max(0, renderLines.length - scrollOffset))
    for (let i = 0; i < visibleLineCount; i++) {
      const line = renderLines[scrollOffset + i]
      readline.clearLine(process.stdout, 0)
      if (!line)
        continue

      if (line.type === 'dir') {
        process.stdout.write(`${styleText('gray', formatDirPath(line.dirPath!))}\n`)
        continue
      }

      if (line.type === 'blank') {
        process.stdout.write('\n')
        continue
      }

      const idx = line.choiceIndex!
      const choice = choices[idx]
      const fileName = choice.file.relativePath.split('/').at(-1)!
      const prefix = line.isLastInDir ? '└─ ' : '├─ '
      const checkIcon = choice.checked ? styleText('green', '◉') : styleText('gray', '◯')
      const cursor = idx === currentIndex ? styleText('cyan', '❯') : ' '

      let statusTag = ''
      const gitChangeTag = choice.file.gitChangeType === 'D'
        ? ` ${styleText('red', '[D]')}`
        : choice.file.gitChangeType === 'R'
          ? ` ${styleText('yellow', '[R]')}`
          : ''
      if (choice.file.syncAction === 'delete') {
        if (choice.file.exists) {
          statusTag = choice.checked
            ? ` ${styleText('red', '[delete]')}`
            : ` ${styleText('green', '[exist]')}`
        }
        else {
          statusTag = ` ${styleText('gray', '[not found]')}`
        }
      }
      else if (showStatus && choice.file.exists) {
        if (!showDiffDetails) {
          statusTag = choice.checked
            ? ` ${styleText('yellow', '[overlay]')}`
            : ` ${styleText('green', '[exist]')}`
        }
        else if (choice.file.sameContent === true) {
          statusTag = choice.checked
            ? ` ${styleText('yellow', '[overlay same]')}`
            : ` ${styleText('green', '[same]')}`
        }
        else if (choice.file.sameContent === false) {
          statusTag = choice.checked
            ? ` ${styleText('yellow', '[overlay diff]')}`
            : ` ${styleText('yellow', '[diff]')}`
        }
        else {
          statusTag = choice.checked
            ? ` ${styleText('yellow', '[overlay exist]')}`
            : ` ${styleText('green', '[exist]')}`
        }
      }

      const localSizeText = showDiffDetails && choice.file.syncAction !== 'delete'
        ? ` ${styleText('dim', `(${formatBytes(choice.file.size)})`)}`
        : ''
      const remoteSizeText = showDiffDetails && choice.file.exists && choice.file.remoteSize !== undefined
        ? styleText('dim', ` [online ${formatBytes(choice.file.remoteSize)}]`)
        : ''

      process.stdout.write(`${cursor}${checkIcon}   ${prefix}${fileName}${localSizeText}${remoteSizeText}${gitChangeTag}${statusTag}\n`)
    }

    // 提示信息放在底部
    readline.clearLine(process.stdout, 0)
    process.stdout.write(`${styleText('gray', '↑↓ navigate • space select • a all • i invert • ⏎ submit')}\n`)
    lastRenderHeight = visibleLineCount + 2
  }

  return new Promise((resolve) => {
    // 隐藏光标
    process.stdout.write('\x1B[?25l')

    // 设置 raw 模式以捕获按键
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }

    // 初始渲染
    render(true)

    // cleanup 函数
    const cleanup = () => {
      // 显示光标
      process.stdout.write('\x1B[?25h')
      process.stdin.removeAllListeners('keypress')
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false)
      }
      process.stdin.pause()
      process.stdout.write('\n')
    }

    // 监听按键
    const onKeypress = (str: string, key: any) => {
      if (key.ctrl && key.name === 'c') {
        // Ctrl+C 退出
        cleanup()
        process.exit(0)
      }

      if (key.name === 'up') {
        // 上移
        currentIndex = Math.max(0, currentIndex - 1)
        render()
      }
      else if (key.name === 'down') {
        // 下移
        currentIndex = Math.min(choices.length - 1, currentIndex + 1)
        render()
      }
      else if (key.name === 'space') {
        // 切换选中状态
        choices[currentIndex].checked = !choices[currentIndex].checked
        render()
      }
      else if (str === 'a' || str === 'A') {
        // 全选
        choices.forEach(c => c.checked = true)
        render()
      }
      else if (str === 'i' || str === 'I') {
        // 反选
        choices.forEach(c => c.checked = !c.checked)
        render()
      }
      else if (key.name === 'return' || key.name === 'enter') {
        // 确认
        cleanup()
        const selected = choices.filter(c => c.checked).map(c => c.file)
        resolve(selected)
      }
    }

    process.stdin.on('keypress', onKeypress)
    process.stdin.resume()
  })
}
