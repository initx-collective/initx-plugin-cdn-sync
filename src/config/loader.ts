import type { UserConfig } from '../types'
/**
 * 配置文件加载器
 */
import { loadConfig as unconfigLoadConfig } from 'unconfig'

export async function loadConfig(cwd: string): Promise<UserConfig> {
  const result = await unconfigLoadConfig<UserConfig>({
    sources: [
      {
        files: 'cdn.config'
      }
    ],
    cwd
  })

  if (!result.config) {
    throw new Error('配置文件 cdn.config.ts 不存在，请在项目根目录创建该文件')
  }

  return result.config
}
