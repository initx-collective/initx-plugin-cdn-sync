import { glob } from 'tinyglobby'

/**
 * 递归扫描目录
 */
export async function scanDirectory(dirPath: string): Promise<string[]> {
  return glob('**/*', {
    cwd: dirPath,
    absolute: true,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false
  })
}
