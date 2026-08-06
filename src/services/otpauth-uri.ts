import { normalizeSecret } from './totp'

export type OtpAlgorithm = 'SHA1' | 'SHA256' | 'SHA512'

export interface ParsedOtpUri {
  issuer: string
  label: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}

export class OtpUriError extends Error {
  constructor(
    message: string,
    readonly reason: 'unsupported' | 'malformed' | 'missing-secret' = 'malformed',
  ) {
    super(message)
    this.name = 'OtpUriError'
  }
}

const ALGORITHMS: Record<string, OtpAlgorithm> = {
  'SHA1': 'SHA1',
  'SHA-1': 'SHA1',
  'SHA256': 'SHA256',
  'SHA-256': 'SHA256',
  'SHA512': 'SHA512',
  'SHA-512': 'SHA512',
}

function toNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.round(n)
}

/**
 * 解析 `otpauth://totp/Issuer:label?secret=...&issuer=...` URI。
 * 容错规则:
 *  - label 缺省时按空字符串处理,issuer 优先取 `issuer` 参数;
 *  - `issuer` 参数与路径中的 issuer 冲突时,以参数为准;
 *  - 未知参数忽略;algorithm/digits/period 缺失或非法时回退默认值;
 *  - 非 otpauth://totp/ 协议抛 OtpUriError('unsupported')。
 */
export function parseOtpUri(input: string): ParsedOtpUri {
  const raw = input.trim()
  if (!raw.toLowerCase().startsWith('otpauth://totp/')) {
    throw new OtpUriError('unsupported content', 'unsupported')
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new OtpUriError('malformed otpauth uri')
  }

  const path = url.pathname.replace(/^\/+/, '')
  const segments = path.split('/')
  const account = decodeURIComponent(segments[0] ?? '')
  if (!account) {
    throw new OtpUriError('missing account label')
  }

  const secretRaw = url.searchParams.get('secret') ?? ''
  if (!secretRaw) {
    throw new OtpUriError('missing secret', 'missing-secret')
  }

  const secret = normalizeSecret(secretRaw)
  const issuerParam = url.searchParams.get('issuer')
  const colonIndex = account.indexOf(':')
  const pathIssuer = colonIndex >= 0 ? account.slice(0, colonIndex) : ''
  const label = colonIndex >= 0 ? account.slice(colonIndex + 1) : account

  const algorithm = ALGORITHMS[(url.searchParams.get('algorithm') ?? '').toUpperCase()] ?? 'SHA1'
  const digits = toNumber(url.searchParams.get('digits'), 6)
  const period = toNumber(url.searchParams.get('period'), 30)

  let issuer = issuerParam ?? pathIssuer
  if (!issuer && !label) issuer = account

  return {
    issuer,
    label,
    secret,
    algorithm,
    digits,
    period,
  }
}

export function buildOtpUri(item: {
  issuer: string
  label: string
  secret: string
  algorithm: OtpAlgorithm
  digits: number
  period: number
}): string {
  const account = item.label
    ? `${encodeURIComponent(item.issuer)}:${encodeURIComponent(item.label)}`
    : `${encodeURIComponent(item.issuer)}:`
  const params = new URLSearchParams({
    secret: normalizeSecret(item.secret),
  })
  params.set('issuer', item.issuer)
  params.set('algorithm', item.algorithm)
  params.set('digits', String(item.digits))
  params.set('period', String(item.period))
  return `otpauth://totp/${account}?${params.toString()}`
}