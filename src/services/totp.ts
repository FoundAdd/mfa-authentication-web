import { Secret, TOTP } from 'otpauth'
import type { TotpItem } from '@/types'

export function normalizeSecret(input: string): string {
  return input.replace(/\s+/g, '').toUpperCase()
}

export function isValidBase32(secret: string): boolean {
  const normalized = normalizeSecret(secret)
  if (normalized.length === 0) return false
  if (normalized.length % 8 !== 0) return false
  return /^[A-Z2-7]+$/.test(normalized)
}

export function compute(item: TotpItem, timestampMs: number): string {
  return TOTP.generate({
    secret: Secret.fromBase32(normalizeSecret(item.secret)),
    algorithm: item.algorithm,
    digits: item.digits,
    period: item.period,
    timestamp: timestampMs,
  })
}

export function format(code: string): string {
  const half = Math.floor(code.length / 2)
  return `${code.slice(0, half)} ${code.slice(half)}`
}

export function remainingSeconds(period: number, timestampMs: number): number {
  const elapsed = Math.floor(timestampMs / 1000) % period
  return period - elapsed
}

export function preview(item: TotpItem): {
  code: string
  period: number
  remaining: number
} {
  const now = Date.now()
  return {
    code: compute(item, now),
    period: item.period,
    remaining: remainingSeconds(item.period, now),
  }
}
