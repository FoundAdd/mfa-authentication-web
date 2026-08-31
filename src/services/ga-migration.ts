import type { OtpAlgorithm } from './otpMigration'
import type { TotpData } from '@/types'
import { normalizeSecret } from './totp'
import * as protobuf from 'protobufjs'

export interface ParsedGaAccount {
  issuer: string
  label: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

/**
 * 单个迁移二维码解析结果。Google Authenticator 在账号较多时会拆成多个
 * 二维码,每个二维码都携带 batch 元信息(batchSize/batchIndex/batchId),
 * 需全部扫完后按 batchIndex 排序合并再导入。
 */
export interface GaMigrationChunk {
  accounts: ParsedGaAccount[]
  version: number
  batchSize: number
  batchIndex: number
  batchId: number
}

export class GaMigrationError extends Error {
  constructor(
    message: string,
    readonly reason: 'invalid' | 'unsupported' = 'invalid',
  ) {
    super(message)
    this.name = 'GaMigrationError'
  }
}

// ---- base64 / base32 ----
const BASE64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function normalizeBase64(input: string): string {
  let s = input.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4 !== 0) s += '='
  return s
}

function base64ToBytes(b64: string): Uint8Array {
  const s = normalizeBase64(b64)
  const map = new Map<string, number>()
  BASE64_STD.split('').forEach((c, i) => map.set(c, i))
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const c of s) {
    if (c === '=') break
    const val = map.get(c)
    if (val === undefined) throw new GaMigrationError('invalid base64')
    buffer = (buffer << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

function bytesToBase32(bytes: Uint8Array): string {
  let bits = 0
  let buffer = 0
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i]
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out += BASE32_ALPHABET[(buffer >> bits) & 0x1f]
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bits)) & 0x1f]
  }
  return out
}

const GOOGLE_AUTHENTICATOR_PROTO = `
syntax = "proto3";

message MigrationPayload {
  enum Algorithm {
    ALGORITHM_UNSPECIFIED = 0;
    ALGORITHM_SHA1 = 1;
    ALGORITHM_SHA256 = 2;
    ALGORITHM_SHA512 = 3;
    ALGORITHM_MD5 = 4;
  }

  enum OtpType {
    OTP_TYPE_UNSPECIFIED = 0;
    OTP_TYPE_HOTP = 1;
    OTP_TYPE_TOTP = 2;
  }

  enum DigitCount {
    DIGIT_COUNT_UNSPECIFIED = 0;
    DIGIT_COUNT_SIX = 1;
    DIGIT_COUNT_EIGHT = 2;
  }

  message OtpParameters {
    bytes secret = 1;
    string name = 2;
    string issuer = 3;
    Algorithm algorithm = 4;
    DigitCount digits = 5;
    OtpType type = 6;
    int64 counter = 7;
  }

  repeated OtpParameters otp_parameters = 1;
  int32 version = 2;
  int32 batch_size = 3;
  int32 batch_index = 4;
  int32 batch_id = 5;
}
`

interface DecodedOtpParameters {
  secret?: Uint8Array
  name?: string
  issuer?: string
  algorithm?: number
  digits?: number
  type?: number
  counter?: number | protobuf.Long
}

interface DecodedMigrationPayload {
  otpParameters?: DecodedOtpParameters[]
  version?: number
  batchSize?: number
  batchIndex?: number
  batchId?: number
}

const migrationPayloadType = protobuf.parse(
  GOOGLE_AUTHENTICATOR_PROTO,
).root.lookupType('MigrationPayload')

/**
 * 解析单个 `otpauth-migration://offline?data=<base64 protobuf>` 迁移二维码。
 * 返回其中的账号与 batch 元信息。
 * 支持 TOTP,SHA1/SHA256/SHA512,6/8 digits。Google Authenticator 迁移协议
 * 不携带 period,统一按 TOTP 默认 30 秒处理。HOTP 类型会被忽略。
 * HOTP 或不支持的算法类型将被忽略。
 */
export function parseGaMigrationChunk(input: string): GaMigrationChunk {
  const raw = input.trim()
  if (!raw.toLowerCase().startsWith('otpauth-migration://')) {
    throw new GaMigrationError('unsupported content', 'unsupported')
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new GaMigrationError('malformed migration url')
  }
  const dataB64 = url.searchParams.get('data')
  if (!dataB64) throw new GaMigrationError('missing data parameter')

  let payloadBytes: Uint8Array
  try {
    payloadBytes = base64ToBytes(dataB64)
  } catch (err) {
    if (err instanceof GaMigrationError) throw err
    throw new GaMigrationError('invalid data encoding')
  }

  let decoded: DecodedMigrationPayload
  try {
    decoded = migrationPayloadType.decode(
      payloadBytes,
    ) as unknown as DecodedMigrationPayload
  } catch {
    throw new GaMigrationError('malformed protobuf')
  }

  const accounts: ParsedGaAccount[] = (decoded.otpParameters ?? [])
    .map(parseOtpParameter)
    .filter((account): account is ParsedGaAccount => account !== null)

  if (accounts.length === 0) {
    throw new GaMigrationError('no usable accounts')
  }

  return {
    accounts,
    version: decoded.version ?? 1,
    batchSize: decoded.batchSize && decoded.batchSize > 0 ? decoded.batchSize : 1,
    batchIndex: decoded.batchIndex ?? 0,
    batchId: decoded.batchId ?? 0,
  }
}

/**
 * 解析 `otpauth-migration://...` 批量迁移内容并返回其中的账号。
 * 兼容旧入口,仅返回单个二维码携带的账号(不合并 batch)。
 */
export function parseGaMigration(input: string): ParsedGaAccount[] {
  return parseGaMigrationChunk(input).accounts
}

function parseOtpParameter(param: DecodedOtpParameters): ParsedGaAccount | null {
  const type = param.type ?? 0
  if (type !== 0 && type !== 2) return null // 仅支持 TOTP,兼容省略 type 的旧导出。

  const secretBytes = param.secret
  if (!secretBytes || secretBytes.length === 0) return null
  const secret = bytesToBase32(secretBytes)

  const algRaw = param.algorithm ?? 1
  const algorithm: OtpAlgorithm = algRaw === 2 ? 'SHA256' : algRaw === 3 ? 'SHA512' : 'SHA1'
  // Google Authenticator 导出的是 DigitCount 枚举:1 表示 6 位,2 表示 8 位。
  const digits = param.digits === 2 ? 8 : 6

  let issuer = param.issuer ?? ''
  let label = param.name ?? ''
  if (!issuer && label) {
    const colon = label.indexOf(':')
    if (colon >= 0) {
      issuer = label.slice(0, colon)
      label = label.slice(colon + 1)
    } else {
      // GA 中重命名过的条目导出时只有 name 没有 issuer,把该名称直接作为
      // 服务名展示,与 GA 列表"仅有名称就只显示名称"的行为保持一致。
      issuer = label
      label = ''
    }
  }

  return {
    issuer: issuer ?? '',
    label: label ?? '',
    secret,
    algorithm,
    digits,
    period: 30,
  }
}

export interface GaBatchCollectResult {
  complete: boolean
  accounts: ParsedGaAccount[] | null
  collected: number
  total: number
}

/**
 * 分批迁移二维码收集器。Google Authenticator 拆分的每个二维码携带
 * 相同的 batchId 与 batchSize,以及各自唯一的 batchIndex(0 起)。
 * 依次把每个分片的账号放入对应索引,收集齐后按索引顺序合并。
 */
export class GaBatchCollector {
  private batchId: number | null = null
  private batchSize = 1
  private chunks = new Map<number, ParsedGaAccount[]>()

  add(chunk: GaMigrationChunk): GaBatchCollectResult {
    if (
      this.batchId === null ||
      this.batchId !== chunk.batchId ||
      this.batchSize !== chunk.batchSize
    ) {
      // 新的一批导出(不同 batchId / batchSize),重置收集状态
      this.batchId = chunk.batchId
      this.batchSize = chunk.batchSize
      this.chunks.clear()
    }
    this.chunks.set(chunk.batchIndex, chunk.accounts)
    const collected = this.chunks.size
    if (this.isComplete()) {
      const accounts = this.merge()
      const total = this.batchSize
      this.reset()
      return { complete: true, accounts, collected, total }
    }
    return { complete: false, accounts: null, collected, total: this.batchSize }
  }

  private isComplete(): boolean {
    if (this.chunks.size < this.batchSize) return false
    for (let i = 0; i < this.batchSize; i++) {
      if (!this.chunks.has(i)) return false
    }
    return true
  }

  private merge(): ParsedGaAccount[] {
    const out: ParsedGaAccount[] = []
    for (let i = 0; i < this.batchSize; i++) {
      const acc = this.chunks.get(i)
      if (acc) out.push(...acc)
    }
    return out
  }

  reset(): void {
    this.batchId = null
    this.batchSize = 1
    this.chunks.clear()
  }
}

// ---- 合并结果暂存(跨页面传递) ----
let pendingAccounts: ParsedGaAccount[] | null = null

/** 批量合并完成后暂存账号列表,供预览页读取。 */
export function setPendingMigrationAccounts(accounts: ParsedGaAccount[]): void {
  pendingAccounts = accounts
}

/** 取出暂存的合并账号列表(取后清空),没有则返回 null。 */
export function takePendingMigrationAccounts(): ParsedGaAccount[] | null {
  const accounts = pendingAccounts
  pendingAccounts = null
  return accounts
}

// ---- 导出编码(本应用 → GA 兼容迁移二维码) ----

/** 二维码导出每页(每个二维码)携带的账号数。GA 默认 10,按需求缩小到 5-8。 */
export const QR_EXPORT_PAGE_SIZE = 6

function base32ToBytes(input: string): Uint8Array {
  let bits = 0
  let buffer = 0
  const out: number[] = []
  for (const ch of input.toUpperCase()) {
    const val = BASE32_ALPHABET.indexOf(ch)
    if (val === -1) continue
    buffer = (buffer << 5) | val
    bits += 5
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function randomBatchId(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  // 保持正数,与 GA 生成的 batch_id 行为一致
  return buf[0] & 0x7fffffff
}

function algorithmToEnum(algorithm: OtpAlgorithm): number {
  if (algorithm === 'SHA256') return 2
  if (algorithm === 'SHA512') return 3
  return 1
}

function digitsToEnum(digits: number): number {
  // 迁移格式 DigitCount 枚举只支持 6/8,其余按 6 处理
  return digits === 8 ? 2 : 1
}

function buildMigrationUri(
  accounts: ParsedGaAccount[],
  meta: { batchSize: number; batchIndex: number; batchId: number },
): string {
  const payload = {
    otpParameters: accounts.map((account) => ({
      secret: base32ToBytes(normalizeSecret(account.secret)),
      name: account.label,
      issuer: account.issuer,
      algorithm: algorithmToEnum(account.algorithm),
      digits: digitsToEnum(account.digits),
      type: 2, // OTP_TYPE_TOTP
    })),
    version: 1,
    batchSize: meta.batchSize,
    batchIndex: meta.batchIndex,
    batchId: meta.batchId,
  }
  const bytes = migrationPayloadType
    .encode(migrationPayloadType.fromObject(payload))
    .finish()
  return `otpauth-migration://offline?data=${encodeURIComponent(bytesToBase64(bytes))}`
}

export interface GaExportChunk {
  uri: string
  index: number
  count: number
}

/**
 * 将账号列表拆分为多个 GA 兼容迁移二维码(参考 Google Authenticator 导出流程:
 * 每个二维码携带相同 batchId/batchSize 与各自唯一的 batchIndex,导入方收集齐
 * 全部分页后按索引合并)。
 */
export function buildGaMigrationChunks(
  accounts: ParsedGaAccount[],
  pageSize: number = QR_EXPORT_PAGE_SIZE,
): GaExportChunk[] {
  if (accounts.length === 0) return []
  const batchId = randomBatchId()
  const total = Math.ceil(accounts.length / pageSize)
  const chunks: GaExportChunk[] = []
  for (let index = 0; index < total; index++) {
    const slice = accounts.slice(index * pageSize, (index + 1) * pageSize)
    chunks.push({
      uri: buildMigrationUri(slice, {
        batchSize: total,
        batchIndex: index,
        batchId,
      }),
      index,
      count: slice.length,
    })
  }
  return chunks
}

/**
 * 汇总待导出账号:分组条目按分组顺序在前,未分组条目在最后。
 */
export function toMigrationAccounts(data: TotpData): ParsedGaAccount[] {
  const accounts: ParsedGaAccount[] = []
  for (const group of data.groups) {
    for (const item of group.items) {
      accounts.push({
        issuer: item.issuer,
        label: item.label,
        secret: item.secret,
        algorithm: item.algorithm,
        digits: item.digits,
        period: item.period,
      })
    }
  }
  for (const item of data.ungrouped) {
    accounts.push({
      issuer: item.issuer,
      label: item.label,
      secret: item.secret,
      algorithm: item.algorithm,
      digits: item.digits,
      period: item.period,
    })
  }
  return accounts
}

/**
 * 统计超出迁移格式表达能力的账号数(周期非 30 秒,或位数非 6/8)。
 * 这类账号扫码导入后会回退到格式默认值。
 */
export function countFormatLimitedAccounts(accounts: ParsedGaAccount[]): number {
  return accounts.filter(
    (account) =>
      account.period !== 30 || (account.digits !== 6 && account.digits !== 8),
  ).length
}
