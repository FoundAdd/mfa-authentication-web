import type { TotpData } from '@/types'

export const DEFAULT_ITERATIONS = 250000

export interface EncryptedEnvelope {
  v: 1
  encrypted: true
  salt: string
  iter: number
  ct: string
}

export interface PlainEnvelope {
  v: 1
  encrypted: false
  data: string
}

export type Envelope = EncryptedEnvelope | PlainEnvelope

export type EnvelopeErrorReason = 'invalid' | 'decrypt-failed'

export class EnvelopeError extends Error {
  constructor(
    message: string,
    readonly reason: EnvelopeErrorReason = 'invalid',
  ) {
    super(message)
    this.name = 'EnvelopeError'
  }
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex length')
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('invalid hex')
    bytes[i] = byte
  }
  return bytes
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * 用户密码经 PBKDF2-SHA256 派生 AES-GCM 密钥。
 * salt 为字节数组(导出时以 hex 存储),iter 默认 250000 轮。
 */
export async function pbkdf2Key(
  password: string,
  salt: Uint8Array,
  iter: number = DEFAULT_ITERATIONS,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: iter,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptData(
  data: TotpData,
  password: string,
  iter: number,
): Promise<EncryptedEnvelope> {
  const salt = new Uint8Array(32)
  crypto.getRandomValues(salt)
  const key = await pbkdf2Key(password, salt, iter)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const plaintext = new TextEncoder().encode(JSON.stringify(data))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  )
  // ct = iv(12) + ciphertext,iv 随机生成不重复,随密文一并携带
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)
  return {
    v: 1,
    encrypted: true as const,
    salt: toHex(salt),
    iter,
    ct: bytesToBase64(combined),
  }
}

async function decrypt(envelope: EncryptedEnvelope, password: string): Promise<TotpData> {
  try {
    const salt = fromHex(envelope.salt)
    const key = await pbkdf2Key(password, salt, envelope.iter)
    const ct = base64ToBytes(envelope.ct)
    const iv = ct.slice(0, 12)
    const ciphertext = ct.slice(12)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext,
    )
    return validateTotpData(JSON.parse(new TextDecoder().decode(plaintext)))
  } catch (err) {
    if (err instanceof EnvelopeError) throw err
    throw new EnvelopeError('password incorrect or file corrupt', 'decrypt-failed')
  }
}

/**
 * 构造加密导出信封 (用户密码 AES-256-GCM)。
 */
export function buildEncryptedEnvelope(
  data: TotpData,
  password: string,
  iter: number = DEFAULT_ITERATIONS,
): Promise<EncryptedEnvelope> {
  return encryptData(data, password, iter)
}

/**
 * 构造未加密导出信封 (base64 仅为编码,非加密)。
 */
export function buildPlainEnvelope(data: TotpData): PlainEnvelope {
  const json = JSON.stringify(data)
  const encoded = new TextEncoder().encode(json)
  return { v: 1, encrypted: false, data: bytesToBase64(new Uint8Array(encoded)) }
}

/**
 * 校验并规范化信封 JSON 文本。格式非法抛 EnvelopeError('invalid')。
 */
export function parseEnvelope(serialized: string): Envelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new EnvelopeError('invalid envelope json')
  }
  return validateEnvelope(parsed)
}

export function validateEnvelope(value: unknown): Envelope {
  if (typeof value !== 'object' || value === null) {
    throw new EnvelopeError('invalid envelope')
  }
  const obj = value as Record<string, unknown>
  if (obj.v !== 1) {
    throw new EnvelopeError('unsupported version')
  }
  if (obj.encrypted === true) {
    if (
      typeof obj.salt !== 'string' ||
      typeof obj.ct !== 'string' ||
      typeof obj.iter !== 'number' ||
      obj.iter <= 0
    ) {
      throw new EnvelopeError('invalid encrypted envelope')
    }
    return { v: 1, encrypted: true, salt: obj.salt, iter: obj.iter, ct: obj.ct }
  }
  if (obj.encrypted === false) {
    if (typeof obj.data !== 'string') {
      throw new EnvelopeError('invalid plain envelope')
    }
    return { v: 1, encrypted: false, data: obj.data }
  }
  throw new EnvelopeError('unknown envelope type')
}

/**
 * 解密加密信封。GCM 认证失败(密码错误或文件损坏)统一抛 EnvelopeError('decrypt-failed')。
 */
export function decryptEnvelope(
  envelope: EncryptedEnvelope,
  password: string,
): Promise<TotpData> {
  return decrypt(envelope, password)
}

/**
 * 解码未加密信封,校验内部 TotpData 结构。
 */
export function decodePlainEnvelope(envelope: PlainEnvelope): TotpData {
  try {
    const raw = atob(envelope.data)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i)
    }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as TotpData
    return validateTotpData(data)
  } catch (err) {
    if (err instanceof EnvelopeError) throw err
    throw new EnvelopeError('plain envelope corrupted')
  }
}

export function validateTotpData(value: unknown): TotpData {
  if (typeof value !== 'object' || value === null) {
    throw new EnvelopeError('invalid data structure')
  }
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj.groups) || !Array.isArray(obj.ungrouped)) {
    throw new EnvelopeError('invalid data structure')
  }
  return { groups: obj.groups, ungrouped: obj.ungrouped }
}