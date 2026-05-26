import type { UserConfig } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { resolveConfigByTarget, resolveDefaultConfig } from '../../src/config/resolve'

function createBaseConfig(): UserConfig {
  return {
    sourceDir: 'src/static',
    clients: {
      cos: {
        default: {
          bucket: 'bucket',
          region: 'ap-guangzhou',
          basePath: '/static',
          cdnUrl: 'https://cdn.example.com'
        }
      }
    },
    targets: {
      prod: {
        type: 'cos'
      }
    }
  }
}

describe('resolveConfigByTarget', () => {
  it('uses clients.<type>.default when target client is omitted', () => {
    const config = createBaseConfig()

    const resolved = resolveConfigByTarget(config, 'prod')

    expect(resolved.client.type).toBe('cos')
    expect(resolved.client.profile).toBe('default')
    expect(resolved.client.basePath).toBe('/static')
    expect(resolved.client.sourceDir).toBe('src/static')
  })

  it('applies target override fields', () => {
    const config = createBaseConfig()
    config.targets!.prod.override = {
      basePath: '/static/prod'
    }

    const resolved = resolveConfigByTarget(config, 'prod')

    expect(resolved.client.basePath).toBe('/static/prod')
  })

  it('uses profile precedence: instance > target > default', () => {
    const targetProfileConfig = createBaseConfig()
    targetProfileConfig.clients.cos!.default.profile = 'instance-profile'
    targetProfileConfig.targets!.prod.profile = 'target-profile'
    expect(resolveConfigByTarget(targetProfileConfig, 'prod').client.profile).toBe('instance-profile')

    const instanceProfileConfig = createBaseConfig()
    instanceProfileConfig.clients.cos!.default.profile = 'instance-profile'
    expect(resolveConfigByTarget(instanceProfileConfig, 'prod').client.profile).toBe('instance-profile')

    const defaultProfileConfig = createBaseConfig()
    expect(resolveConfigByTarget(defaultProfileConfig, 'prod').client.profile).toBe('default')
  })

  it('throws when source directory is missing', () => {
    const config = createBaseConfig() as any
    config.sourceDir = ''

    expect(() => resolveConfigByTarget(config, 'prod')).toThrow(/本地文件基础路径/)
  })

  it('throws when target does not exist', () => {
    const config = createBaseConfig()

    expect(() => resolveConfigByTarget(config, 'dev')).toThrow(/target "dev" 不存在/)
  })

  it('throws when target client does not exist', () => {
    const config = createBaseConfig()
    config.targets!.prod.client = 'not-exist'

    expect(() => resolveConfigByTarget(config, 'prod')).toThrow(/clients\.cos\.not-exist 不存在/)
  })

  it('throws when no default client and multiple instances without target client', () => {
    const config = createBaseConfig()
    config.clients.cos = {
      a: {
        bucket: 'bucket-a',
        region: 'ap-guangzhou',
        basePath: '/static/a',
        cdnUrl: 'https://a.example.com'
      },
      b: {
        bucket: 'bucket-b',
        region: 'ap-guangzhou',
        basePath: '/static/b',
        cdnUrl: 'https://b.example.com'
      }
    }

    expect(() => resolveConfigByTarget(config, 'prod')).toThrow(/未配置 client/)
  })

  it('throws when required remote field is missing', () => {
    const config = createBaseConfig()
    config.clients.cos!.default.bucket = ''

    expect(() => resolveConfigByTarget(config, 'prod')).toThrow(/client\.bucket/)
  })

  it('throws when override concurrency is invalid', () => {
    const config = createBaseConfig()
    config.targets!.prod.override = {
      statusCheckConcurrency: 0
    }

    expect(() => resolveConfigByTarget(config, 'prod')).toThrow(/statusCheckConcurrency/)
  })

  it('throws when target type is omitted and configured type cannot be inferred', () => {
    const config = createBaseConfig() as any
    config.targets.prod = {}
    config.clients = {}

    expect(() => resolveConfigByTarget(config, 'prod')).toThrow(/未配置 type/)
  })
})

describe('resolveDefaultConfig', () => {
  it('resolves default config when targets are omitted', () => {
    const config = createBaseConfig()
    delete (config as any).targets

    const resolved = resolveDefaultConfig(config)
    expect(resolved.target).toBe('default')
    expect(resolved.client.type).toBe('cos')
    expect(resolved.client.profile).toBe('default')
    expect(resolved.client.basePath).toBe('/static')
  })

  it('throws when multiple client types are configured', () => {
    const config = createBaseConfig() as any
    delete config.targets
    config.clients.other = {
      default: {
        bucket: 'other-bucket',
        region: 'ap-guangzhou',
        basePath: '/other',
        cdnUrl: 'https://other.example.com'
      }
    }

    expect(() => resolveDefaultConfig(config)).toThrow(/必须且只能有一个类型/)
  })

  it('throws when only-default constraint is not satisfied', () => {
    const config = createBaseConfig()
    delete (config as any).targets
    config.clients.cos = {
      default: {
        bucket: 'bucket',
        region: 'ap-guangzhou',
        basePath: '/static',
        cdnUrl: 'https://cdn.example.com'
      },
      extra: {
        bucket: 'bucket-2',
        region: 'ap-guangzhou',
        basePath: '/extra',
        cdnUrl: 'https://cdn2.example.com'
      }
    }

    expect(() => resolveDefaultConfig(config)).toThrow(/必须只配置 default 实例/)
  })
})
