/**
 * 运行时配置验证器
 */
import type { ResolvedConfig } from '../types'

function validateConcurrency(value: number | undefined, key: string): void {
  if (value === undefined) {
    return
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`配置项 client.${key} 必须是大于等于 1 的整数`)
  }
}

export function validateConfig(config: ResolvedConfig): void {
  const { client } = config

  const requiredFields = [
    { key: 'type', value: client.type },
    { key: 'bucket', value: client.bucket },
    { key: 'region', value: client.region },
    { key: 'basePath', value: client.basePath },
    { key: 'sourceDir', value: client.sourceDir },
    { key: 'cdnUrl', value: client.cdnUrl }
  ]

  const missingFields = requiredFields.filter(field => !field.value)
  if (missingFields.length > 0) {
    const fieldNames = missingFields.map(f => `client.${f.key}`).join(', ')
    throw new Error(`配置文件缺少必需字段: ${fieldNames}`)
  }

  validateConcurrency(client.statusCheckConcurrency, 'statusCheckConcurrency')
  validateConcurrency(client.uploadConcurrency, 'uploadConcurrency')
}
