import type { CDNClient, CDNClientCredentials, CDNClientType } from './clients/abstract'
import { COSClient } from './clients'

/**
 * 创建 CDN 客户端
 */
export function createCDNClient(type: CDNClientType, credentials?: CDNClientCredentials): CDNClient {
  switch (type) {
    case 'cos':
      return new COSClient(credentials)
    default:
      throw new Error(`不支持的 CDN 类型: ${type}`)
  }
}
