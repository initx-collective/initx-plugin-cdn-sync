import type { ResolvedConfig } from '../../types'
import type { CDNClientCredentials, CDNClientQuestion, RemoteFileStatus, RemoteStatusOptions } from './abstract'
import fs from 'node:fs'
import { input, password } from '@inquirer/prompts'
/**
 * COS 客户端封装
 */
import COS from 'cos-nodejs-sdk-v5'
import { CDNClient } from './abstract'
import { calculateFileMD5, isComparableMD5ETag, normalizeETag, parseContentLength } from './cos-checksum'

function validateConcurrency(value: number | undefined, key: string): void {
  if (value === undefined) {
    return
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`配置项 client.${key} 必须是大于等于 1 的整数`)
  }
}

export class COSClient extends CDNClient {
  private cos!: COS

  constructor(credentials?: CDNClientCredentials) {
    super(credentials)
  }

  /**
   * 验证配置
   */
  validateConfig(config: ResolvedConfig): void {
    const { client } = config

    const requiredFields = [
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

  /**
   * 获取问题列表
   */
  getAnswersList(): CDNClientQuestion[] {
    return [
      {
        type: 'input',
        name: 'secretId',
        message: '请输入腾讯云 SecretId:',
        validate: (value: string) => value.length > 0 || 'SecretId 不能为空'
      },
      {
        type: 'password',
        name: 'secretKey',
        message: '请输入腾讯云 SecretKey:',
        mask: '*',
        validate: (value: string) => value.length > 0 || 'SecretKey 不能为空'
      }
    ]
  }

  /**
   * 创建 COS 客户端实例
   */
  async create(): Promise<void> {
    const credentials = await this.answers()

    // 初始化 COS 实例
    this.cos = new COS({
      SecretId: credentials.secretId,
      SecretKey: credentials.secretKey
    })
  }

  /**
   * 收集用户输入
   */
  async answers(): Promise<Record<string, any>> {
    // 如果构造函数传入了 credentials，检查是否有所需的值
    if (this.credentials) {
      const questions = this.getAnswersList()
      const hasAllValues = questions.every(q => this.credentials![q.name])

      if (hasAllValues) {
        // 直接返回 credentials 中的值
        const result: Record<string, any> = {}
        questions.forEach((q) => {
          result[q.name] = this.credentials![q.name]
        })
        return result
      }
    }

    // 否则弹出问题收集
    const secretId = await input({
      message: '请输入腾讯云 SecretId:',
      validate: (value: string) => value.length > 0 || 'SecretId 不能为空'
    })

    const secretKey = await password({
      message: '请输入腾讯云 SecretKey:',
      mask: '*',
      validate: (value: string) => value.length > 0 || 'SecretKey 不能为空'
    })

    return { secretId, secretKey }
  }

  /**
   * 获取远端文件状态
   */
  async getRemoteFileStatus(bucket: string, region: string, key: string, options?: RemoteStatusOptions): Promise<RemoteFileStatus> {
    return new Promise((resolve, reject) => {
      this.cos.headObject({
        Bucket: bucket,
        Region: region,
        Key: key
      }, async (err, data) => {
        if (data) {
          if (!options?.diff) {
            resolve({ exists: true })
            return
          }

          const size = parseContentLength(data.headers)
          const etag = typeof data.ETag === 'string' ? data.ETag : undefined
          const normalizedETag = normalizeETag(etag)
          const localFilePath = options.localFilePath

          let sameAsLocal: boolean | null = null
          if (typeof size === 'number' && typeof options.localFileSize === 'number' && size !== options.localFileSize) {
            sameAsLocal = false
          }
          else if (localFilePath && isComparableMD5ETag(etag) && normalizedETag) {
            try {
              const localMD5 = await calculateFileMD5(localFilePath)
              sameAsLocal = localMD5 === normalizedETag
            }
            catch (hashError) {
              const message = hashError instanceof Error ? hashError.message : String(hashError)
              reject(new Error(`计算本地文件 MD5 失败: ${message}`))
              return
            }
          }

          resolve({
            exists: true,
            size,
            etag,
            sameAsLocal
          })
        }
        else if (err && err.statusCode === 404) {
          resolve({
            exists: false
          })
        }
        else {
          const statusCode = err && 'statusCode' in err ? err.statusCode : 'unknown'
          const message = err && 'message' in err ? err.message : 'unknown error'
          reject(new Error(`检查对象状态失败 (status: ${statusCode}): ${message}`))
        }
      })
    })
  }

  /**
   * 上传文件
   */
  async uploadFile(bucket: string, region: string, key: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cos.putObject({
        Bucket: bucket,
        Region: region,
        Key: key,
        StorageClass: 'STANDARD',
        Body: fs.createReadStream(filePath)
      }, (err) => {
        if (err) {
          reject(err)
        }
        else {
          resolve()
        }
      })
    })
  }

  /**
   * 删除文件
   */
  async deleteFile(bucket: string, region: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.cos.deleteObject({
        Bucket: bucket,
        Region: region,
        Key: key
      }, (err) => {
        if (err) {
          reject(err)
        }
        else {
          resolve()
        }
      })
    })
  }
}
