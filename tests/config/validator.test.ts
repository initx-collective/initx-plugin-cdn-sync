import type { ResolvedConfig } from '../../src/types'
import { describe, expect, it } from 'vitest'
import { validateConfig } from '../../src/config/validator'

function createValidConfig(): ResolvedConfig {
  return {
    target: 'dev',
    client: {
      type: 'cos',
      profile: 'default',
      bucket: 'bucket',
      region: 'ap-guangzhou',
      basePath: '/static',
      sourceDir: 'src/static',
      cdnUrl: 'https://cdn.example.com'
    }
  }
}

describe('validateConfig', () => {
  it('passes with minimal valid config', () => {
    expect(() => validateConfig(createValidConfig())).not.toThrow()
  })

  it('throws for missing required field', () => {
    const config = createValidConfig()
    config.client.bucket = ''

    expect(() => validateConfig(config)).toThrow(/client\.bucket/)
  })

  it('throws for invalid statusCheckConcurrency', () => {
    const config = createValidConfig()
    config.client.statusCheckConcurrency = 0

    expect(() => validateConfig(config)).toThrow(/statusCheckConcurrency/)
  })

  it('throws for invalid uploadConcurrency', () => {
    const config = createValidConfig()
    config.client.uploadConcurrency = 1.5

    expect(() => validateConfig(config)).toThrow(/uploadConcurrency/)
  })

  it('passes for positive integer concurrency settings', () => {
    const config = createValidConfig()
    config.client.statusCheckConcurrency = 2
    config.client.uploadConcurrency = 3

    expect(() => validateConfig(config)).not.toThrow()
  })
})
