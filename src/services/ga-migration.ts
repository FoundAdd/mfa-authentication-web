import type { OtpAlgorithm } from './otpMigration'

export interface ParsedGaAccount {
  issuer: string
  label: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
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

// ---- protobuf 手工解码 ----
function readVarint(view: DataView, pos: number): { value: number; next: number } {
  let result = 0
  let shift = 0
  let offset = pos
  while (offset < view.byteLength) {
    const byte = view.getUint8(offset)
    offset++
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 53) throw new GaMigrationError('varint too long')
  }
  return { value: result >>> 0, next: offset }
}

interface RawField {
  field: number
  wireType: number
  // depends on wireType
  varint?: number
  bytes?: Uint8Array
}

function decodeFields(bytes: Uint8Array): RawField[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 0
  const fields: RawField[] = []
  while (pos < view.byteLength) {
    const tag = readVarint(view, pos)
    pos = tag.next
    const field = tag.value >> 3
    const wireType = tag.value & 0x7
    const rec: RawField = { field, wireType }
    if (wireType === 0) {
      const v = readVarint(view, pos)
      pos = v.next
      rec.varint = v.value >>> 0
    } else if (wireType === 2) {
      const len = readVarint(view, pos)
      pos = len.next
      const start = pos
      const end = start + len.value
      if (end > view.byteLength) throw new Error('length overrun')
      rec.bytes = bytes.slice(start, end)
      pos = end
    } else {
      // 仅支持 varint 与 length-delimited;其余跳过分组(wire type 1/5 定长)
      pos += wireType === 1 ? 8 : wireType === 5 ? 4 : 0
    }
    fields.push(rec)
  }
  return fields
}

const SECRET = 1
const TYPE = 2
const ALGORITHM = 3
const DIGITS = 4
const PERIOD = 5
const ISSUER = 6
const PROFILE_ISSUER = 10
const PROFILE_NAME = 11

const OTP_PARAMETERS = 1

/**
 * 解析 `otpauth-migration://offline?data=<base64 protobuf>` 批量迁移内容。
 * 支持 TOTP,SHA1/SHA256/SHA512,6/8/自定义 digits 与 period。
 * HOTP 或不支持的算法类型将被忽略。
 */
export function parseGaMigration(input: string): ParsedGaAccount[] {
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

  let payloadFields: RawField[]
  try {
    payloadFields = decodeFields(payloadBytes)
  } catch {
    throw new GaMigrationError('malformed protobuf')
  }

  const accounts: ParsedGaAccount[] = []
  for (const f of payloadFields) {
    if (f.field === OTP_PARAMETERS && f.wireType === 2 && f.bytes) {
      const parsed = parseOtpParameter(f.bytes)
      if (parsed) accounts.push(parsed)
    }
  }
  if (accounts.length === 0) {
    throw new GaMigrationError('no usable accounts')
  }
  return accounts
}

function parseOtpParameter(bytes: Uint8Array): ParsedGaAccount | null {
  let fields: RawField[]
  try {
    fields = decodeFields(bytes)
  } catch {
    return null
  }
  const type = fields.find((f) => f.field === TYPE)?.varint ?? 1
  if (type !== 1) return null // 仅支持 TOTP

  const secretField = fields.find((f) => f.field === SECRET && f.bytes)
  if (!secretField) return null
  const secret = bytesToBase32(secretField.bytes!)

  const algRaw = fields.find((f) => f.field === ALGORITHM)?.varint ?? 1
  const algorithm: OtpAlgorithm = algRaw === 2 ? 'SHA256' : algRaw === 3 ? 'SHA512' : 'SHA1'
  const digits = fields.find((f) => f.field === DIGITS)?.varint ?? 6
  const period = fields.find((f) => f.field === PERIOD)?.varint ?? 30

  const text = (b?: Uint8Array): string =>
    b ? new TextDecoder().decode(b) : ''
  const issuerBytes = text(fields.find((f) => f.field === ISSUER)?.bytes)
  const profileIssuer = text(fields.find((f) => f.field === PROFILE_ISSUER)?.bytes)
  const profileName = text(fields.find((f) => f.field === PROFILE_NAME)?.bytes)

  let issuer = issuerBytes || profileIssuer
  let label = profileName
  if (!issuer && label) {
    const colon = label.indexOf(':')
    if (colon >= 0) {
      issuer = label.slice(0, colon)
      label = label.slice(colon + 1)
    }
  }

  return {
    issuer: issuer ?? '',
    label: label ?? '',
    secret,
    algorithm,
    digits: digits > 0 ? digits : 6,
    period: period > 0 ? period : 30,
  }
}