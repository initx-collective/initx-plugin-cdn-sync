import type { CDNClientType } from '../client/clients/abstract'
import type { ClientInstanceConfig, ClientRemoteConfig, ResolvedConfig, TargetConfig, UserConfig } from '../types'

function validateConcurrency(value: number | undefined, key: string): void {
  if (value === undefined) {
    return
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`配置项 client.${key} 必须是大于等于 1 的整数`)
  }
}

function validateClientConfig(config: ClientRemoteConfig): void {
  const requiredFields = [
    { key: 'bucket', value: config.bucket },
    { key: 'region', value: config.region },
    { key: 'basePath', value: config.basePath },
    { key: 'cdnUrl', value: config.cdnUrl }
  ]

  const missingFields = requiredFields.filter(field => !field.value)
  if (missingFields.length > 0) {
    const fieldNames = missingFields.map(f => `client.${f.key}`).join(', ')
    throw new Error(`配置文件缺少必需字段: ${fieldNames}`)
  }

  validateConcurrency(config.statusCheckConcurrency, 'statusCheckConcurrency')
  validateConcurrency(config.uploadConcurrency, 'uploadConcurrency')
}

function getConfiguredTypes(config: UserConfig): CDNClientType[] {
  return Object.entries(config.clients)
    .filter(([, instances]) => instances && Object.keys(instances).length > 0)
    .map(([type]) => type as CDNClientType)
}

function ensureSourceDir(config: UserConfig): void {
  if (!config.sourceDir) {
    throw new Error('配置文件缺少必需字段: 本地文件基础路径')
  }
}

function resolveType(config: UserConfig, targetName: string, targetConfig: TargetConfig): CDNClientType {
  if (targetConfig.type) {
    return targetConfig.type
  }

  const configuredTypes = getConfiguredTypes(config)
  if (configuredTypes.length === 1) {
    return configuredTypes[0]
  }

  throw new Error(`target "${targetName}" 未配置 type，且 clients 中存在多个类型，请显式配置 targets.${targetName}.type`)
}

function resolveClientName(
  targetName: string,
  type: CDNClientType,
  targetConfig: TargetConfig,
  instances: Record<string, ClientInstanceConfig>
): string {
  if (targetConfig.client) {
    if (!instances[targetConfig.client]) {
      throw new Error(`target "${targetName}" 指定的 clients.${type}.${targetConfig.client} 不存在`)
    }
    return targetConfig.client
  }

  if (instances.default) {
    return 'default'
  }

  const instanceNames = Object.keys(instances)
  if (instanceNames.length === 1) {
    return instanceNames[0]
  }

  throw new Error(
    `target "${targetName}" 未配置 client，且 clients.${type}.default 不存在，请配置 targets.${targetName}.client`
  )
}

function mergeClientConfig(instance: ClientInstanceConfig, target: TargetConfig): ClientRemoteConfig {
  const override = target.override || {}
  return {
    bucket: override.bucket ?? instance.bucket,
    region: override.region ?? instance.region,
    basePath: override.basePath ?? instance.basePath,
    cdnUrl: override.cdnUrl ?? instance.cdnUrl,
    statusCheckConcurrency: override.statusCheckConcurrency ?? instance.statusCheckConcurrency,
    uploadConcurrency: override.uploadConcurrency ?? instance.uploadConcurrency
  }
}

export function resolveConfigByTarget(config: UserConfig, targetName: string): ResolvedConfig {
  ensureSourceDir(config)

  const targets = config.targets ?? {}
  const targetConfig = targets[targetName]
  if (!targetConfig) {
    throw new Error(`target "${targetName}" 不存在`)
  }

  const type = resolveType(config, targetName, targetConfig)
  const instances = config.clients[type]
  if (!instances || Object.keys(instances).length === 0) {
    throw new Error(`clients.${type} 未配置任何实例`)
  }

  const clientName = resolveClientName(targetName, type, targetConfig, instances)
  const instance = instances[clientName]
  const mergedClientConfig = mergeClientConfig(instance, targetConfig)
  validateClientConfig(mergedClientConfig)

  const profile = instance.profile ?? targetConfig.profile ?? 'default'

  return {
    target: targetName,
    client: {
      type,
      profile,
      sourceDir: config.sourceDir,
      ...mergedClientConfig
    }
  }
}

export function resolveDefaultConfig(config: UserConfig): ResolvedConfig {
  ensureSourceDir(config)

  const configuredTypes = getConfiguredTypes(config)
  if (configuredTypes.length !== 1) {
    throw new Error('未配置 targets 时，clients 中必须且只能有一个类型')
  }

  const type = configuredTypes[0]
  const instances = config.clients[type]
  if (!instances) {
    throw new Error(`clients.${type} 未配置任何实例`)
  }

  const instanceNames = Object.keys(instances)
  if (instanceNames.length !== 1 || !instances.default) {
    throw new Error(`未配置 targets 时，clients.${type} 必须只配置 default 实例`)
  }

  const instance = instances.default
  validateClientConfig(instance)
  const profile = instance.profile ?? 'default'

  return {
    target: 'default',
    client: {
      type,
      profile,
      sourceDir: config.sourceDir,
      ...instance
    }
  }
}
