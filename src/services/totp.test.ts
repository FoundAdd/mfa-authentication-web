import { describe, expect, it } from 'vitest'
import {
  compute,
  format,
  remainingSeconds,
  isValidBase32,
  normalizeSecret,
} from '@/services/totp'
import type { TotpItem } from '@/types'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(bytes: number[]): string {
  let result = ''
  let bits = 0
  let value = 0
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) result += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return result
}

function asciiToBase32(text: string): string {
  const bytes: number[] = []
  for (let i = 0; i < text.length; i++) bytes.push(text.charCodeAt(i))
  return base32Encode(bytes)
}

function item(
  secretAscii: string,
  algorithm: TotpItem['algorithm'],
  digits: number,
  period: number,
): TotpItem {
  return {
    id: 'test',
    issuer: 'RFC',
    label: '',
    secret: asciiToBase32(secretAscii),
    algorithm,
    digits,
    period,
  }
}

// RFC 6238 Appendix B test vectors (T = 59 seconds, 8 digits, 30s period).
// Ascii secrets define the raw key bytes.
const RFC_SECRETS: Record<TotpItem['algorithm'], string> = {
  SHA1: '12345678901234567890',
  SHA256: '12345678901234567890123456789012',
  SHA512:
    '1234567890123456789012345678901234567890123456789012345678901234',
}

const RFC_EXPECTED: Record<TotpItem['algorithm'], string> = {
  SHA1: '94287082',
  SHA256: '46119246',
  SHA512: '90693936',
}

describe('RFC 6238 test vectors (8 digits, 30s)', () => {
  for (const algorithm of ['SHA1', 'SHA256', 'SHA512'] as const) {
    it(`matches RFC 6238 expected value for ${algorithm}`, () => {
      const totpItem = item(RFC_SECRETS[algorithm], algorithm, 8, 30)
      expect(compute(totpItem, 59_000)).toBe(RFC_EXPECTED[algorithm])
    })
  }
})

describe('algorithm/digits/period combos', () => {
  for (const algorithm of ['SHA1', 'SHA256', 'SHA512'] as const) {
    it(`8-digit equals 6-digit with expected relation for ${algorithm}`, () => {
      const eight = compute(item(RFC_SECRETS[algorithm], algorithm, 8, 30), 59_000)
      const six = compute(item(RFC_SECRETS[algorithm], algorithm, 6, 30), 59_000)
      expect(six).toBe(String(Number(eight) % 1_000_000).padStart(6, '0'))
      expect(six).toHaveLength(6)
    })

    it(`period 60 steps counter correctly for ${algorithm}`, () => {
      const totp = item(RFC_SECRETS.SHA1, algorithm, 6, 60)
      const atStart = compute(totp, 0)
      const withinSame = compute(totp, 59_000)
      const nextCounter = compute(totp, 60_000)
      expect(withinSame).toBe(atStart)
      expect(nextCounter).not.toBe(atStart)
    })
  }
})

describe('format grouping', () => {
  it('groups 6 digits as 3+3', () => {
    expect(format('123456')).toBe('123 456')
  })
  it('groups 8 digits as 4+4', () => {
    expect(format('12345678')).toBe('1234 5678')
  })
  it('adapts to odd digit counts', () => {
    expect(format('1234567')).toBe('123 4567')
  })
  it('keeps copyable raw code free of spaces', () => {
    const code = compute(item(RFC_SECRETS.SHA1, 'SHA1', 6, 30), 59_000)
    expect(code).not.toContain(' ')
    expect(code).toMatch(/^\d+$/)
  })
})

describe('countdown', () => {
  it('counts down within a period', () => {
    expect(remainingSeconds(30, 0)).toBe(30)
    expect(remainingSeconds(30, 15_000)).toBe(15)
    expect(remainingSeconds(30, 29_999)).toBe(1)
  })
  it('resets to full period when crossing a boundary', () => {
    expect(remainingSeconds(30, 30_000)).toBe(30)
    expect(remainingSeconds(30, 60_000)).toBe(30)
    expect(remainingSeconds(60, 119_999)).toBe(1)
    expect(remainingSeconds(60, 120_000)).toBe(60)
  })
})

describe('base32 validation', () => {
  it('normalizes by removing spaces and uppercasing', () => {
    expect(normalizeSecret(' jb swy 3dp ')).toBe('JBSWY3DP')
  })
  it('accepts valid base32 secrets of legal length', () => {
    expect(isValidBase32('JBSWY3DPEHPK3PXP')).toBe(true)
    expect(isValidBase32('j bswy3 dp eh pk 3px p')).toBe(true)
    // 26 字符(128-bit) 是常见密钥长度,%8=2 合法
    expect(isValidBase32('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe(true)
  })
  it('rejects invalid characters', () => {
    expect(isValidBase32('JBSWY3DP0EHPK3PX')).toBe(false)
    expect(isValidBase32('1BSWY3DPEHPK3PXP')).toBe(false)
  })
  it('rejects illegal length', () => {
    expect(isValidBase32('JBSWY3D')).toBe(false)
    expect(isValidBase32('')).toBe(false)
    expect(isValidBase32('A')).toBe(false)
  })
})