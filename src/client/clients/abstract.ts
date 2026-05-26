import type { ResolvedConfig } from '../../types'

export type CDNClientType = 'cos'

export type CDNClientCredentials = Record<string, any>

export interface CDNClientQuestion {
  type: 'input' | 'password'
  name: string
  message: string
  validate: (value: string) => true | string
  mask?: string
}

export interface RemoteFileStatus {
  exists: boolean
  size?: number
  etag?: string
  // true: 确认一致, false: 确认不一致, null: 无法可靠判断
  sameAsLocal?: boolean | null
}

export interface RemoteStatusOptions {
  diff?: boolean
  localFilePath?: string
  localFileSize?: number
}

export abstract class CDNClient {
  protected credentials?: CDNClientCredentials

  constructor(credentials?: CDNClientCredentials) {
    this.credentials = credentials
  }

  abstract validateConfig(config: ResolvedConfig): void
  abstract getAnswersList(): CDNClientQuestion[]
  abstract answers(): Promise<Record<string, any>>
  abstract create(): Promise<void>
  abstract getRemoteFileStatus(bucket: string, region: string, key: string, options?: RemoteStatusOptions): Promise<RemoteFileStatus>
  abstract uploadFile(bucket: string, region: string, key: string, filePath: string): Promise<void>
  abstract deleteFile(bucket: string, region: string, key: string): Promise<void>
}
